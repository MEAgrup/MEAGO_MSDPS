-- =============================================================================
-- MSDPS · MCN MEA Features · Migration 0302 — MCN Creators (master roster)
-- =============================================================================
-- Separate from KOL M9 `creators` (which track bookings/projects).
-- MCN creators = affiliate roster with performance tracking & CPM assignment.
-- Status: prospek → binding → aktif → nonaktif (and back).
-- =============================================================================

create table mcn_creators (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                           -- MCR-NNNN via next_code_global()
  name              text not null,
  platform          text not null default 'tiktok',        -- tiktok, [future: shopee, etc]
  niche             text,                                  -- primary niche/category
  top_niches        jsonb,                                 -- ranked array of niches
  status            text not null default 'prospek' check (status in ('prospek', 'binding', 'aktif', 'nonaktif')),
  jenis_creator     text check (jenis_creator is null or jenis_creator in ('live', 'video', 'mixed')),
  gmv               numeric,                               -- monthly average affiliate GMV
  gmv_live          numeric,                               -- monthly average from live streams
  gmv_video         numeric,                               -- monthly average from video content
  commission_share  numeric,                               -- read-only sync from platform
  owner_cpm_id      uuid references employees(id) on delete set null,  -- CPM staff assigned to manage
  live_roster       boolean not null default false,        -- eligible for live scheduling
  ads_budget_cap    numeric,                               -- optional budget cap for ad requests
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz,
  unique (platform, lower(name))
);

comment on table mcn_creators is 'MCN affiliate creator roster. Separate from KOL M9. Per-platform unique.';

create or replace function mcn_creators_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is null or btrim(new.name) = '' then
    raise exception '[nama kreator wajib diisi]' using errcode = 'check_violation';
  end if;

  if new.code is null then
    new.code := next_code_global('MCR');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger trg_mcn_creators_validate before insert or update on mcn_creators
  for each row execute function mcn_creators_validate();
create trigger trg_mcn_creators_status before update on mcn_creators
  for each row execute function enforce_status_transition('mcn_creator');
create trigger trg_mcn_creators_audit after insert or update on mcn_creators
  for each row execute function capture_audit('mcn_creator');

-- Status transitions
insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('mcn_creator', 'prospek', 'binding', null),
  ('mcn_creator', 'prospek', 'aktif', null),
  ('mcn_creator', 'binding', 'aktif', null),
  ('mcn_creator', 'aktif', 'nonaktif', null),
  ('mcn_creator', 'nonaktif', 'aktif', null);

-- RLS: select wide (all divisions + mgmt); write restricted
alter table mcn_creators enable row level security;

create policy mcn_creators_select on mcn_creators
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition', 'KOL')
  );

create policy mcn_creators_insert on mcn_creators
  for insert to authenticated
  with check (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'Acquisition')
  );

-- CPM staff can only update their own creators (owner_cpm_id = self); Lead CM and mgmt can update any.
create policy mcn_creators_update on mcn_creators
  for update to authenticated
  using (
    is_od()
    or is_director()
    or (auth_division() = 'CreatorManagement' and (
      (is_lead()) or (owner_cpm_id = auth_emp_id())
    ))
    or (auth_division() = 'Acquisition' and is_lead())
  )
  with check (
    is_od()
    or is_director()
    or (auth_division() = 'CreatorManagement' and (
      (is_lead()) or (owner_cpm_id = auth_emp_id())
    ))
    or (auth_division() = 'Acquisition' and is_lead())
  );
