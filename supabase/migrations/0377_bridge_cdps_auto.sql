-- =============================================================================
-- MSDPS · Bridge MSDPS→CDPS · migrasi 0377 — penerusan OTOMATIS sesudah Finance
-- =============================================================================
-- Alur lama (0360): BD daftarkan deal → BD klik "Buat Transaksi Finance" →
-- Finance verifikasi → BD klik "Teruskan ke CDPS" + pilih layanan.
-- Alur baru (keputusan pemilik 2026-11-03):
--   BD daftarkan deal (sekaligus memilih layanan CDPS ATAU "Tidak perlu CDPS",
--   transaksi Finance dibuat otomatis) → Finance verifikasi → OTOMATIS masuk
--   antrian CDPS, sudah boleh sejak DP (pembayaran sebagian) — persentase DP
--   yang sudah dibayar klien ikut dikirim sebagai info.
--
-- Kenapa TABEL BARU (deal_cdps_plans), bukan melonggarkan deal_bridge_lines_gate:
-- gerbang 0360 sengaja menolak baris bridge sebelum pembayaran terverifikasi
-- dan komentarnya sendiri melarang melonggarkannya. Rencana layanan di sini
-- adalah DRAF — tidak pernah dikirim apa adanya. Baru saat pembayaran sudah
-- terverifikasi, enqueue_bridge_order() menyalinnya ke deal_bridge_lines
-- (gerbang 0360 tetap berlaku utuh di titik itu) dan ke cdps_outbox, dalam
-- SATU transaksi — tidak ada jendela "lines tersimpan tapi outbox gagal"
-- yang dulu diakui di addBridgeLines().
--
-- Pemicu: delivery tick yang sudah ada (app/api/internal/bridge/deliver,
-- Vercel Cron 10 menit) menjalankan sweep enqueue dulu, lalu delivery.
-- verifyPayment() dan penyimpanan rencana juga mencoba enqueue langsung
-- (best-effort) supaya tidak perlu menunggu tick. Sweep tetap jaring
-- pengaman untuk verifikasi lewat jalur apa pun (Director, SQL langsung).
-- =============================================================================

-- ---- deal_cdps_plans --------------------------------------------------------
-- Satu baris per deal Berbayar: pilihan BD tentang apa yang dikerjakan CDPS.
--   tidak_perlu = true  → lines wajib kosong, deal TIDAK pernah dibridge.
--   tidak_perlu = false → lines = array baris (bentuk sama dengan isian modal
--                         lama: jenis/qty/catatan/alasan_non_roster/
--                         nilai_cross_charge), divalidasi TS, CHECK final di
--                         deal_bridge_lines saat enqueue.
create table deal_cdps_plans (
  deal_id      uuid primary key references brand_deals(id) on delete cascade,
  tidak_perlu  boolean not null default false,
  lines        jsonb not null default '[]'::jsonb,
  last_error   text,                     -- diisi sweep bila payload gagal dibangun ("Perlu dilengkapi")
  updated_by   uuid not null default auth.uid() references employees(id),
  updated_at   timestamptz not null default now(),
  constraint deal_cdps_plans_lines_array check (jsonb_typeof(lines) = 'array'),
  constraint deal_cdps_plans_shape check (
    (tidak_perlu and jsonb_array_length(lines) = 0)
    or (not tidak_perlu and jsonb_array_length(lines) > 0)
  )
);

comment on table deal_cdps_plans is
  'Bridge MSDPS->CDPS otomatis (migrasi 0377): rencana layanan CDPS per deal (draf) atau "Tidak perlu CDPS". Disalin ke deal_bridge_lines + cdps_outbox oleh enqueue_bridge_order() begitu pembayaran terverifikasi Finance (DP pun cukup).';
comment on column deal_cdps_plans.last_error is
  'Alasan terakhir sweep gagal membangun payload (data deal belum lengkap). NULL = tidak ada masalah. Ditampilkan di /deals sebagai "Perlu dilengkapi".';

