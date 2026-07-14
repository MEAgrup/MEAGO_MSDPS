-- =============================================================================
-- MSDPS · Phase 0 · Migration 0001 — Extensions
-- =============================================================================
-- Enables the Postgres extensions MSDPS relies on.
--   pgcrypto  -> gen_random_uuid() for surrogate primary keys
--   pg_cron   -> scheduled snapshots (MHR weekly, MHRM monthly, PERF weekly,
--                Pool TTL 24h, nightly overdue re-flag)  [Phase 0 §2.6 / Modules 13/14]
--
-- NOTE: On Supabase, pg_cron must be enabled once from the Dashboard
-- (Database > Extensions) or via the line below if your role has rights.
-- It is guarded so re-running this migration never fails.
-- =============================================================================

create extension if not exists pgcrypto;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when insufficient_privilege or feature_not_supported then
    raise notice 'pg_cron not enabled here — enable it from the Supabase Dashboard before running scheduled-job migrations.';
  end;
end $$;
