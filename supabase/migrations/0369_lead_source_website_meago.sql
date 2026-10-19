-- =============================================================================
-- MSDPS · M1 · Migration 0369 — Sumber lead baru: 'Website MEAGO'
-- =============================================================================
-- Form merchant/brand di meago.id masuk otomatis ke Pool Lead lewat Edge
-- Function `meago-intake` (migrasi 0370/0371). Lead itu diberi sumber
-- tersendiri — BUKAN memakai nilai lama 'Website' — supaya BizDev bisa
-- membedakan lead yang masuk otomatis dari form MEAGO! dengan lead website
-- yang dulu diinput manual (keputusan Yohan 2026-10-19).
--
-- File sendiri karena `ALTER TYPE ... ADD VALUE` tidak boleh dipakai di
-- transaksi yang sama dengan pemakaian nilai barunya. Idempoten.
-- =============================================================================

alter type lead_source add value if not exists 'Website MEAGO';
