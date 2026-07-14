-- =============================================================================
-- MSDPS · Fase B · Module 3 — Campaign (acquisition thread, `CMP-…`)
-- =============================================================================
-- Created before Leads (M1) because leads reference campaigns.
-- Lifecycle: [Draft] -> [Active] <-> [Paused] -> [Closed] -> [Archived].
-- Rollups (leads/real/merchants/value) are a VIEW (M3 §6.1) — added after M4.
-- =============================================================================

create type campaign_status as enum
  ('[Draft]','[Active]','[Paused]','[Closed]','[Archived]');

create table campaigns (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,                       -- CMP-YYYYMM-NNNN (after validation)
  campaign_name      text not null,
  channel            text not null,                     -- drives Lead.Source
  is_online          boolean not null default false,
  is_offline         boolean not null default false,
  start_date         date,
  end_date           date,                              -- set on [Closed]
  owner_id           uuid references employees(id),
  status             campaign_status not null default '[Draft]',
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  status_changed_by  uuid,
  status_changed_at  timestamptz
);

comment on table campaigns is 'Acquisition campaign (M3). 1:1 with marketing_performance_records (M2).';

-- ID + mandatory validation (M3 §3 Rule 2). SECURITY DEFINER so it can mint the code.
create or replace function campaigns_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.campaign_name is null or btrim(new.campaign_name) = ''
     or new.channel is null or btrim(new.channel) = ''
     or new.start_date is null
     or new.owner_id is null
     or not (new.is_online or new.is_offline) then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  if new.code is null then
    new.code := next_code('CMP');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  -- stamp End Date automatically when closing
  if tg_op = 'UPDATE' and new.status = '[Closed]' and old.status <> '[Closed]' and new.end_date is null then
    new.end_date := current_date;
  end if;
  return new;
end $$;

create trigger trg_campaigns_validate before insert or update on campaigns
  for each row execute function campaigns_validate();
create trigger trg_campaigns_status before update on campaigns
  for each row execute function enforce_status_transition('campaign');
create trigger trg_campaigns_audit after insert or update on campaigns
  for each row execute function capture_audit('campaign');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('campaign','[Draft]','[Active]',    null),
  ('campaign','[Active]','[Paused]',   null),
  ('campaign','[Paused]','[Active]',   null),
  ('campaign','[Active]','[Closed]',   null),
  ('campaign','[Paused]','[Closed]',   null),
  ('campaign','[Closed]','[Archived]', null);

-- RLS: all internal users may read (BizDev/Account trace the thread). Marketing
-- creates; owner or Marketing Lead/Director edits.
alter table campaigns enable row level security;

create policy campaigns_select on campaigns
  for select to authenticated using (true);

create policy campaigns_insert on campaigns
  for insert to authenticated
  with check (auth_division() = 'Marketing' or is_director());

create policy campaigns_update on campaigns
  for update to authenticated
  using (
    owner_id = auth_emp_id()
    or (is_lead() and auth_division() = 'Marketing')
    or is_director()
  );
