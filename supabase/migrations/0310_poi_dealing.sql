-- =============================================================================
-- MSDPS · MEA GO · Migration 0310 — POI Dealing (program TikTok GO / MEA GO)
-- =============================================================================
-- BizDev dealing dengan POI (venue: TTD / Accomodation / Dining) untuk visit
-- kreator. Digabung ke tabel `brand_deals` (0305) — deal POI dikenali dari
-- kategori_poi IS NOT NULL. Baris lama (deal shop MCN) semua kolom POI = null.
--
-- Yang ditambahkan:
--   * kolom POI pada brand_deals (semua nullable) + index kategori_poi & bd_id.
--   * brand_deals_validate() di-REPLACE: perilaku existing dipertahankan
--     (deal_end := exp_date, mint code DEAL, cek brand_name) + validasi & POIN
--     DERIVED untuk baris POI. Poin dihitung ulang SELALU (read-only ke klien).
--   * seed app_config: poi.poin_rule / poi.kategori / poi.benefits (idempoten).
--   * RPC update_poi_realisasi()  — input realisasi (semua tim), poin auto.
--   * RPC create_poi_finance()    — buat merchant+transaksi utk deal berbayar.
--   * VIEW v_poi_deal_summary (security_invoker) — ringkasan per periode/BD.
-- Audit sudah ter-cover oleh trg_brand_deals_audit (0305). RLS brand_deals (0305)
-- tetap berlaku — tidak diubah.
-- =============================================================================

-- ---- 1) Kolom POI pada brand_deals ------------------------------------------
alter table brand_deals
  add column kategori_poi       text
    check (kategori_poi in ('TTD','Accomodation','Dining')),
  add column pic_name           text,
  add column pic_whatsapp       text,
  add column bentuk_kerjasama   text
    check (bentuk_kerjasama in ('Free','Berbayar')),
  add column nominal_harga      numeric,
  add column benefit            text,
  add column visit_start_date   date,
  add column visit_start_time   time,
  add column visit_end_date     date,
  add column visit_end_time     time,
  add column kreator_needed     int,
  add column konten_needed      int,
  add column brief_link         text,
  add column bd_id              uuid references employees(id),
  add column listing_date       date,
  add column visit_realized_date date,
  add column kreator_realized   int,
  add column video_realized     int,
  add column visit_checked      boolean,
  add column poin               numeric,                    -- DERIVED (read-only)
  add column transaction_id     uuid references transactions(id);

create index brand_deals_kategori_poi_idx on brand_deals (kategori_poi)
  where kategori_poi is not null;
create index brand_deals_bd_idx on brand_deals (bd_id);

-- ---- 2) Seed app_config (idempoten) -----------------------------------------
insert into app_config (key, value) values
  ('poi.poin_rule', '{"full_pct":100,"full":2,"half_pct":50,"half":1,"low":0.5}'::jsonb),
  ('poi.kategori',  '["TTD","Accomodation","Dining"]'::jsonb),
  ('poi.benefits',  '{"TTD":["TTD - Free Ticket"],"Accomodation":["Accomodation - Open Room Only","Accomodation - Free Stay"],"Dining":["Dining - Creator Package","Dining - Free Meals by Visit Group","Dining - Content Package"]}'::jsonb)
on conflict (key) do nothing;

-- ---- 3) brand_deals_validate() : REPLACE (existing + POI) --------------------
-- Perilaku existing (0305) DIPERTAHANKAN untuk baris non-POI: cek brand_name,
-- deal_end := exp_date, mint code DEAL / kunci code. Blok POI hanya jalan bila
-- kategori_poi IS NOT NULL.
create or replace function brand_deals_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rule     jsonb;
  v_full_pct numeric;
  v_full     numeric;
  v_half_pct numeric;
  v_half     numeric;
  v_low      numeric;
  v_pct      numeric;
  v_digits   text;
begin
  -- --- Perilaku existing (semua baris) ---
  if new.brand_name is null or btrim(new.brand_name) = '' then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  -- deal_end mengikuti exp_date (single source of truth).
  new.deal_end := new.exp_date;
  if new.code is null then
    new.code := next_code('DEAL');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  -- --- Blok POI (hanya bila kategori_poi terisi) ---
  if new.kategori_poi is not null then
    -- Pertanyaan wajib POI.
    if new.pic_name is null or btrim(new.pic_name) = ''
       or new.pic_whatsapp is null or btrim(new.pic_whatsapp) = ''
       or new.bentuk_kerjasama is null
       or new.benefit is null or btrim(new.benefit) = ''
       or new.visit_start_date is null
       or new.visit_end_date is null
       or new.kreator_needed is null or new.kreator_needed <= 0
       or new.konten_needed is null or new.konten_needed <= 0 then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;

    -- Berbayar wajib nominal_harga > 0.
    if new.bentuk_kerjasama = 'Berbayar'
       and (new.nominal_harga is null or new.nominal_harga <= 0) then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;

    -- Rentang tanggal visit.
    if new.visit_end_date < new.visit_start_date then
      raise exception '[tanggal selesai visit tidak boleh sebelum tanggal mulai]'
        using errcode = 'check_violation';
    end if;

    -- Normalisasi nomor WA PIC: digits only, 0… -> 62…, biarkan 62….
    v_digits := regexp_replace(new.pic_whatsapp, '[^0-9]', '', 'g');
    if v_digits like '0%' then
      v_digits := '62' || substr(v_digits, 2);
    end if;
    new.pic_whatsapp := v_digits;

    -- POIN DERIVED: selalu dihitung ulang (abaikan nilai kiriman klien).
    select value into v_rule from app_config where key = 'poi.poin_rule';
    v_full_pct := coalesce((v_rule->>'full_pct')::numeric, 100);
    v_full     := coalesce((v_rule->>'full')::numeric,     2);
    v_half_pct := coalesce((v_rule->>'half_pct')::numeric, 50);
    v_half     := coalesce((v_rule->>'half')::numeric,     1);
    v_low      := coalesce((v_rule->>'low')::numeric,      0.5);

    if new.visit_checked is true then
      if new.kreator_realized is null
         or new.kreator_needed is null or new.kreator_needed = 0 then
        -- Visit terjadi tapi data kreator tak ada = setengah poin.
        new.poin := v_half;
      else
        v_pct := new.kreator_realized::numeric / nullif(new.kreator_needed, 0) * 100;
        if v_pct >= v_full_pct then
          new.poin := v_full;
        elsif v_pct >= v_half_pct then
          new.poin := v_half;
        else
          new.poin := v_low;
        end if;
      end if;
    else
      new.poin := 0;
    end if;
  end if;

  return new;
