-- =============================================================================
-- MSDPS · Leads/BD · Migration 0336 — brand_deals ops_name: tambah 'Fifas'
-- =============================================================================
-- Data migrasi CSV transaksi historis memakai "Fifas" sebagai salah satu Nama
-- OPS (6 baris), di luar 3 nilai yang sudah ada (Fajri/Aliya/Tammy) sejak
-- migrasi 0332. Diperluas di sini, bukan dipetakan ke nama lain, supaya
-- atribusi kerja OPS tetap akurat.
-- =============================================================================

alter table brand_deals drop constraint if exists brand_deals_ops_name_check;
alter table brand_deals
  add constraint brand_deals_ops_name_check
    check (ops_name is null or ops_name in ('Fajri','Aliya','Tammy','Fifas'));