create or replace function deal_cdps_plans_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_bentuk text;
begin
  -- Rencana yang SUDAH diantre ke CDPS terkunci — order CDPS immutable,
  -- satu order per deal (cdps_outbox_deal_id_uniq). Pengecualian satu-satunya:
  -- kolom last_error (ditulis sweep service-role) boleh dibersihkan.
  if tg_op = 'UPDATE' and exists (select 1 from cdps_outbox where deal_id = new.deal_id)
     and (new.tidak_perlu is distinct from old.tidak_perlu or new.lines is distinct from old.lines) then
    raise exception '[deal ini sudah diteruskan ke CDPS, layanan tidak dapat diubah]'
      using errcode = 'check_violation';
  end if;

  select bentuk_kerjasama into v_bentuk from brand_deals where id = new.deal_id;
  if not found then
    raise exception '[deal tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  -- IS DISTINCT FROM, bukan <> — pelajaran 0360 (bentuk_kerjasama nullable).
  if v_bentuk is distinct from 'Berbayar' and not new.tidak_perlu then
    raise exception '[deal free/barter tidak dikerjakan CDPS]' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE'
     and (new.tidak_perlu is distinct from old.tidak_perlu or new.lines is distinct from old.lines) then
    new.updated_at := now();
    new.last_error := null;            -- isian berubah → evaluasi ulang di sweep berikutnya
    if auth.uid() is not null then
      new.updated_by := auth.uid();
    end if;
  end if;
  return new;
end $$;

create trigger trg_deal_cdps_plans_guard before insert or update on deal_cdps_plans
  for each row execute function deal_cdps_plans_guard();
create trigger trg_deal_cdps_plans_audit after insert or update on deal_cdps_plans
  for each row execute function capture_audit('deal_cdps_plan');

revoke execute on function deal_cdps_plans_guard() from public, anon, authenticated;

alter table deal_cdps_plans enable row level security;

-- Audiens baca = audiens deal_bridge_lines/cdps_outbox (0360).
create policy deal_cdps_plans_select on deal_cdps_plans for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev', 'CreatorManagement', 'Account'));

-- Tulis = can_manage_bridge() (BD/CM/mgmt). Sengaja TIDAK lewat antrian
-- approval Director (deal_change_requests, 0349): rencana layanan bukan data
-- transaksi deal, dan terkunci sendiri begitu diantre (guard di atas).
create policy deal_cdps_plans_insert on deal_cdps_plans for insert to authenticated
  with check (can_manage_bridge() and updated_by = auth_emp_id());

create policy deal_cdps_plans_update on deal_cdps_plans for update to authenticated
  using (can_manage_bridge())
  with check (can_manage_bridge());

