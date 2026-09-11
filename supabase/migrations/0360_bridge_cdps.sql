-- =============================================================================
-- MSDPS · Bridge MSDPS→CDPS Fase 1 · Migration 0360
-- =============================================================================
-- Bridge satu-arah: MEAGO (repo ini) menutup deal POI/merchant tapi tidak
-- punya tim eksekusi Account/Ads/Creative/Store Operation sendiri — pekerjaan
-- itu dikerjakan MEA Agency lewat CDPS (`MEAgrup/AgencyAPP`). Deal yang SUDAH
-- dibayar (gerbang D4+D13) diteruskan sebagai satu "order" ke CDPS
-- (`external_orders`, ORD-…), manusia di sana yang accept/reject. Bukan
-- callback (Fase 2 belum ada di sini) — lihat docs/BRIDGE_MSDPS_CONTRACT.md.
--
-- Otoritas: keputusan 2026-09-10 "Bridge MSDPS→CDPS Fase 1" (16 keputusan
-- terkunci + 3 amandemen), sisi CDPS-nya di `docs/DECISIONS.md` repo
-- AgencyAPP — repo ini tidak punya file DECISIONS.md sendiri, jadi baris
-- ini + baris Progress `docs/BUILD_PLAN.md` (migrasi 0360, B6) adalah
-- catatan resminya di sisi MSDPS.
--
-- ── Penyimpangan yang disengaja dari draf rencana (dicatat, bukan diam-diam) ──
-- Draf awal meminta `cron.schedule` di dalam migrasi ini untuk delivery job.
-- Itu TIDAK dilakukan di sini. Alasannya:
--   1. `pg_net`/`net.http_post` NOL dipakai di seluruh riwayat migrasi MSDPS
--      MAUPUN CDPS (`grep -rl pg_net supabase/migrations` kosong di kedua
--      repo) — pg_cron di kedua repo SELALU memanggil fungsi SQL murni
--      langsung (pola `0208:445-451`), tidak pernah HTTP keluar.
--   2. Delivery job ini BUTUH TypeScript (fetch() + backoff + dead-letter +
--      `crypto.timingSafeEqual`, lihat B3) — `net.http_post` async/fire-and-
--      forget masih perlu sesuatu MEMBACA balasannya nanti; itu tidak
--      mengurangi kerumitan, hanya memindahkannya.
--   3. Memanggil balik ke deployment sendiri lewat `net.http_post` butuh URL
--      dasar deployment ini tersimpan agar SQL bisa membacanya — tidak ada
--      domain production yang terverifikasi untuk dituliskan di sini
--      (`docs/STAGING.md` hanya mendokumentasikan URL STAGING; production
--      belum tercatat) — MENEBAK domain akan melanggar batasan anti-halusinasi.
--   4. CDPS SUDAH punya pola yang identik tujuannya dan TERBUKTI jalan:
--      endpoint tick + `apps/api/src/lib/tick-auth.ts`, dipicu scheduler
--      EKSTERNAL (Vercel Cron / GitHub Actions), bukan pg_cron. Itu pola yang
--      dipakai di sini juga (lihat `app/api/internal/bridge/deliver/route.ts`
--      + `vercel.json`), nol pg_net baru, nol domain ditebak.
-- Yang TETAP dibuat di migrasi ini apa adanya sesuai draf: `deal_bridge_lines`,
-- `cdps_outbox`, dan perluasan CHECK `platform_alerts.alert_type`.
-- =============================================================================

-- ---- can_manage_bridge(): satu sumber kebenaran wewenang, SELALU boolean ---
-- Cermin canManageDeals() (lib/actions/deals.ts): mgmt/BizDev/CreatorManagement.
-- coalesce(...,false) WAJIB — pelajaran 0358: kalau fungsi ini mengembalikan
-- NULL untuk sesi non-karyawan (mis. sesi kreator portal), maka
-- `if not (can_manage_bridge())` di trigger akan mengevaluasi `not null` =
-- null, dan `if null then` DIAM-DIAM TIDAK MELEMPAR — gerbang bobol tanpa
-- pernah error. coalesce di sini menutup kelas bug itu untuk SEMUA pemanggil.
create or replace function can_manage_bridge() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
    is_od() or is_director() or auth_division() in ('BizDev', 'CreatorManagement'),
    false
  )
$$;
comment on function can_manage_bridge() is
  'Satu sumber kebenaran wewenang bridge MSDPS->CDPS — cermin canManageDeals() TS. Selalu boolean (coalesce false), lihat 0358.';
revoke execute on function can_manage_bridge() from public, anon;

