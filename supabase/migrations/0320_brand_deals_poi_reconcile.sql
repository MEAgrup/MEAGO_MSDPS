-- =============================================================================
-- MSDPS · Migration 0320 — Rekonsiliasi kolom POI `brand_deals` (perbaikan drift)
-- =============================================================================
-- MASALAH YANG DIPERBAIKI (temuan audit 2026-09-02)
--
-- 21 kolom `brand_deals` ADA di database live tetapi TIDAK PERNAH dibuat oleh
-- satu pun file migrasi di repo ini. Komentar di 0332/0333 menyebutnya "migrasi
-- lampau yang tidak tercermin di riwayat migrasi lokal" — perubahan itu di-apply
-- langsung ke live tanpa file pendamping.
--
-- Akibatnya rantai migrasi repo TIDAK BISA dijalankan dari nol. Diverifikasi
-- empiris di PostgreSQL 16 bersih (seluruh 0001→0338 dijalankan berurutan):
--
--     0332_deal_transactions.sql:56
--     ERROR: column "bentuk_kerjasama" does not exist
--
-- 0332 memanggil `alter column nominal_harga …`, `add constraint … check
-- (bentuk_kerjasama …)`, dan 0336/0337 memasang trigger `update of kategori_poi,
-- bentuk_kerjasama` — semuanya divalidasi Postgres saat DDL, jadi gagal keras.
-- Artinya: `supabase db reset`, provisioning environment baru, dan CI dari nol
-- semuanya mati di 0332.
--
-- FILE INI menaruh kolom-kolom tersebut PADA POSISI KRONOLOGIS YANG BENAR —
-- sesudah 0316, sebelum 0330/0332 yang memakainya — sehingga rantai kembali utuh.
--
-- IDEMPOTEN & AMAN UNTUK LIVE: seluruh pernyataan memakai `if not exists` /
-- guard katalog. Di database live (yang sudah punya semuanya) file ini adalah
-- NO-OP total — tidak mengubah data, tidak mengubah skema, tidak menyentuh 77
-- baris deal produksi. Di database kosong, file ini yang membuatnya.
--
-- CATATAN BATAS: yang direkonsiliasi di sini HANYA bentuk kolom/constraint/index/FK
-- persis seperti di live. Nilai default & NOT NULL untuk `nominal_harga`, serta
-- check `bentuk_kerjasama`, SENGAJA TIDAK dipasang di sini — itu memang pekerjaan
-- 0332, dan menduplikasinya akan mengubah urutan sejarah.
-- =============================================================================

alter table brand_deals
  -- Identitas & PIC transaksi POI
  add column if not exists kategori_poi          text,
  add column if not exists pic_name              text,
  add column if not exists pic_whatsapp          text,
  add column if not exists bd_id                 uuid,
  -- Bentuk kerja sama & nilai (constraint/default-nya dipasang 0332)
  add column if not exists bentuk_kerjasama      text,
  add column if not exists nominal_harga         numeric,
  add column if not exists benefit               text,
  -- Jadwal visit
  add column if not exists visit_start_date      date,
  add column if not exists visit_start_time      time without time zone,
  add column if not exists visit_end_date        date,
  add column if not exists visit_end_time        time without time zone,
  -- Kebutuhan deliverable
  add column if not exists kreator_needed        integer,
  add column if not exists konten_needed         integer,
  add column if not exists brief_link            text,
  -- Realisasi & skoring BD (dipakai formula `poin` di brand_deals_validate, 0333)
  add column if not exists listing_date          date,
  add column if not exists visit_realized_date   date,
  add column if not exists kreator_realized      integer,
  add column if not exists video_realized        integer,
  add column if not exists visit_checked         boolean,
  add column if not exists poin                  numeric,
  -- Tautan ke transaksi Finance M5
  add column if not exists transaction_id        uuid;

-- ---- Constraint & FK (guard katalog: `add constraint` tak punya IF NOT EXISTS) ----
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'brand_deals_kategori_poi_check') then
    alter table brand_deals
      add constraint brand_deals_kategori_poi_check
      check (kategori_poi = any (array['TTD'::text, 'Accomodation'::text, 'Dining'::text]));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'brand_deals_bd_id_fkey') then
    alter table brand_deals
      add constraint brand_deals_bd_id_fkey foreign key (bd_id) references employees(id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'brand_deals_transaction_id_fkey') then
    alter table brand_deals
      add constraint brand_deals_transaction_id_fkey foreign key (transaction_id) references transactions(id);
  end if;
end $$;

-- ---- Index ----
create index if not exists brand_deals_bd_idx on brand_deals (bd_id);
create index if not exists brand_deals_kategori_poi_idx
  on brand_deals (kategori_poi) where kategori_poi is not null;

-- ---- Dokumentasi kolom ----
-- `kategori_poi` NULL = baris hasil Import Master Deal yang belum dilengkapi. Seluruh
-- blok validasi POI di brand_deals_validate() (0333) dilewati untuk baris seperti itu,
-- dan tracker SOP (0336/0337) memfilter kolom ini — jadi baris ber-NULL tidak pernah
-- masuk alur operasional sampai dilengkapi lewat "Lengkapi Data".
comment on column brand_deals.kategori_poi is
  'Kategori POI (TTD/Accomodation/Dining). NULL = baris Import Master Deal belum lengkap — dilewati validasi POI & tidak masuk tracker SOP.';
comment on column brand_deals.visit_checked is
  'Penanda visit terverifikasi. Input untuk formula `poin` di brand_deals_validate() (0333).';
comment on column brand_deals.kreator_realized is
  'Jumlah kreator terealisasi vs kreator_needed. Input untuk formula `poin` (0333).';
comment on column brand_deals.poin is
  'Skor BD per transaksi. DERIVED — selalu dihitung ulang trigger brand_deals_validate() (0333) dari app_config.poi_poin_rule; nilai kiriman klien diabaikan.';
comment on column brand_deals.transaction_id is
  'Tautan opsional ke transaksi Finance M5.';
