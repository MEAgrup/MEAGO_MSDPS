-- =============================================================================
-- MSDPS · Phase 0 · Migration 0004 — Status state-machine engine
-- =============================================================================
-- Phase 0 §2.2:
--   * Every lifecycle entity has explicit statuses + explicit allowed transitions.
--   * The SYSTEM blocks invalid transitions (no skipping, no illegal jumps),
--     with a Bahasa Indonesia message; nothing changes on a blocked attempt.
--   * Each transition records who triggered it and when.
--
-- Why enforce in Postgres (not the app): Supabase exposes every table over
-- PostgREST, so a UI/server-action-only rule is bypassable with the anon key.
-- A BEFORE UPDATE trigger is unbypassable — it also fires under the service-role
-- key (service_role bypasses RLS, NOT triggers).
--
-- The allowed transitions live in DATA (status_transitions), so adding/adjusting
-- a transition is a row change, not a code change. Each lifecycle table attaches
-- the generic trigger below with its entity key, e.g.:
--     create trigger trg_status before update on briefs
--       for each row execute function enforce_status_transition('brief');
--
-- Every lifecycle table must carry these two columns (stamped by the engine):
--     status_changed_by uuid, status_changed_at timestamptz
-- =============================================================================

create table status_transitions (
  entity         text not null,          -- e.g. 'brief', 'transaction', 'creator_payout'
  from_status    text not null,
  to_status      text not null,
  allowed_tokens text[],                 -- NULL = any authenticated; else subset of
                                         -- {'staff','lead','od','director'} (actor_tokens())
  note           text,
  primary key (entity, from_status, to_status)
);

comment on table status_transitions is 'Data-driven legal transitions per entity. allowed_tokens gates authority (global escalation rule: approvals require >= lead).';

-- Generic BEFORE UPDATE enforcement. tg_argv[0] = entity key.
create or replace function enforce_status_transition()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_entity   text := tg_argv[0];
  v_allowed  text[];
  v_found    boolean;
begin
  -- Only act when status actually changes.
  if new.status is distinct from old.status then
    select allowed_tokens, true
      into v_allowed, v_found
    from status_transitions
    where entity = v_entity
      and from_status = old.status::text
      and to_status   = new.status::text;

    if not coalesce(v_found, false) then
      raise exception '[transisi status tidak diizinkan: % → %]', old.status, new.status
        using errcode = 'check_violation';
    end if;

    if v_allowed is not null and not (v_allowed && actor_tokens()) then
      raise exception '[anda tidak berwenang melakukan transisi status ini]'
        using errcode = 'insufficient_privilege';
    end if;

    -- Stamp actor + time on every successful transition (immutable history feeds audit log).
    new.status_changed_by := auth.uid();
    new.status_changed_at := now();
  end if;

  return new;
end $$;

comment on function enforce_status_transition() is 'Attach as BEFORE UPDATE trigger with the entity key. Blocks illegal/unauthorized transitions; stamps actor+time.';

-- status_transitions is internal plumbing, read only by the SECURITY DEFINER
-- enforce_status_transition() function. Lock with RLS + no policies so no client
-- can read/write it over PostgREST.
alter table status_transitions enable row level security;
