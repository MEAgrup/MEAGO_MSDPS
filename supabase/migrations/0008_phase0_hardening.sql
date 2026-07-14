-- =============================================================================
-- MSDPS · Phase 0 · Migration 0008 — Function hardening (security advisors)
-- =============================================================================
-- Closes Supabase security-advisor findings without weakening the model:
--   1. Pin search_path on functions that lacked it.
--   2. Internal functions (ID minting, trigger bodies) must NOT be callable from
--      the API by anyone. Triggers still fire (trigger execution ignores EXECUTE
--      grants) and SECURITY DEFINER callers run as the owner who retains EXECUTE.
--      >>> Convention: entity ID triggers that call next_code()/next_code_global()
--          MUST be declared SECURITY DEFINER so the owner can call them.
--   3. RLS helper functions must stay callable by `authenticated` (policies invoke
--      them) but not by `anon`/PUBLIC. They only ever return the CALLER's own role
--      info, so this is pure defense-in-depth.
--
-- NOTE on grants: Supabase grants EXECUTE to anon/authenticated explicitly (via
-- default privileges) AND Postgres grants to PUBLIC by default. To truly remove
-- access you must revoke from public, anon, AND authenticated.
-- =============================================================================

-- 1) search_path
alter function auth_emp_id()      set search_path = public;
alter function audit_immutable()  set search_path = public;

-- 2) Internal-only functions: no API access at all.
revoke execute on function next_code(text, timestamptz)  from public, anon, authenticated;
revoke execute on function next_code_global(text)         from public, anon, authenticated;
revoke execute on function enforce_status_transition()    from public, anon, authenticated;
revoke execute on function capture_audit()                from public, anon, authenticated;
revoke execute on function audit_immutable()              from public, anon, authenticated;

-- 3) RLS helper functions: authenticated only.
do $$
declare f text;
begin
  foreach f in array array[
    'auth_emp_id()','auth_division()','auth_rank()','is_lead()','is_od()',
    'is_director()','actor_tokens()','add_working_days(date,numeric)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