-- ---- enqueue_bridge_order(): draf → deal_bridge_lines + cdps_outbox, atomik --
-- Dipanggil HANYA oleh service-role (sweep TS). Payload dibangun di TS
-- (lib/bridge/payload.ts — satu-satunya pembangun payload kontrak v1) lalu
-- dioper ke sini; fungsi ini yang menjamin atomisitas + idempotensi.
-- created_by kedua tabel diisi pembuat rencana (BD/CM) — service-role tidak
-- punya auth.uid(), padahal kolom itu NOT NULL.
-- Mengembalikan true bila baris outbox baru dibuat, false bila deal ini
-- sudah pernah diantre (aman dipanggil berulang / paralel).
create or replace function enqueue_bridge_order(
  p_deal_id         uuid,
  p_payload         jsonb,
  p_idempotency_key text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_plan deal_cdps_plans%rowtype;
  v_line jsonb;
begin
  select * into v_plan from deal_cdps_plans where deal_id = p_deal_id for update;
  if not found then
    raise exception '[rencana layanan CDPS untuk deal ini belum diisi]' using errcode = 'no_data_found';
  end if;
  if v_plan.tidak_perlu then
    raise exception '[deal ini ditandai tidak perlu CDPS]' using errcode = 'check_violation';
  end if;

  -- Kunci baris rencana (for update di atas) menserialkan pemanggil paralel;
  -- pemanggil kedua melihat outbox yang sudah ada dan mundur dengan tenang.
  if exists (select 1 from cdps_outbox where deal_id = p_deal_id) then
    return false;
  end if;

  -- Gerbang pembayaran 0360 (deal_bridge_lines_gate) berlaku di insert ini.
  for v_line in select * from jsonb_array_elements(v_plan.lines) loop
    insert into deal_bridge_lines (deal_id, jenis, qty, catatan, alasan_non_roster, nilai_cross_charge, created_by)
    values (
      p_deal_id,
      v_line->>'jenis',
      nullif(v_line->>'qty', '')::int,
      nullif(btrim(coalesce(v_line->>'catatan', '')), ''),
      nullif(btrim(coalesce(v_line->>'alasan_non_roster', '')), ''),
      nullif(v_line->>'nilai_cross_charge', '')::numeric,
      v_plan.updated_by
    );
  end loop;

  insert into cdps_outbox (deal_id, payload, idempotency_key, created_by)
  values (p_deal_id, p_payload, p_idempotency_key, v_plan.updated_by);

  update deal_cdps_plans set last_error = null where deal_id = p_deal_id;
  return true;
end $$;

comment on function enqueue_bridge_order(uuid, jsonb, text) is
  'Bridge otomatis (0377): salin rencana deal_cdps_plans ke deal_bridge_lines + cdps_outbox dalam satu transaksi. Service-role only.';

revoke execute on function enqueue_bridge_order(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function enqueue_bridge_order(uuid, jsonb, text) to service_role;

-- ---- create_poi_finance(): CreatorManagement ikut boleh ----------------------
-- Transaksi Finance sekarang dibuat otomatis saat deal Berbayar didaftarkan
-- (registerDealTransaction), dan pendaftar deal = canManageDeals() =
-- mgmt/BizDev/CreatorManagement. Gerbang lama (0352) hanya OD/Director/BizDev,
-- jadi deal yang didaftarkan CM akan gagal membuat transaksinya. Disamakan
-- ke can_manage_bridge() (wewenang yang sama persis dengan canManageDeals).
-- Selebihnya isi fungsi IDENTIK dengan 0352.
create or replace function create_poi_finance(
  p_deal_id uuid,
  p_payment_intent payment_intent default 'Lunas'::payment_intent
)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_deal        brand_deals%rowtype;
  v_merchant_id uuid;
  v_kategori    text;
  v_trx_id      uuid;
  v_trx_code    text;
begin
  if not can_manage_bridge() then
    raise exception '[akses ditolak]' using errcode = 'insufficient_privilege';
  end if;

  select * into v_deal from brand_deals where id = p_deal_id;
  if not found then
    raise exception '[deal tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  if v_deal.kategori_poi is null then
    raise exception '[deal ini bukan deal POI]' using errcode = 'check_violation';
  end if;
  if v_deal.bentuk_kerjasama is distinct from 'Berbayar'
     or v_deal.nominal_harga is null or v_deal.nominal_harga <= 0 then
    raise exception '[deal ini bukan kerjasama berbayar]' using errcode = 'check_violation';
  end if;
  if v_deal.transaction_id is not null then
    raise exception '[transaksi untuk deal ini sudah dibuat]' using errcode = 'check_violation';
  end if;

  v_kategori := case v_deal.kategori_poi
                  when 'TTD'          then 'Attraction & Leisure'
                  when 'Accomodation' then 'Accommodation'
                  when 'Dining'       then 'Dining'
                end;

  select id into v_merchant_id from merchants
   where lower(nama_toko) = lower(v_deal.brand_name)
   limit 1;
  if v_merchant_id is null then
    insert into merchants (nama_toko, kota, link_toko, kategori,
                           gmv_baseline, target_gmv, payment_intent)
    values (v_deal.brand_name, '-', '-', v_kategori,
            0, 0, p_payment_intent)
    returning id into v_merchant_id;
  end if;

  insert into transactions (merchant_id, payment_intent, total_agreed_value)
  values (v_merchant_id, p_payment_intent, v_deal.nominal_harga)
  returning id, code into v_trx_id, v_trx_code;

  update brand_deals set transaction_id = v_trx_id where id = p_deal_id;

  return v_trx_code;
end $fn$;

revoke execute on function create_poi_finance(uuid, payment_intent) from public, anon;
grant  execute on function create_poi_finance(uuid, payment_intent) to authenticated;

-- ---- platform_alerts: nilai keenam untuk "payload gagal dibangun" -----------
-- Deal sudah terverifikasi + punya rencana layanan, tapi datanya belum lengkap
-- untuk kontrak v1 (mis. tanggal kontrak kosong). Di alur manual BD langsung
-- melihat pesan error di modal; di alur otomatis tidak ada yang melihat —
-- jadi alert ke BD-nya (dedup per deal, pola dead-letter 0360).
alter table platform_alerts drop constraint platform_alerts_alert_type_check;
alter table platform_alerts add constraint platform_alerts_alert_type_check
  check (alert_type in ('perf_drop', 'link_bocor', 'deal_expiring', 'binding_lost', 'cdps_bridge_dead',
                        'cdps_bridge_incomplete'));
