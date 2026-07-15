-- =============================================================================
-- MSDPS · MCN · Migration 0300 — Penambahan nilai enum (transaksi terpisah)
-- =============================================================================
-- Aturan rumah: `ALTER TYPE ... ADD VALUE` menambah label enum, tetapi label
-- baru TIDAK BOLEH dipakai dalam transaksi/migrasi yang sama. Karena itu file
-- ini HANYA menambah nilai — pemakaian pertamanya baru muncul mulai 0301+.
--
--   * division      : dua divisi baru untuk fitur MCN (BizDev sudah ada).
--   * lead_source   : lead shop dari tim CM masuk ke modul Leads M1 existing.
-- =============================================================================

alter type division add value 'CreatorManagement';
alter type division add value 'Acquisition';

alter type lead_source add value if not exists 'MCN Shop Lead';