-- ---- deal_bridge_lines ------------------------------------------------------
-- Baris "apa yang diteruskan ke CDPS" per deal. Sengaja BUKAN boolean di
-- brand_deals: satu deal biasa sebagian dikerjakan MEAGO sendiri, sebagian
-- dibridge ke agency (mis. Account+Ads dibridge, KOL tetap roster MCN MEA).
create table deal_bridge_lines (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             uuid not null references brand_deals(id) on delete restrict,
  jenis               text not null
                        check (jenis in ('Account', 'Ads', 'Creative', 'Store Operation', 'KOL-Non-Roster')),
  qty                 int,
  catatan             text,
  alasan_non_roster   text,
  nilai_cross_charge  numeric,
  ord_code            text,                     -- diisi delivery job stlh 2xx dari CDPS (ORD-…)
  created_by          uuid not null default auth.uid() references employees(id),
  created_at          timestamptz not null default now(),
  constraint deal_bridge_lines_non_roster_check check (
    jenis <> 'KOL-Non-Roster' or (alasan_non_roster is not null and btrim(alasan_non_roster) <> '')
  )
);

create index deal_bridge_lines_deal_idx on deal_bridge_lines (deal_id);

comment on table deal_bridge_lines is
  'Bridge MSDPS->CDPS Fase 1: baris layanan yang diteruskan ke CDPS per deal. Bukan modul PRD MSDPS — lihat docs/BUILD_PLAN.md baris migrasi 0360.';
comment on column deal_bridge_lines.ord_code is
  'ORD-YYYYMM-NNNN dari CDPS, diisi delivery job (service-role) setelah cdps_outbox baris terkait berstatus sent. NULL = belum terkirim / masih pending-retry.';

-- Dua gerbang pembayaran (D4+D13), sebagai trigger Postgres — bukan hanya di
-- server action TS, karena tabel ini juga terekspos lewat PostgREST langsung.
-- BD TIDAK BISA pre-stage bridge line sebelum pembayaran benar-benar mendarat
-- dan terverifikasi. Kalau kelak perlu draft, bentuk jujurnya adalah status
-- eksplisit `[Draf]` dengan pengiriman TETAP diblokir sampai gerbang ini lolos
-- — bukan melonggarkan trigger ini.
create or replace function deal_bridge_lines_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deal brand_deals%rowtype;
  v_trx  transactions%rowtype;
begin
  -- Baris yang SUDAH terkirim ke CDPS (ord_code terisi) adalah fakta historis
  -- — tidak boleh diubah lagi, simetris dengan payload immutable di sisi CDPS.
  if tg_op = 'UPDATE' and old.ord_code is not null then
    raise exception '[baris bridge yang sudah dikirim ke CDPS tidak dapat diubah]'
      using errcode = 'check_violation';
  end if;

  select * into v_deal from brand_deals where id = new.deal_id;
  if not found then
    raise exception '[deal tidak ditemukan]' using errcode = 'no_data_found';
  end if;

  -- IS DISTINCT FROM, bukan <>: bentuk_kerjasama nullable dan ada deal produksi
  -- yang memang NULL (belum diisi) — dengan <> baris itu akan lolos diam-diam
  -- karena `NULL <> 'Berbayar'` adalah NULL, bukan true, dan CHECK/IF NOT
  -- memperlakukan NULL sebagai "tidak melempar".
  if v_deal.bentuk_kerjasama is distinct from 'Berbayar' then
    raise exception '[deal free/barter tidak dikerjakan CDPS]' using errcode = 'check_violation';
  end if;

  if v_deal.transaction_id is null then
    raise exception '[pembayaran belum terverifikasi, deal belum bisa diteruskan]'
      using errcode = 'check_violation';
  end if;

  select * into v_trx from transactions where id = v_deal.transaction_id;
  if not found or v_trx.released_to_account_at is null then
    raise exception '[pembayaran belum terverifikasi, deal belum bisa diteruskan]'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger trg_deal_bridge_lines_gate before insert or update on deal_bridge_lines
  for each row execute function deal_bridge_lines_gate();
create trigger trg_deal_bridge_lines_audit after insert or update on deal_bridge_lines
  for each row execute function capture_audit('deal_bridge_line');

revoke execute on function deal_bridge_lines_gate() from public, anon, authenticated;

-- RLS mencerminkan canManageDeals — pola 0349:59-86. Baca: audiens sama dengan
-- brand_deals (BizDev/CreatorManagement/Account/mgmt, 0305). Tulis: canManageDeals
-- (can_manage_bridge()). TIDAK memodelkan peran baru pada `CampaignSpecialist`
-- (nol karyawan aktif, 0358) — pemilik sebenarnya SPV Creator Management + BizDev,
-- sudah tercakup can_manage_bridge().
alter table deal_bridge_lines enable row level security;

