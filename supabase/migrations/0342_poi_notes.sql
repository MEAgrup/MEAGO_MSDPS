-- =============================================================================
-- MSDPS · POI SOP Tracking · Migration 0342 — kolom "notes"
-- =============================================================================
-- Form input GMV (tab POI Accommodation & TTD dan POI Dining) menambah field
-- catatan bebas. RLS existing pada kedua tabel (update via poi_sop_progress /
-- poi_dining_cycles, migrasi 0336/0337) sudah cukup — kolom baru otomatis ikut
-- policy yang ada, tidak perlu policy baru.
-- =============================================================================

alter table poi_sop_progress add column if not exists notes text;
alter table poi_dining_cycles add column if not exists notes text;
