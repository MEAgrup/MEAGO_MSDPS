-- =============================================================================
-- MSDPS · MCN · Migration 0310 — Special Project: total video & lokasi POI
-- =============================================================================
-- Revisi QA /projects (2026-07-17): dua field info OPSIONAL pada special_projects,
-- tampil hanya di halaman /projects (form create + list).
-- videos_needed : target total video project (angka info, tanpa hitung realisasi).
-- poi_location  : lokasi POI project (teks bebas satu baris).
-- Tanpa perubahan trigger/validasi (field opsional — special_projects_validate
-- hanya mengecek field wajib) dan tanpa perubahan v_project_summary (UI membaca
-- kedua kolom langsung dari special_projects).
-- =============================================================================

alter table special_projects
  add column videos_needed int,
  add column poi_location  text;

comment on column special_projects.videos_needed is
  'Target total video dibutuhkan (info-only, opsional) — revisi QA 2026-07-17';
comment on column special_projects.poi_location is
  'Lokasi POI project (teks bebas, opsional) — revisi QA 2026-07-17';
