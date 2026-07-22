-- =============================================================================
-- MSDPS · MCN · Migration 0316 — Kolom "Status Kontrak" (contract_status)
-- =============================================================================
-- Menambah kolom status kontrak per kreator di master `mcn_creators`. Diisi &
-- diubah manual dari card "Master Kreator" (tabel Data Kreator). Ini BUKAN kolom
-- turunan/ingest — nilai default '-' untuk semua kreator existing dan kreator
-- baru, agar tampilan tabel tidak pernah kosong.
--
-- Ditampilkan di tabel Data Kreator tepat setelah kolom "Status" (binding_status)
-- dan termasuk dalam fitur edit baris terpadu (server action updateCreator).
-- =============================================================================

alter table mcn_creators
  add column contract_status text not null default '-';

comment on column mcn_creators.contract_status is
  'Status kontrak kreator (manual, bukan turunan). Default "-".';
