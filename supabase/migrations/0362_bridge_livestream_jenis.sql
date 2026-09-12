-- =============================================================================
-- MSDPS · Bridge MSDPS→CDPS · migrasi 0362 — D2 dibalik: Live Stream dibridge
-- =============================================================================
-- Keputusan 2026-09-10 D2 (docs/DECISIONS.md sisi AgencyAPP) mengunci `jenis`
-- deal_bridge_lines pada LIMA nilai dan secara eksplisit mengecualikan
-- 'Live Stream' — alasannya saat itu: MSDPS mempertahankannya sendiri sebagai
-- vendor results tracker, membridge cuma menambah satu hop tanpa kapabilitas
-- baru (scripts/test_bridge_gates.sql:159 menegaskan ini DITOLAK).
--
-- Pemilik membalik keputusan itu 2026-09-12: pekerjaan live-stream merchant
-- MEAGO tetap diteruskan ke CDPS, sama seperti Account/Ads/Creative/Store
-- Operation. Dicatat sebagai amandemen D2 (docs/DECISIONS.md AgencyAPP +
-- docs/BUILD_PLAN.md baris Bridge/Locked decisions di repo ini), bukan
-- ditimpa diam-diam — baris test lama yang menegaskan penolakan diperbarui
-- di commit yang sama (scripts/test_bridge_gates.sql).
--
-- Nol perubahan skema di sisi CDPS diperlukan: packages/domain/src/bridge.ts
-- memperlakukan `jenis` sebagai string bebas yang dicocokkan ke
-- `external_service_map.external_service_type` (admin-configurable) — closed
-- set hanya pernah ditegakkan di CHECK constraint MSDPS ini, persis alasan
-- header migrasi 0360 ("Ditegakkan sebagai CONSTRAINT, bukan konvensi UI").
-- Prasyarat operasional sebelum baris 'Live Stream' benar-benar bisa
-- di-accept CDPS: paket MEAGO Live Stream ada di Master Service List +
-- baris `external_service_map` terkait diisi (lihat §6 handoff
-- HANDOFF_PENSIUN_ACCOUNT_SERVICE_20260912.md) — itu data, bukan migrasi.
-- =============================================================================

alter table deal_bridge_lines drop constraint deal_bridge_lines_jenis_check;
alter table deal_bridge_lines add constraint deal_bridge_lines_jenis_check
  check (jenis in ('Account', 'Ads', 'Creative', 'Store Operation', 'KOL-Non-Roster', 'Live Stream'));