create policy deal_bridge_lines_select on deal_bridge_lines for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev', 'CreatorManagement', 'Account'));

create policy deal_bridge_lines_insert on deal_bridge_lines for insert to authenticated
  with check (can_manage_bridge() and created_by = auth_emp_id());

create policy deal_bridge_lines_update on deal_bridge_lines for update to authenticated
  using (can_manage_bridge())
  with check (can_manage_bridge());

-- ---- cdps_outbox -------------------------------------------------------------
-- Antrian pengiriman ke CDPS. Ditulis SEKALI oleh server action (status
-- 'pending'); status/attempts/ord_code sesudahnya HANYA ditulis oleh delivery
-- job lewat service-role (createAdminClient()) — tidak ada policy UPDATE untuk
-- sesi authenticated biasa, supaya "tidak pernah dikirim inline dari server
-- action" benar-benar tidak bisa dilanggar diam-diam lewat PostgREST langsung.
create table cdps_outbox (
  id               uuid primary key default gen_random_uuid(),
  deal_id          uuid references brand_deals(id) on delete set null,
  event            text not null default 'bridge_order' check (event = 'bridge_order'),
  payload          jsonb not null,
  idempotency_key  text not null unique,        -- '<DEAL code>:<payload_versi>'
  attempts         int not null default 0,
  last_error       text,
  status           text not null default 'pending'
                     check (status in ('pending', 'sent', 'failed', 'dead')),
  next_attempt_at  timestamptz not null default now(),
  sent_at          timestamptz,
  ord_code         text,
  created_by       uuid not null default auth.uid() references employees(id),
  created_at       timestamptz not null default now(),
  constraint cdps_outbox_sent_shape check (status <> 'sent' or (sent_at is not null and ord_code is not null))
);

create index cdps_outbox_pending_idx on cdps_outbox (next_attempt_at) where status in ('pending', 'failed');
create index cdps_outbox_deal_idx on cdps_outbox (deal_id);
-- Satu order per deal seumur Fase 1 (idempotency_key terkunci ke payload_versi=1,
-- nol mekanisme "tambah baris ke order yang sudah terkirim") — dijaga di DB juga,
-- bukan hanya pre-check TS di addBridgeLines(). NULL boleh berulang (baris yang
-- deal-nya sudah terhapus, on delete set null) — hanya deal_id terisi yang dikunci.
create unique index cdps_outbox_deal_id_uniq on cdps_outbox (deal_id) where deal_id is not null;

comment on table cdps_outbox is
  'Antrian delivery job Bridge MSDPS->CDPS (migrasi 0360). idempotency_key = "<DEAL code>:<payload_versi>" — brand_deals.code selalu ada & immutable (trigger brand_deals_validate, 0355:242), sehingga key ini stabil sepanjang umur baris.';

alter table cdps_outbox enable row level security;

-- Baca: audiens sama dengan deal_bridge_lines, supaya /deals bisa menampilkan
-- status pengiriman ("ORD-… " / "menunggu" / "gagal, akan dicoba lagi" / "mati").
create policy cdps_outbox_select on cdps_outbox for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev', 'CreatorManagement', 'Account'));

-- Insert hanya lewat addBridgeLines() (server action), aktor = canManageDeals.
create policy cdps_outbox_insert on cdps_outbox for insert to authenticated
  with check (can_manage_bridge() and created_by = auth_emp_id());

-- SENGAJA tidak ada policy UPDATE/DELETE untuk `authenticated` — hanya
-- service-role (delivery job, bypass RLS tapi tetap tunduk trigger) yang
-- boleh mengubah status/attempts/ord_code.

-- ---- platform_alerts: alert_type + nilai kelima untuk dead-letter -----------
-- Pola 0309:48-50. CHECK tertutup 4 nilai hari ini (perf_drop/link_bocor/
-- deal_expiring/binding_lost); ditambah 'cdps_bridge_dead' untuk baris
-- cdps_outbox yang sudah 'dead' (5 percobaan gagal) — dedup lewat query alert
-- terbuka lebih dulu, pola mcn-ingest.ts:782-828, di delivery job TS (B3).
alter table platform_alerts drop constraint platform_alerts_alert_type_check;
alter table platform_alerts add constraint platform_alerts_alert_type_check
  check (alert_type in ('perf_drop', 'link_bocor', 'deal_expiring', 'binding_lost', 'cdps_bridge_dead'));

-- ---- Tidak ada cdps_order_status di Fase 1 ----------------------------------
-- Milik callback (Fase 2, belum dibangun). Lihat catatan penyimpangan di atas
-- untuk kenapa tidak ada cron.schedule/pg_net di sini juga.
