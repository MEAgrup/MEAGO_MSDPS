-- =============================================================================
-- MSDPS · MCN · Migration 0318 — Kebijakan DELETE untuk `acquisitions`
-- =============================================================================
-- Tabel acquisitions (migration 0307) sudah punya policy SELECT/INSERT/UPDATE
-- namun BELUM punya policy DELETE, sehingga fitur "Hapus" di Daftar Akuisisi
-- akan gagal senyap (0 baris terhapus) tanpa policy ini.
--
-- Hak hapus disamakan dengan hak tulis (INSERT/UPDATE): OD, Director, atau
-- divisi Acquisition. Ini hard-delete — baris benar-benar hilang, mengikuti
-- pola hapus modul lain (live_schedule_slots, special_project_creators, dst.).
-- =============================================================================

create policy acquisitions_delete on acquisitions for delete to authenticated
  using (is_od() or is_director() or auth_division() = 'Acquisition');
