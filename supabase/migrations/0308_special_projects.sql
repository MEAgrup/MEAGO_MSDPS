-- =============================================================================
-- MSDPS · MCN · Migration 0308 — Special Project & Campaign (`SPJ-…`)
-- =============================================================================
-- special_projects        : Lead/OD/Director mendaftarkan project (target kreator,
--                           rentang tanggal, ads budget, target GMV, kategori
--                           industri). code SPJ-YYYYMM-NNNN. Lifecycle
--                           draft→active→done/cancelled (transisi allowed_tokens
--                           {lead,od,director}).
-- special_project_merchants: merchant peserta (FK merchants M4).
-- special_project_creators : kreator ter-assign. filled_by DIPAKSA dari divisi
--                           actor (CreatorManagement→'cm', Acquisition→'acquisition';
--                           mgmt bebas).
-- v_project_summary (security_invoker) : ringkasan terisi cm/akuisisi vs target +
--                           GMV aktual = Σ affiliate_gmv kreator ter-assign dengan
--                           period_start dalam [start_date,end_date], dedupe per
--                           creator×period_start ambil created_at terbaru.
-- =============================================================================

create table special_projects (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                                  -- SPJ-YYYYMM-NNNN
  name              text not null,
  industry_category text not null
                      check (industry_category in ('Dining','Accommodation','Things to Do')),
  start_date        date not null,
  end_date          date not null,
  ads_budget        numeric,
  target_gmv        numeric,
  creators_needed   int not null,
  description       text,
  status            text not null default 'draft'
                      check (status in ('draft','active','done','cancelled')),
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz,
  constraint chk_project_dates check (end_date >= start_date)
);

create or replace function special_projects_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is null or btrim(new.name) = ''
     or new.industry_category is null
     or new.start_date is null or new.end_date is null
     or new.creators_needed is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
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
  ('special_project','draft','active',     '{lead,od,director}'),
  ('special_project','active','done',      '{lead,od,director}'),
  ('special_project','active','cancelled', '{lead,od,director}'),
  ('special_project','draft','cancelled',  '{lead,od,director}');

-- ---- Merchant peserta -------------------------------------------------------
create table special_project_merchants (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references special_projects(id) on delete cascade,
  merchant_id uuid not null references merchants(id),
  added_by    uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (project_id, merchant_id)
);

create trigger trg_spm_audit after insert or update on special_project_merchants
  for each row execute function capture_audit('special_project_merchant');

-- ---- Kreator ter-assign -----------------------------------------------------
create table special_project_creators (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references special_projects(id) on delete cascade,
  mcn_creator_id uuid not null references mcn_creators(id),
  filled_by      text not null check (filled_by in ('cm','acquisition')),
  assigned_by    uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (project_id, mcn_creator_id)
);

-- filled_by dipaksa dari divisi actor (mgmt bebas menetapkan).
create or replace function special_project_creators_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.assigned_by := coalesce(new.assigned_by, auth.uid());
    -- mgmt (OD/Director) bebas menetapkan filled_by; divisi lain dipaksa.
    if not (is_od() or is_director()) then
      if auth_division() = 'CreatorManagement' then
        new.filled_by := 'cm';
      elsif auth_division() = 'Acquisition' then
        new.filled_by := 'acquisition';
      end if;
    end if;
    if new.filled_by is null then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger trg_spc_fill before insert on special_project_creators
  for each row execute function special_project_creators_fill();
create trigger trg_spc_audit after insert or update on special_project_creators
  for each row execute function capture_audit('special_project_creator');

-- ---- View ringkasan (security_invoker: RLS base table berlaku bagi pemanggil)
create view v_project_summary with (security_invoker = true) as
with dedup as (
  -- Dedupe per (creator, period_start): ambil baris created_at terbaru.
  select distinct on (cps.mcn_creator_id, cps.period_start)
    cps.mcn_creator_id, cps.period_start, cps.affiliate_gmv
  from creator_period_summary cps
  order by cps.mcn_creator_id, cps.period_start, cps.created_at desc
)
select
  p.id,
  p.code,
  p.name,
  p.industry_category,
  p.start_date,
  p.end_date,
  p.ads_budget,
  p.target_gmv,
  p.creators_needed,
  p.status,
  count(distinct a.mcn_creator_id)                                            as creators_assigned,
  count(distinct a.mcn_creator_id) filter (where a.filled_by = 'cm')          as creators_cm,
  count(distinct a.mcn_creator_id) filter (where a.filled_by = 'acquisition') as creators_acquisition,
  (select count(*) from special_project_merchants m where m.project_id = p.id) as merchant_count,
  coalesce(sum(d.affiliate_gmv), 0)                                            as actual_gmv,
  case when coalesce(p.target_gmv, 0) > 0
       then round(coalesce(sum(d.affiliate_gmv), 0) / p.target_gmv * 100, 1)
       else null end                                                          as pct_gmv
from special_projects p
left join special_project_creators a on a.project_id = p.id
left join dedup d
  on d.mcn_creator_id = a.mcn_creator_id
  and d.period_start between p.start_date and p.end_date
group by p.id;

grant select on v_project_summary to authenticated;

-- ---- RLS --------------------------------------------------------------------
-- Baca: semua divisi terkait (CM/BizDev/Acquisition/Account) + mgmt.
-- Insert project: Lead/OD/Director. Assignment write: CM & Acquisition & mgmt.
alter table special_projects enable row level security;
create policy special_projects_select on special_projects for select to authenticated
  using (is_od() or is_director()
         or auth_division() in ('CreatorManagement','BizDev','Acquisition','Account'));
create policy special_projects_insert on special_projects for insert to authenticated
  with check (is_lead() or is_od() or is_director());
create policy special_projects_update on special_projects for update to authenticated
  using (is_lead() or is_od() or is_director());

alter table special_project_merchants enable row level security;
create policy spm_select on special_project_merchants for select to authenticated
  using (is_od() or is_director()
         or auth_division() in ('CreatorManagement','BizDev','Acquisition','Account'));
create policy spm_manage on special_project_merchants for all to authenticated
  using (is_od() or is_director() or is_lead()
         or auth_division() in ('CreatorManagement','BizDev','Acquisition'))
  with check (is_od() or is_director() or is_lead()
              or auth_division() in ('CreatorManagement','BizDev','Acquisition'));

alter table special_project_creators enable row level security;
create policy spc_select on special_project_creators for select to authenticated
  using (is_od() or is_director()
         or auth_division() in ('CreatorManagement','BizDev','Acquisition','Account'));
create policy spc_insert on special_project_creators for insert to authenticated
  with check (is_od() or is_director()
              or auth_division() in ('CreatorManagement','Acquisition'));
create policy spc_delete on special_project_creators for delete to authenticated
  using (is_od() or is_director()
         or auth_division() in ('CreatorManagement','Acquisition'));

revoke execute on function special_projects_validate()      from public, anon, authenticated;
revoke execute on function special_project_creators_fill()  from public, anon, authenticated;