end $$;

-- ---- 4) RPC update_poi_realisasi() ------------------------------------------
-- Input realisasi visit. Poin dihitung ulang otomatis oleh trigger validate.
-- Boleh diisi SEMUA tim (keputusan user) -> grant authenticated.
create or replace function update_poi_realisasi(
  p_deal_id             uuid,
  p_listing_date        date,
  p_visit_realized_date date,
  p_kreator_realized    int,
  p_video_realized      int,
  p_visit_checked       boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_deal brand_deals%rowtype;
begin
  if auth.uid() is null then
    raise exception '[akses ditolak]' using errcode = 'insufficient_privilege';
  end if;
  select * into v_deal from brand_deals where id = p_deal_id;
  if not found then
    raise exception '[deal tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  if v_deal.kategori_poi is null then
    raise exception '[deal ini bukan deal POI]' using errcode = 'check_violation';
  end if;

  update brand_deals set
    listing_date        = p_listing_date,
    visit_realized_date = p_visit_realized_date,
    kreator_realized    = p_kreator_realized,
    video_realized      = p_video_realized,
    visit_checked       = p_visit_checked
  where id = p_deal_id;
end $$;

-- ---- 5) RPC create_poi_finance() --------------------------------------------
-- Buat merchant (bila belum ada) + transaksi utk deal POI berbayar; balik kode
-- TRX. Gate: OD / Director / BizDev.
create or replace function create_poi_finance(
  p_deal_id        uuid,
  p_payment_intent payment_intent default 'Lunas'
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_deal        brand_deals%rowtype;
  v_merchant_id uuid;
  v_kategori    text;
  v_trx_id      uuid;
  v_trx_code    text;
begin
  if not (is_od() or is_director() or auth_division() = 'BizDev') then
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

  -- Pemetaan kategori POI -> kategori merchant M4.
  v_kategori := case v_deal.kategori_poi
                  when 'TTD'         then 'Attraction & Leisure'
                  when 'Accomodation' then 'Accommodation'
                  when 'Dining'       then 'Dining'
                end;

  -- Cari merchant existing berdasar nama toko; bila tak ada, buat.
  select id into v_merchant_id from merchants
   where lower(nama_toko) = lower(v_deal.brand_name)
   limit 1;
  if v_merchant_id is null then
    insert into merchants (nama_toko, kota, link_toko, kategori,
                           gmv_baseline, target_gmv, payment_intent)
    values (v_deal.brand_name, '-', '-', v_kategori,
            0, 0, p_payment_intent)
    returning id into v_merchant_id;               -- kode MER- di-mint trigger
  end if;

  insert into transactions (merchant_id, payment_intent, total_agreed_value)
  values (v_merchant_id, p_payment_intent, v_deal.nominal_harga)
  returning id, code into v_trx_id, v_trx_code;

  update brand_deals set transaction_id = v_trx_id where id = p_deal_id;

  return v_trx_code;
end $$;

-- ---- 6) VIEW ringkasan POI (security_invoker: RLS brand_deals berlaku) -------
create view v_poi_deal_summary with (security_invoker = true) as
select
  to_char(d.created_at, 'YYYYMM')                        as period,
  d.bd_id,
  coalesce(e.full_name, '(tanpa BD)')                    as bd_name,
  d.kategori_poi,
  count(*)::int                                          as total_deal,
  count(*) filter (where d.visit_checked)::int           as realisasi_visit,
  coalesce(sum(d.poin), 0)                               as poin_sum
from brand_deals d
left join employees e on e.id = d.bd_id
where d.kategori_poi is not null
group by 1, 2, 3, 4;

grant select on v_poi_deal_summary to authenticated;

-- ---- 7) Grants / revokes ----------------------------------------------------
-- Fungsi trigger: dicabut dari semua role (dipanggil hanya oleh trigger).
revoke execute on function brand_deals_validate() from public, anon, authenticated;

-- RPC app: hanya authenticated; anon/public dicabut.
revoke execute on function update_poi_realisasi(uuid, date, date, int, int, boolean) from public, anon;
grant  execute on function update_poi_realisasi(uuid, date, date, int, int, boolean) to authenticated;

revoke execute on function create_poi_finance(uuid, payment_intent) from public, anon;
grant  execute on function create_poi_finance(uuid, payment_intent) to authenticated;
