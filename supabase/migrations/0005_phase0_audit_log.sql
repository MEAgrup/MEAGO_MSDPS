-- =============================================================================
-- MSDPS · Phase 0 · Migration 0005 — Immutable audit log
-- =============================================================================
-- Phase 0 §2.3: every entity has a full activity/audit log (actor, action,
-- before -> after, timestamp). History can NEVER be edited or deleted by anyone,
-- INCLUDING Directors.
--
-- True immutability is enforced with BEFORE UPDATE/DELETE triggers that always
-- raise. Triggers fire even when RLS is bypassed (service_role), so not even an
-- admin key can rewrite history. TRUNCATE privilege is revoked as a backstop.
-- =============================================================================

create table audit_log (
  id           bigint generated always as identity primary key,
  entity       text not null,
  entity_id    uuid,
  entity_code  text,
  action       text not null,            -- INSERT | UPDATE | STATUS_CHANGE
  actor        uuid,                     -- auth.uid() at time of change
  before       jsonb,
  after        jsonb,
  at           timestamptz not null default now()
);

create index audit_log_entity_idx on audit_log (entity, entity_id);
create index audit_log_at_idx on audit_log (at);

comment on table audit_log is 'Append-only. UPDATE/DELETE blocked for everyone incl. Director & service_role (trigger-enforced).';

-- --- Immutability lock -------------------------------------------------------
create or replace function audit_immutable()
returns trigger language plpgsql as $$
begin
  raise exception '[audit log bersifat permanen dan tidak dapat diubah atau dihapus]'
    using errcode = 'insufficient_privilege';
end $$;

create trigger trg_audit_no_update before update on audit_log
  for each row execute function audit_immutable();

create trigger trg_audit_no_delete before delete on audit_log
  for each row execute function audit_immutable();

revoke update, delete, truncate on audit_log from public;

-- --- Generic capture trigger -------------------------------------------------
-- Attach to every audited table, e.g.:
--   create trigger trg_audit after insert or update on briefs
--     for each row execute function capture_audit('brief');
-- Uses to_jsonb so it works whether or not a table has a 'code' column.
create or replace function capture_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_entity text := tg_argv[0];
  v_new    jsonb;
  v_old    jsonb;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    insert into audit_log (entity, entity_id, entity_code, action, actor, before, after)
    values (v_entity, (v_new->>'id')::uuid, v_new->>'code', 'INSERT', auth.uid(), null, v_new);
    return new;

  elsif tg_op = 'UPDATE' then
    v_new := to_jsonb(new);
    v_old := to_jsonb(old);
    insert into audit_log (entity, entity_id, entity_code, action, actor, before, after)
    values (
      v_entity, (v_new->>'id')::uuid, v_new->>'code',
      case when v_new->>'status' is distinct from v_old->>'status' then 'STATUS_CHANGE' else 'UPDATE' end,
      auth.uid(), v_old, v_new
    );
    return new;
  end if;
  return null;
end $$;

comment on function capture_audit() is 'Attach as AFTER INSERT OR UPDATE with entity key. Writes before->after snapshot to audit_log.';

-- Audit log is readable by OD and Director (oversight); writes happen only via
-- the SECURITY DEFINER capture trigger.
alter table audit_log enable row level security;

create policy audit_select_oversight on audit_log
  for select to authenticated
  using (is_od() or is_director());
