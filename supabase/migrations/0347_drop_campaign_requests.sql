-- =============================================================================
-- MSDPS · Fase G cleanup · Migration 0347 — hapus campaign_requests (dead)
-- =============================================================================
-- docs/HANDOFF_FaseG.md §6 (G.2): 'Campaign "tiktok_package" selesai di sini.
-- Setelah rilis: hapus card "Routing Campaign" + tabel campaign_requests.'
-- Fase G.2-G.5 sudah rilis (0343-0346) dan menggantikan seluruh fungsi
-- routing manual ini dengan pendaftaran & kurasi kreator berbasis
-- campaign_participants. Aman di-drop:
--   - 0 baris di production maupun staging sejak tabel dibuat (audit 2026-09-02,
--     docs/HANDOFF_FaseG.md §2.3).
--   - Satu-satunya pemakai (card "Routing Campaign" di app/(app)/bizdev/page.tsx,
--     5 fungsi di lib/actions/bizdev.ts, lib/mcn/routing.ts) sudah dihapus di
--     commit yang sama dengan migrasi ini — tidak ada kode yang masih
--     mereferensikan tabel ini.
-- =============================================================================

drop table if exists campaign_requests;
drop function if exists campaign_requests_validate();
