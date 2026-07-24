-- =============================================================================
-- MSDPS · MCN · Migration 0317 — Kolom tambahan form "Catat Akuisisi (Binding)"
-- =============================================================================
-- Menambah 4 kolom pada `acquisitions` untuk field baru di form akuisisi:
--   binding_end_date : tanggal binding berakhir (pasangan binding_date = "mulai").
--                      CHECK menjaga berakhir >= mulai; NULL diizinkan sehingga
--                      baris lama (belum punya nilai) tetap valid.
--   phone            : nomor telepon pelanggan (format bebas; validasi format ID
--                      dilakukan di server action — mirror normalize_phone_id).
--   uid              : UID pelanggan. Unik lintas akuisisi via partial unique index
--                      (baris lama ber-NULL tidak saling bentrok).
--   kreator_kontrak  : status kontrak kreator. Reuse domain nilai yang sama dengan
--                      mcn_creators.status_kontrak ('kontrak' / 'non kontrak',
--                      migration 0316) — bukan enum baru.
-- Semua kolom nullable / punya CHECK yang lolos untuk baris existing → migration
-- aman, data akuisisi lama tidak hilang atau rusak.
-- =============================================================================

alter table acquisitions
  add column binding_end_date date,
  add column phone            text,
  add column uid              text,
  add column kreator_kontrak  text
    check (kreator_kontrak in ('kontrak', 'non kontrak'));

-- Berakhir tidak boleh lebih awal dari mulai (binding_date). NULL end → lolos.
alter table acquisitions
  add constraint chk_acquisitions_binding_range
    check (binding_end_date is null or binding_end_date >= binding_date);

-- UID unik per pelanggan; NULL (baris lama) diabaikan oleh partial index.
create unique index acquisitions_uid_uniq
  on acquisitions (uid) where uid is not null;
