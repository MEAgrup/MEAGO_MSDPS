-- =============================================================================
-- MSDPS · Migration 0322 — brand_deals POI: menyusul mendokumentasikan objek
-- yang selama ini hanya ada di database (drift tanpa file migrasi)
-- =============================================================================
-- KENAPA FILE INI ADA
-- Audit 2026-08-28 (sesi adaptasi CRM Admin Ops, lihat docs/HANDOFF_CRM_AdminOps.md)
-- menemukan sekumpulan objek POI yang terpasang LANGSUNG ke Supabase — ada di
-- production (`mvcckptntrvzujqaoxxh`) DAN staging (`vgjzvdpxrdoefoncuazw`) —
-- tetapi tidak punya file migrasi di repo:
--
--   * 21 kolom POI di `brand_deals` (kategori_poi … transaction_id)
--   * 2 CHECK (`kategori_poi`, `bentuk_kerjasama`) + 2 FK (`bd_id`,
--     `transaction_id`) + 2 index (`brand_deals_bd_idx`,
--     `brand_deals_kategori_poi_idx`)
--   * view `v_poi_deal_summary`
--   * 2 fungsi SECURITY DEFINER: `update_poi_realisasi()`, `create_poi_finance()`
--
-- Fitur ini dipakai secara nyata: per 2026-08-28 production punya 60 baris
-- `brand_deals` dan SEMUANYA baris POI (`kategori_poi is not null`). Yang
-- memakainya BUKAN kode di repo ini — pencarian di `main` maupun `staging` hanya
-- menemukan `poi_location` (0312); tidak ada satu pun referensi ke 21 kolom di
-- atas, ke view, atau ke kedua RPC. Jadi konsumennya di luar repo ini (app/skrip
-- lain). Jangan hapus objek-objek ini hanya karena tidak dipakai `.from()` di sini.
--
-- Risiko yang ditutup file ini: siapa pun yang menjalankan `supabase db push` ke
-- database baru (atau me-reset staging) sebelumnya akan mendapat schema yang
-- BERBEDA dari production — kolom POI hilang, RPC POI hilang — dan bingung
-- mencari sebabnya karena repo tidak menyebutnya sama sekali.
--
-- SIFAT FILE INI: idempoten (`if not exists` / `create or replace`), jadi aman
-- dijalankan di database yang objeknya sudah ada. Pada production dan staging
-- per hari ini isinya no-op untuk kolom/constraint/index/fungsi — KECUALI satu
-- hal yang disengaja, lihat blok di bawah.
--
-- SATU PERUBAHAN NYATA YANG DISENGAJA — `v_poi_deal_summary`:
--   Body view identik di kedua project, tetapi setelannya menyimpang:
--     · production : `security_invoker = true`  (sudah sesuai konvensi 0313/0314)
--     · staging    : TANPA security_invoker → view berjalan dengan hak pemilik
--       (postgres) dan MELEWATI RLS `brand_deals`. Advisor security staging
--       menandainya `security_definer_view` level ERROR — satu-satunya ERROR di
--       project itu, dan satu-satunya regresi terhadap pembersihan 0314.
--   Selain itu di KEDUA project view ini masih memegang grant ambient bawaan
--   Supabase (anon + authenticated dapat arwdDxtm), bukan pola 0008/0314
--   (`revoke all` lalu `grant select to authenticated`).
--   Dampak nyata sekarang: kecil — staging `brand_deals` kosong (0 baris), dan di
--   production view sudah invoker sehingga anon tetap tersaring RLS. Tapi pada
--   database baru yang dibangun dari repo, tanpa baris ini view akan lahir dalam
--   bentuk definer yang bocor. Karena itu file ini menetapkan bentuk yang benar,
--   bukan menyalin bentuk staging apa adanya.
--
-- Verifikasi sebelum file ini ditulis: definisi kolom, constraint, index, body
-- view, dan body kedua fungsi dibandingkan langsung antara production dan staging
-- (md5 `pg_get_functiondef` / `pg_get_viewdef`). Semua sama; satu-satunya beda
-- pada `create_poi_finance` adalah tiga baris komentar yang hilang di staging
-- (md5 sama setelah komentar di-strip). Versi production yang berkomentar dipakai
-- di sini.
-- =============================================================================

-- ---- 1. Kolom POI di brand_deals --------------------------------------------
-- Semua nullable tanpa default, persis seperti di kedua database. Urutan kolom
-- (`ordinal_position`) memang berbeda antara production dan staging karena
-- perbedaan urutan pemasangan dulu; itu tidak berpengaruh apa pun dan tidak
-- dicoba "diperbaiki" di sini.

alter table brand_deals
  add column if not exists kategori_poi        text,      -- TTD | Accomodation | Dining
  add column if not exists pic_name            text,
  add column if not exists pic_whatsapp        text,
  add column if not exists bentuk_kerjasama    text,      -- Free | Berbayar
  add column if not exists nominal_harga       numeric,
  add column if not exists benefit             text,
  add column if not exists visit_start_date    date,
  add column if not exists visit_start_time    time,
  add column if not exists visit_end_date      date,
  add column if not exists visit_end_time      time,
  add column if not exists kreator_needed      integer,
  add column if not exists konten_needed       integer,
  add column if not exists brief_link          text,
  add column if not exists bd_id               uuid,
  add column if not exists listing_date        date,
  add column if not exists visit_realized_date date,
  add column if not exists kreator_realized    integer,
  add column if not exists video_realized      integer,
  add column if not exists visit_checked       boolean,
  add column if not exists poin                numeric,
  add column if not exists transaction_id      uuid;

