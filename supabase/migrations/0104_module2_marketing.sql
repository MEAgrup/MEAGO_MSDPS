-- =============================================================================
-- MSDPS · Fase B · Module 2 — Marketing Performance Record + auto-metrics
-- =============================================================================
-- One record per campaign (no PREFIX id). All metrics are DERIVED via a view:
-- CPL, CPRL, Lead-Quality Rate, Attributed Revenue (last-touch), ROAS, Collected-ROAS.
-- =============================================================================

create table marketing_performance_records (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references campaigns(id),
  budget      numeric not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create or replace function mpr_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.budget is null or new.budget <= 0 then
    raise exception '[budget wajib diisi dan harus lebih dari 0]' using errcode='check_violation';
  end if;
  return new;
end $$;
create trigger trg_mpr_validate before insert or update on marketing_performance_records
  for each row execute function mpr_validate();
create trigger trg_mpr_audit after insert or update on marketing_performance_records
  for each row execute function capture_audit('marketing_performance_record');

alter table marketing_performance_records enable row level security;
create policy mpr_select on marketing_performance_records for select to authenticated
  using (is_od() or is_director() or auth_division()='Marketing');
create policy mpr_manage on marketing_performance_records for all to authenticated
  using (is_od()=false and (auth_division()='Marketing' or is_director()))
  with check (auth_division()='Marketing' or is_director());

-- Auto-metrics. security_invoker so it honours the caller's RLS.
create or replace view v_marketing_metrics
with (security_invoker = true) as
with dash as (
  select origin_campaign_id as campaign_id, count(*) as lead_by_dashboard
  from leads where origin_campaign_id is not null group by 1
),
realq as (
  select l.origin_campaign_id as campaign_id, count(distinct l.id) as lead_real
  from leads l
  join prospect_attempts a on a.parent_lead_id = l.id
  where l.origin_campaign_id is not null
    and a.status in ('[Qualified]','[Negotiation]','[Closed - Success]')
  group by 1
),
rev as (
  select coalesce(l.last_touch_campaign_id, l.origin_campaign_id) as campaign_id,
         sum(t.total_agreed_value) as attributed_revenue,
         sum(t.amount_verified)    as collected_revenue
  from merchants m
  join prospect_attempts a on a.id = m.source_attempt_id
  join leads l             on l.id = a.parent_lead_id
  join transactions t      on t.merchant_id = m.id
  group by 1
)
select
  c.id                                as campaign_id,
  c.code                              as campaign_code,
  mpr.budget,
  coalesce(dash.lead_by_dashboard,0)  as lead_by_dashboard,
  coalesce(realq.lead_real,0)         as lead_real_by_sales,
  case when coalesce(dash.lead_by_dashboard,0)=0 then null
       else round(coalesce(realq.lead_real,0)::numeric / dash.lead_by_dashboard * 100, 1) end as lead_quality_rate,
  coalesce(rev.attributed_revenue,0)  as attributed_revenue,
  round(mpr.budget / nullif(dash.lead_by_dashboard,0), 0) as cost_per_lead,
  round(mpr.budget / nullif(realq.lead_real,0), 0)        as cost_per_real_lead,
  round(coalesce(rev.attributed_revenue,0) / nullif(mpr.budget,0), 2) as roas,
  round(coalesce(rev.collected_revenue,0)  / nullif(mpr.budget,0), 2) as collected_roas
from campaigns c
join marketing_performance_records mpr on mpr.campaign_id = c.id
left join dash  on dash.campaign_id  = c.id
left join realq on realq.campaign_id = c.id
left join rev   on rev.campaign_id   = c.id;
