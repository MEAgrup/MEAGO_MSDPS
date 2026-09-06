-- =============================================================================
-- MSDPS · MCN · Migration 0315 — Retensi 6 bulan + dedup file + arsip Storage
-- =============================================================================
-- Ingest mingguan "Upload Data Mingguan" (0303) memakai drop-raw: hanya 3 tabel
-- agregat yang tumbuh tiap minggu (creator_period_summary, creator_subcat_segment
-- _gmv, creator_top_products). Agar DB tidak membengkak tanpa batas, data agregat
-- lama dipangkas (retensi default 6 bulan) namun tetap bisa "dihidupkan" kembali
-- dari ARSIP JSON hasil render di Storage. Tiga hal ditambah di sini:
--   1. Dedup file  — file_hash lama hanya 8-char (dipakai batch_id), tidak cukup
--                    untuk mendeteksi upload duplikat dengan aman → simpan sha256
--                    penuh (file_hash_full) + partial index untuk cek cepat.
--   2. Arsip       — bucket privat weekly-archives menampung snapshot JSON tiap
--                    batch (archive_path); archive_deleted_at menandai kapan sweep
--                    retensi menghapus objek fisiknya.
--   3. Retensi     — fungsi purge + jadwal pg_cron bulanan memangkas agregat lewat
--                    cutoff period_start; header batch DIPERTAHANKAN (audit trail).
-- Pembagian tugas: SQL hanya hapus BARIS agregat. Objek fisik di Storage TIDAK
-- bisa dihapus dari Postgres — itu tugas sweep server action (service-role).
-- =============================================================================

-- ---- Kolom baru upload_batches ----------------------------------------------
-- file_hash (8-char) TETAP dipakai untuk batch_id 'ingest:<start>:<hash8>' —
-- JANGAN diubah. file_hash_full menyimpan sha256 penuh khusus deteksi duplikat.
alter table upload_batches
  add column file_hash_full     text,
  add column archive_path       text,
  add column archive_deleted_at timestamptz;

comment on column upload_batches.file_hash_full is
  'sha256 penuh isi file untuk deteksi upload duplikat (file_hash 8-char tetap dipakai batch_id).';
comment on column upload_batches.archive_path is
  'Path arsip JSON hasil render di bucket Storage weekly-archives.';
comment on column upload_batches.archive_deleted_at is
  'Kapan objek arsip dihapus oleh sweep retensi (server action service-role).';

-- Partial index: cek duplikat hanya perlu menimbang batch yang sudah 'processed'
-- (staging/failed bukan sumber kebenaran), jadi indeks dipersempit agar ramping.
create index upload_batches_hash_full_idx on upload_batches (file_hash_full)
  where status = 'processed';

-- ---- Bucket arsip privat (pola creator-reports 0312) ------------------------
-- Bucket privat TANPA policy storage.objects: anon/authenticated tidak bisa
-- menyentuh file sama sekali — semua akses (tulis arsip, baca saat restore, hapus
-- saat sweep) lewat service-role server action.
insert into storage.buckets (id, name, public)
values ('weekly-archives', 'weekly-archives', false)
on conflict (id) do nothing;

-- ---- Config retensi (app_config, value jsonb — pola seed 0301) ---------------
-- Ditambahkan on conflict do nothing (berbeda dari seed awal 0301 yang insert
-- polos) agar migration idempoten & tidak menabrak nilai bila key sudah diubah OD.
insert into app_config (key, value) values
  ('mcn.retention_months', '6'::jsonb)
on conflict (key) do nothing;

-- ---- Fungsi purge agregat kedaluwarsa ---------------------------------------
-- Baca retention_months dari app_config (jsonb → int, coalesce default 6), hitung
-- cutoff, lalu hapus baris agregat lebih tua dari cutoff. Header upload_batches
-- SENGAJA tidak dihapus (audit trail kecil, murah disimpan). Objek Storage TIDAK
-- disentuh di sini — Postgres tak bisa menghapus objek fisik; itu tugas sweep
-- server action yang lalu mengisi archive_deleted_at.
create or replace function mcn_purge_expired_weekly_data()
returns void language plpgsql security definer set search_path = public as $$
declare
  months int;
  cutoff date;
begin
  months := coalesce(
    (select value::text::int from app_config where key = 'mcn.retention_months'),
    6);
  cutoff := current_date - make_interval(months => months);

  delete from creator_period_summary     where period_start < cutoff;
  delete from creator_subcat_segment_gmv where period_start < cutoff;
  delete from creator_top_products        where period_start < cutoff;
end $$;

-- Cabut EXECUTE dari public/anon/authenticated (pola 0210b): retensi murni tugas
-- internal. pg_cron jalan sebagai postgres (superuser) → tetap bisa memanggil.
revoke execute on function mcn_purge_expired_weekly_data() from public, anon, authenticated;

-- ---- Jadwal pg_cron bulanan (waktu UTC; WIB = UTC+7) ------------------------
-- Tanggal 1 pukul 18:00 UTC (= tanggal 2 pukul 01:00 WIB) — pangkas agregat
-- kedaluwarsa sekali sebulan, sejalan dengan job bulanan lain (pola 0208/0209).
select cron.schedule('msdps_retention_monthly', '0 18 1 * *',
  $$select mcn_purge_expired_weekly_data()$$);
