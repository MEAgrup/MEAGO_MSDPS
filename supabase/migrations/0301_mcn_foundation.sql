-- =============================================================================
-- MSDPS · MCN MEA Features · Migration 0301 — Foundation (config + alerts)
-- =============================================================================
-- app_config: key-value store for MCN operational settings (perf thresholds, windows, etc).
-- platform_alerts: system-generated and manual alerts for performance & expiry tracking.
-- =============================================================================

create table app_config (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references employees(id) on delete set null,
  updated_at  timestamptz default now()
);

comment on table app_config is 'System configuration (key-value store). RLS: select authenticated, manage OD/Director.';

-- Seed default config values
insert into app_config (key, value, updated_at) values
  ('mcn.perf_drop', '0.15'::jsonb, now()),
  ('mcn.gmv_post_join_days', '90'::jsonb, now()),
  ('mcn.top_n_products', '20'::jsonb, now()),
  ('mcn.price_bounds', '{"low": 180000, "entry": 800000, "sweet": 3600000, "high": 8000000}'::jsonb, now()),
  ('mcn.deal_expiring_days', '14'::jsonb, now())
on conflict (key) do nothing;

alter table app_config enable row level security;

create policy app_config_select on app_config
  for select to authenticated using (true);

create policy app_config_manage on app_config
  for all to authenticated
  using (is_od() or is_director())
  with check (is_od() or is_director());

-- Platform alerts: perf_drop, deal_expiring, link_bocor, etc.
create table platform_alerts (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                           -- ALRT-YYYYMM-NNNN
  alert_type        text not null,
  check (alert_type in ('perf_drop', 'link_bocor', 'deal_expiring')),
  mcn_creator_id    uuid references mcn_creators(id) on delete cascade,
  shop_id           text,
  target_member_id  uuid references employees(id) on delete cascade,
  detail            jsonb,
  resolved          boolean not null default false,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz
);

comment on table platform_alerts is 'System + manual alerts (perf drop, deal expiring, link bocor). Auto-resolved by system.';

create or replace function platform_alerts_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null then
    new.code := next_code('ALRT');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_platform_alerts_validate before insert or update on platform_alerts
  for each row execute function platform_alerts_validate();
create trigger trg_platform_alerts_audit after insert or update on platform_alerts
  for each row execute function capture_audit('platform_alert');

alter table platform_alerts enable row level security;

create policy platform_alerts_select on platform_alerts
  for select to authenticated using (
    target_member_id = auth_emp_id()
    or is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev')
  );

create policy platform_alerts_insert on platform_alerts
  for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');

create policy platform_alerts_update on platform_alerts
  for update to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement')
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');
