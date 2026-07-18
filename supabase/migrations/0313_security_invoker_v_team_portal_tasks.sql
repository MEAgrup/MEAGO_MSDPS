-- =============================================================================
-- MSDPS · Migration 0313 — Tinjauan advisor keamanan: security_definer_view
-- =============================================================================
-- Advisor Supabase menandai 7 view ERROR `security_definer_view`. Hasil tinjauan
-- satu-per-satu (2026-07-18):
--   · v_merchant_board, v_speed_score, v_okr_attainment, v_management_dashboard
--     : definer DISENGAJA — membaca tabel lintas divisi / audit_log; role-gate
--       eksplisit ditanam di WHERE (lihat komentar migrasi 0206–0210). DIBIARKAN.
--   · v_portal_merchants (0311), v_portal_deals (0312)
--     : definer DISENGAJA — sengaja melewati RLS karyawan untuk sesi kreator;
--       kolom aman terbatas + gate `auth_creator_id() is not null`. DIBIARKAN.
--   · v_team_portal_tasks
--     : definer TIDAK SENGAJA — hanya membungkus v_merchant_board (sudah
--       ber-gate + di-grant ke authenticated); dua saudaranya di 0210
--       (v_team_portal_performance, v_team_portal_blocks) eksplisit
--       security_invoker. Perilaku identik setelah flip: filter auth.uid()/
--       auth_division() tidak bergantung definer, dan sebagai invoker caller
--       tetap punya SELECT pada v_merchant_board. → DIPERBAIKI di sini.

alter view v_team_portal_tasks set (security_invoker = true);

comment on view v_team_portal_tasks is
  'M15 Team Portal: My Tasks — kartu saya + antrian divisi + (AM) portofolio. Read-only; aksi di modul asal. security_invoker sejak 0313 — gate diwarisi dari v_merchant_board.';
