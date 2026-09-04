-- =============================================================================
-- MSDPS · Merchant Deals · Migration 0350 — brand_deals.ops_name: tambah 'Fifas'
-- =============================================================================
-- REKONSILIASI DRIFT REPO ↔ PRODUCTION, bukan fitur baru.
--
-- Production sudah menerima 'Fifas' sebagai nilai `brand_deals.ops_name` sejak
-- 2026-08-31 — riwayat migrasi production mencatatnya sebagai `0336_ops_name_add_fifas`
-- (versi 20260831090652), tapi FILE migrasinya tidak pernah ada di repo. Jadi
-- `bash scripts/pg_test_reset.sh` / provisioning environment baru menghasilkan
-- constraint yang LEBIH KETAT dari production (hanya Fajri/Aliya/Tammy, lihat
-- 0332_deal_transactions.sql:29-32) — form "Daftarkan Transaksi" akan menolak
-- ops 'Fifas' di environment hasil reset padahal production menerimanya.
--
-- Kelas bug yang sama dengan 21 kolom brand_deals di 0320: perubahan skema
-- di-apply langsung ke live tanpa file migrasi pendamping (docs/SCHEMA_DRIFT.md).
-- Diperbaiki di sini, BUKAN dengan mengedit 0332, supaya database yang sudah
-- menjalankan 0332 versi lama tetap ikut terkoreksi.
--
-- IDEMPOTEN & NO-OP DI PRODUCTION: definisi akhirnya identik dengan yang sudah
-- berlaku di production. Tidak menyentuh data.
--
-- Nomor 0350 dipakai karena 0349 sudah diklaim `0349_deal_change_requests.sql`
-- (PR #30) — dicek lewat riwayat migrasi kedua environment + git log sebelum
-- push, sesuai pelajaran yang dicatat di docs/HANDOFF_FaseG.md.
-- =============================================================================

alter table brand_deals drop constraint if exists brand_deals_ops_name_check;
alter table brand_deals
  add constraint brand_deals_ops_name_check
    check (ops_name is null or ops_name in ('Fajri','Aliya','Tammy','Fifas'));

comment on column brand_deals.ops_name is
  'Nama ops penanggung jawab transaksi POI. Daftar nilainya dikunci check constraint — tambah nilai baru lewat migrasi, jangan langsung ALTER di live.';
