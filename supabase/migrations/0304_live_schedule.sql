-- =============================================================================
-- MSDPS · MCN MEA Features · Migration 0304 — Live schedule slots
-- =============================================================================
-- Matriks creator × day with multi-slot support (no unique per day constraint).
-- Status: scheduled, tentative, off, done (done = locked, no edits).
-- Verification: fill actual_start/end + verified_by to transition to done.
-- =============================================================================

create table live_schedule_slots (
  id                  uuid primary key default gen_random_uuid(),
  mcn_creator_id      uuid not null references mcn_creators(id) on delete cascade,
  schedule_date       date not null,                       -- YYYY-MM-DD wall-clock
  start_time          time,
  end_time            time,
  status              text not null default 'scheduled' check (status in ('scheduled', 'tentative', 'off', 'done')),
  off_reason          text,
  brand_name          text,
  deal_id             uuid,                                -- FK to brand_deals (added in 0305)
  deals_by            text check (deals_by is null or deals_by in ('bd', 'cm', 'creator')),
  ads_payer           text check (ads_payer is null or ads_payer in ('brand', 'mea', 'invoicing_mea', 'organik')),
  ads_note            text,
  pk_ready            boolean,
  product_set_title   text,
  product_connected_tap boolean,
  fokus_produk        text,
  actual_start        time,
  actual_end          time,
  verified_by         uuid references employees(id) on delete set null,
  verified_at         timestamptz,
  created_by          uuid default auth.uid(),
  updated_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz default now(),
  status_changed_by   uuid,
  status_changed_at   timestamptz,
  index (schedule_date),
  index (mcn_creator_id, schedule_date)
);

comment on table live_schedule_slots is 'Weekly live schedule. Multi-slot per day allowed. done status = locked.';

create or replace function live_schedule_slots_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Block edits on done slots
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    if old.status = 'done' then
      raise exception '[slot sudah diverifikasi dan terkunci, tidak dapat diubah]' using errcode = 'check_violation';
    end if;
  end if;

  -- Validate transitions to done: must have actual_start, actual_end, verified_by
  if tg_op = 'UPDATE' and new.status = 'done' and old.status <> 'done' then
    if new.actual_start is null or new.verified_by is null then
      raise exception '[slot selesai memerlukan actual_start dan verified_by]' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

create trigger trg_live_schedule_validate before insert or update or delete on live_schedule_slots
  for each row execute function live_schedule_slots_validate();
create trigger trg_live_schedule_status before update on live_schedule_slots
  for each row execute function enforce_status_transition('live_slot');
create trigger trg_live_schedule_audit after insert or update on live_schedule_slots
  for each row execute function capture_audit('live_slot');

-- Status transitions
insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('live_slot', 'scheduled', 'tentative', null),
  ('live_slot', 'tentative', 'scheduled', null),
  ('live_slot', 'scheduled', 'off', null),
  ('live_slot', 'tentative', 'off', null),
  ('live_slot', 'off', 'scheduled', null),
  ('live_slot', 'scheduled', 'done', null),
  ('live_slot', 'tentative', 'done', null);

-- RLS: select mgmt + CM + BizDev; write CM + BizDev + mgmt (CPM staff scope their creator)
alter table live_schedule_slots enable row level security;

create policy live_slots_select on live_schedule_slots
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev')
  );

create policy live_slots_insert on live_schedule_slots
  for insert to authenticated
  with check (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev')
  );

-- CPM staff can only edit their own creator's slots; Lead CM and mgmt unrestricted
create policy live_slots_update on live_schedule_slots
  for update to authenticated
  using (
    is_od()
    or is_director()
    or (auth_division() = 'CreatorManagement' and (
      is_lead() or (select owner_cpm_id from mcn_creators where id = mcn_creator_id) = auth_emp_id()
    ))
    or (auth_division() = 'BizDev' and is_lead())
  )
  with check (
    is_od()
    or is_director()
    or (auth_division() = 'CreatorManagement' and (
      is_lead() or (select owner_cpm_id from mcn_creators where id = mcn_creator_id) = auth_emp_id()
    ))
    or (auth_division() = 'BizDev' and is_lead())
  );

create policy live_slots_delete on live_schedule_slots
  for delete to authenticated
  using (
    is_od()
    or is_director()
    or (auth_division() = 'CreatorManagement' and (
      is_lead() or (select owner_cpm_id from mcn_creators where id = mcn_creator_id) = auth_emp_id()
    ))
    or (auth_division() = 'BizDev' and is_lead())
  );
