-- =============================================================================
-- MSDPS · Fase G · Migration 0341 — division enum: CampaignSpecialist
-- =============================================================================
-- Aturan rumah (0300_mcn_enums.sql:4-7): `ALTER TYPE ... ADD VALUE` menambah
-- label enum, tetapi label baru TIDAK BOLEH dipakai dalam transaksi/migrasi
-- yang sama. Karena itu file ini HANYA menambah nilai — pemakaian pertamanya
-- (kolom `brand_deals.operational_team`, RLS `brand_deals`) baru di 0342+.
--
-- Keputusan Fase G #3 (docs/HANDOFF_FaseG.md §5): campaign punya dua sumber —
-- Campaign Specialist (budget internal MEA) dan BizDev (budget brand). Divisi
-- baru ini mewadahi tim Campaign Specialist; penerima campaign dari BizDev
-- tetap divisi Account yang sudah ada (tidak perlu nilai enum baru).
-- =============================================================================

alter type division add value 'CampaignSpecialist';
