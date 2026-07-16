-- =============================================================================
-- MSDPS · MCN MEA Features · Migration 0308 — Special Projects
-- =============================================================================
-- Special projects: campaigns with specific creator targets & merchant participants.
-- Tracking: creators assigned (internal CM vs external Acquisition).
-- Summary view: derived progress vs target.
-- =============================================================================

create table special_projects (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,                             -- SPJ-YYYYMM-NNNN
  name            text not null,
  industry_category text not null check (industry_category in ('Dining', 'Accommodation', 'Things to Do')),
  start_date      date not null,
  end_date        date not null check (end_date >= start_date),
  ads_budget      numeric,
  target_gmv      numeric,
  creators_needed integer not null,
  description     text,
  status          text not null default 'draft' check (status in ('draft', 'active', 'done', 'cancelled')),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz
);

comment on table special_projects is 'Special projects with creator quotas & merchant scope. Lead/OD/Director only.';

create or replace function special_projects_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is null or btrim(new.name) = '' then
    raise exception '[nama project wajib diisi]' using errcode = 'check_violation';
  end if;

  if new.start_date is null or new.end_date is null then
    raise exception '[tanggal start dan end wajib diisi]' using errcode = 'check_violation';
  end if;

  if new.creators_needed <= 0 then
    raise exception '[jumlah kreator dibutuhkan harus > 0]' using errcode = 'check_violation';
  end if;

  if new.code is null then
    new.code := next_code('SPJ');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger trg_special_projects_validate before insert or update on special_projects
  for each row execute function special_projects_validate();
create trigger trg_special_projects_status before update on special_projects
  for each row execute function enforce_status_transition('special_project');
create trigger trg_special_projects_audit after insert or update on special_projects
  for each row execute function capture_audit('special_project');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('special_project', 'draft', 'active', '{lead,od,director}'),
  ('special_project', 'active', 'done', '{lead,od,director}'),
  ('special_project', 'active', 'cancelled', '{lead,od,director}'),
  ('special_project', 'draft', 'cancelled', '{lead,od,director}');

-- Project ↔ Merchant (M4) many-to-many
create table special_project_merchants (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references special_projects(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  added_by    uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (project_id, merchant_id)
);

comment on table special_project_merchants is 'Project merchant participants (M4 link).';

create trigger trg_project_merchants_audit after insert or update on special_project_merchants
  for each row execute function capture_audit('special_project_merchant');

-- Project ↔ MCN Creator assignment with filled_by tracking
create table special_project_creators (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references special_projects(id) on delete cascade,
  mcn_creator_id  uuid not null references mcn_creators(id) on delete cascade,
  filled_by       text not null check (filled_by in ('cm', 'acquisition')),  -- source: CM internal or Akuisisi
  assigned_by     uuid references employees(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (project_id, mcn_creator_id)
);

comment on table special_project_creators is 'Project creator assignments (internal CM vs external Acquisition).';

create trigger trg_project_creators_audit after insert or update on special_project_creators
  for each row execute function capture_audit('special_project_creator');

-- Summary view: proyecto progress
create or replace view v_project_summary as
select
  p.id,
  p.code,
  p.name,
  p.status,
  p.creators_needed,
  p.start_date,
  p.end_date,
  p.target_gmv,
  p.ads_budget,
  coalesce(cm_count, 0) as creators_assigned_cm,
  coalesce(acq_count, 0) as creators_assigned_acquisition,
  coalesce(cm_count, 0) + coalesce(acq_count, 0) as creators_assigned_total,
  coalesce(merchant_count, 0) as merchant_count,
  coalesce(actual_gmv, 0) as gmv_actual,
  case
    when p.target_gmv > 0 then round((coalesce(actual_gmv, 0)::numeric / p.target_gmv * 100)::numeric, 2)
    else null
  end as gmv_pct
from special_projects p
left join (
  select project_id, count(*) as cm_count
  from special_project_creators
  where filled_by = 'cm'
  group by project_id
) cm_agg on p.id = cm_agg.project_id
left join (
  select project_id, count(*) as acq_count
  from special_project_creators
  where filled_by = 'acquisition'
  group by project_id
) acq_agg on p.id = acq_agg.project_id
left join (
  select project_id, count(distinct merchant_id) as merchant_count
  from special_project_merchants
  group by project_id
) merch_agg on p.id = merch_agg.project_id
left join (
  select
    pc.project_id,
    sum(cps.affiliate_gmv) as actual_gmv
  from special_project_creators pc
  join creator_period_summary cps on pc.mcn_creator_id = cps.mcn_creator_id
  join special_projects sp on pc.project_id = sp.id
  where cps.period_start >= sp.start_date
    and cps.period_start <= sp.end_date
    -- Dedupe: take latest createdAt per (creator, period_start)
    and cps.id = (
      select id from creator_period_summary cps2
      where cps2.mcn_creator_id = cps.mcn_creator_id
        and cps2.period_start = cps.period_start
      order by cps2.created_at desc
      limit 1
    )
  group by pc.project_id
) gmv_agg on p.id = gmv_agg.project_id;

comment on view v_project_summary is 'Special project progress (creators assigned, GMV actual vs target).';

-- RLS
alter table special_projects enable row level security;
alter table special_project_merchants enable row level security;
alter table special_project_creators enable row level security;
alter table v_project_summary owner to postgres;

create policy special_projects_select on special_projects
  for select to authenticated using (
    is_od()
    or is_director()
    or is_lead()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition', 'Account')
  );

create policy special_projects_insert on special_projects
  for insert to authenticated
  with check (
    is_od()
    or is_director()
    or is_lead()
  );

create policy special_projects_update on special_projects
  for update to authenticated
  using (
    is_od()
    or is_director()
    or is_lead()
  )
  with check (
    is_od()
    or is_director()
    or is_lead()
  );

create policy project_merchants_select on special_project_merchants
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition', 'Account')
  );

create policy project_merchants_manage on special_project_merchants
  for all to authenticated
  using (
    is_od()
    or is_director()
    or (auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition') and is_lead())
  )
  with check (
    is_od()
    or is_director()
    or (auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition') and is_lead())
  );

create policy project_creators_select on special_project_creators
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition', 'Account')
  );

create policy project_creators_manage on special_project_creators
  for all to authenticated
  using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition')
  )
  with check (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition')
  );