-- Catatan: `kreator_needed`/`konten_needed` (POI) berdampingan dengan
-- `kreators_needed`/`videos_needed` (0312, info-only untuk portal kreator).
-- Namanya nyaris sama tetapi keduanya benar-benar ada di database dan diisi oleh
-- alur yang berbeda — jangan digabung tanpa memeriksa konsumen di luar repo.

-- ---- 2. Constraint ----------------------------------------------------------
-- `add constraint if not exists` tidak ada di Postgres, jadi lewat DO block.
-- Nama constraint dipakai persis seperti di database supaya blok ini benar-benar
-- no-op di production/staging. Ejaan 'Accomodation' (satu 'm') memang begitu di
-- database dan di data yang sudah masuk — JANGAN dirapikan di sini; itu perlu
-- migrasi data tersendiri bersama konsumen di luar repo.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.brand_deals'::regclass
      and conname  = 'brand_deals_kategori_poi_check'
  ) then
    alter table brand_deals add constraint brand_deals_kategori_poi_check
      check (kategori_poi = any (array['TTD', 'Accomodation', 'Dining']));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.brand_deals'::regclass
      and conname  = 'brand_deals_bentuk_kerjasama_check'
  ) then
    alter table brand_deals add constraint brand_deals_bentuk_kerjasama_check
      check (bentuk_kerjasama = any (array['Free', 'Berbayar']));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.brand_deals'::regclass
      and conname  = 'brand_deals_bd_id_fkey'
  ) then
    alter table brand_deals add constraint brand_deals_bd_id_fkey
      foreign key (bd_id) references employees(id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.brand_deals'::regclass
      and conname  = 'brand_deals_transaction_id_fkey'
  ) then
    alter table brand_deals add constraint brand_deals_transaction_id_fkey
      foreign key (transaction_id) references transactions(id);
  end if;
end $$;

-- ---- 3. Index ---------------------------------------------------------------

create index if not exists brand_deals_bd_idx
  on brand_deals (bd_id);

create index if not exists brand_deals_kategori_poi_idx
  on brand_deals (kategori_poi) where kategori_poi is not null;

-- ---- 4. RPC POI -------------------------------------------------------------
-- Keduanya SECURITY DEFINER dan di-grant ke `authenticated`, jadi muncul sebagai
-- advisor WARN 0029 ("callable by authenticated") — intensional, kategori yang
-- sama dengan helper definer existing (is_od, auth_division, dst.). Gate akses
-- ada di dalam badan fungsi.

-- update_poi_realisasi: update kolom realisasi POI untuk satu deal. Gate minimal
-- (harus ada sesi login) + deal wajib deal POI.
create or replace function update_poi_realisasi(
  p_deal_id            uuid,
  p_listing_date       date,
  p_visit_realized_date date,
  p_kreator_realized   integer,
  p_video_realized     integer,
  p_visit_checked      boolean
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

comment on function update_poi_realisasi(uuid, date, date, integer, integer, boolean) is
  'Realisasi deal POI (listing/visit/kreator/video/checked). Terpasang langsung ke DB sebelum 0322; didokumentasikan di 0322. WARN advisor 0029 = intensional.';

revoke all on function update_poi_realisasi(uuid, date, date, integer, integer, boolean)
  from public, anon;
grant execute on function update_poi_realisasi(uuid, date, date, integer, integer, boolean)
  to authenticated, service_role;

-- create_poi_finance: terbitkan transaksi Finance (M5) dari satu deal POI
-- berbayar, membuat merchant bila brand-nya belum terdaftar. Sekali per deal —
-- dijaga lewat brand_deals.transaction_id.
create or replace function create_poi_finance(
  p_deal_id        uuid,
  p_payment_intent payment_intent default 'Lunas'::payment_intent
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
                  when 'TTD'          then 'Attraction & Leisure'
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

comment on function create_poi_finance(uuid, payment_intent) is
  'Terbitkan transaksi M5 dari deal POI berbayar (buat merchant bila perlu). Terpasang langsung ke DB sebelum 0322; didokumentasikan di 0322. WARN advisor 0029 = intensional.';

revoke all on function create_poi_finance(uuid, payment_intent) from public, anon;
grant execute on function create_poi_finance(uuid, payment_intent)
  to authenticated, service_role;

-- ---- 5. v_poi_deal_summary --------------------------------------------------
-- Body persis seperti di kedua database (nama & tipe kolom tidak berubah, jadi
-- `create or replace` aman dan konsumen di luar repo tidak terganggu).
-- Setelan keamanan diseragamkan ke bentuk production + pola grant 0008/0314:
-- lihat blok penjelasan di kepala file.

create or replace view v_poi_deal_summary as
  select to_char(d.created_at, 'YYYYMM')            as period,
         d.bd_id,
         coalesce(e.full_name, '(tanpa BD)')        as bd_name,
         d.kategori_poi,
         count(*)::integer                          as total_deal,
         count(*) filter (where d.visit_checked)::integer as realisasi_visit,
         coalesce(sum(d.poin), 0::numeric)          as poin_sum
    from brand_deals d
    left join employees e on e.id = d.bd_id
   where d.kategori_poi is not null
   group by 1, d.bd_id, 3, d.kategori_poi;

alter view v_poi_deal_summary set (security_invoker = true);

comment on view v_poi_deal_summary is
  'Rekap deal POI per periode/BD/kategori (total deal, realisasi visit, poin). Didokumentasikan menyusul di 0322; security_invoker sejak 0322 di staging (production sudah invoker) supaya RLS brand_deals tetap berlaku.';

revoke all on v_poi_deal_summary from public, anon, authenticated;
grant select on v_poi_deal_summary to authenticated;
