-- =============================================================================
-- MSDPS · Hotfix keamanan — cabut EXECUTE anon/public pada generator M13/M14
-- =============================================================================
-- Advisor `anon_security_definer_function_executable`: fungsi generator
-- (SECURITY DEFINER) masih ter-grant ke PUBLIC → role `anon` bisa memanggilnya
-- via /rest/v1/rpc/*. Gate internal generator memakai pola
--   if auth.uid() is not null and not (is_od() or is_director()) then raise
-- yang SENGAJA meloloskan kasus tanpa-JWT agar pg_cron (jalan sebagai postgres)
-- bisa mengeksekusi. Namun `anon` juga ber-auth.uid() null → gate ter-bypass.
-- Perbaikan: cabut EXECUTE dari public+anon. pg_cron (superuser postgres) tetap
-- bisa; authenticated tetap bisa (gate internal blokir non-OD/Director);
-- view definer pemanggil working_days_between dijalankan sebagai owner (postgres).
-- =============================================================================

revoke execute on function generate_health_snapshots(date)   from public, anon;
revoke execute on function generate_health_monthly(char)      from public, anon;
revoke execute on function generate_performance_scores(date)  from public, anon;
revoke execute on function working_days_between(date, date)   from public, anon;
