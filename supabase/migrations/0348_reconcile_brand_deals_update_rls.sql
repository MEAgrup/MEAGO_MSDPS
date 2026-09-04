-- =============================================================================
-- MSDPS · Fase G reconciliation · Migration 0348 — brand_deals_update final:
-- Merchant Deals director-only (PR #27) + Campaign tetap terbuka (Fase G)
-- =============================================================================
-- KONFLIK TERDETEKSI 2026-09-04: dua PR paralel keduanya memakai prefix nomor
-- 0341-0343 untuk migrasi yang SAMA SEKALI BERBEDA (nama file berbeda, jadi
-- TIDAK bentrok di git — hanya membingungkan dibaca manusia, lihat daftar di
-- bawah):
--   Branch ini (Fase G)         : 0341_go_campaign_enum.sql,
--                                 0342_go_campaigns_foundation.sql (di antaranya
--                                 men-set brand_deals_update untuk BizDev/
--                                 CampaignSpecialist/Account-scoped campaign),
--                                 0343_go_campaign_participants.sql
--   PR #27 (merged ke main)     : 0341_deals_edit_delete_director_only.sql
--                                 (brand_deals update/delete -> is_director()
--                                 SAJA, "leader dan atasnya" belum ada di skema,
--                                 instruksi eksplisit untuk Merchant Deals),
--                                 0342_poi_notes.sql, 0343_poi_sla_settings.sql
--
-- Akibatnya di PRODUCTION (di mana PR #27 di-apply beberapa jam SETELAH
-- migrasi Fase G ini): brand_deals_update saat ini director-only SAJA —
-- BizDev/CampaignSpecialist/Account TIDAK BISA lagi ubah budget/stage
-- campaign mereka sendiri lewat /meago/campaigns/[id]. Sebaliknya, hasil
-- `pg_test_reset.sh` (reset dari nol, file diproses alfabetis) berakhir
-- dengan urutan TERBALIK — 0342_go_campaigns_foundation.sql < 0342_poi_notes.sql
-- secara alfabetis, jadi kebijakan Fase G yang menang — TIDAK cocok dengan
-- production. Migrasi ini menghapus ambiguitas urutan itu dengan menetapkan
-- kebijakan FINAL secara eksplisit, terlepas urutan 0341-0343 mana pun yang
-- lebih dulu jalan.
--
-- Keputusan (dikonfirmasi user 2026-09-04): GABUNGKAN kedua niat, bukan pilih
-- salah satu:
--   - Merchant Deals biasa (campaign_enabled = false): TETAP director-only,
--     sesuai instruksi eksplisit PR #27 — TIDAK diubah.
--   - Baris campaign (campaign_enabled = true): kembali terbuka untuk
--     BizDev/CampaignSpecialist (semua campaign) dan Account (campaign
--     miliknya sendiri, operational_owner_id = auth_emp_id()) — persis
--     cakupan 0342_go_campaigns_foundation.sql.
--
-- DELETE brand_deals SENGAJA TIDAK disentuh di sini (tetap director-only
-- murni, PR #27) — Fase G tidak punya fitur "hapus campaign" yang
-- membutuhkan pengecualian; jangan buka akses yang tidak dipakai.
-- =============================================================================

drop policy if exists brand_deals_update on brand_deals;
create policy brand_deals_update on brand_deals for update to authenticated
  using (
    is_od() or is_director()
    or (campaign_enabled and auth_division() in ('BizDev','CampaignSpecialist'))
    or (campaign_enabled and auth_division() = 'Account' and operational_owner_id = auth_emp_id())
  );

comment on policy brand_deals_update on brand_deals is
  'Merchant Deals biasa (campaign_enabled=false): director-only (PR #27). Campaign (campaign_enabled=true): BizDev/CampaignSpecialist bebas, Account terbatas ke campaign miliknya (operational_owner_id) — cermin 0342_go_campaigns_foundation.sql, ditetapkan ulang di sini (0348) supaya tidak bergantung urutan alfabetis file 0341-0343 yang bertabrakan nomor dengan PR #27. Lihat komentar migrasi ini untuk kronologi lengkap.';
