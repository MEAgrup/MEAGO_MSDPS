-- =============================================================================
-- MSDPS · MCN · Migration 0316 — Kolom status_kontrak master kreator
-- =============================================================================
-- Menandai apakah kreator terikat kontrak dengan MCN atau tidak. Hanya dua nilai
-- valid: 'kontrak' / 'non kontrak' — dijaga CHECK constraint inline (pola yang
-- sama dengan kolom `status`/`jenis_creator` di 0302). Nullable: baris lama tetap
-- valid (belum ditetapkan) sampai diisi lewat modal edit kreator.
-- =============================================================================

alter table mcn_creators
  add column status_kontrak text
    check (status_kontrak in ('kontrak', 'non kontrak'));
