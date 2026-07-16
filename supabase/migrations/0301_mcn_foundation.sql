-- =============================================================================
-- MSDPS · MCN · Migration 0301 — Fondasi: app_config + platform_alerts
-- =============================================================================
-- app_config     : key/value jsonb runtime-config (belum ada di MSDPS). Dipakai
--                  ingest & alert (perf_drop, price_bounds, top-N, dll). Dibaca
--                  semua authenticated; hanya OD/Director yang boleh mengubah.
-- platform_alerts: notifikasi operasional (perf_drop / link_bocor / deal_expiring)
--                  ke member CM pemilik. code ALRT-YYYYMM-NNNN. Bukan lifecycle
--                  state-machine (cukup flag resolved), tetap ter-audit.
-- =============================================================================

-- ---- app_config -------------------------------------------------------------
create table app_config (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

comment on table app_config is 'Runtime config MCN (key/value jsonb). Read: all authenticated; manage: OD/Director.';

insert into app_config (key, value) values
  ('mcn.perf_drop',         '0.15'::jsonb),
  ('mcn.gmv_post_join_days','90'::jsonb),
  ('mcn.top_n_products',    '20'::jsonb),
  ('mcn.deal_expiring_days','14'::jsonb),
  ('mcn.price_bounds',      '{"low":180000,"entry":800000,"sweet":3600000,"high":8000000}'::jsonb);

alter table app_config enable row level security;
create policy app_config_select on app_config for select to authenticated using (true);
create policy app_config_manage on app_config for all to authenticated
  using (is_od() or is_director())
  with check (is_od() or is_director());

-- ---- platform_alerts --------------------------------------------------------
create table platform_alerts (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                                  -- ALRT-YYYYMM-NNNN
  alert_type        text not null check (alert_type in ('perf_drop','link_bocor','deal_expiring')),
  mcn_creator_id    uuid,                                         -- kreator terkait (opsional; tanpa FK — alert bisa shop-only)
  shop_id           text,
  target_member_id  uuid references employees(id),
  detail            jsonb,
  resolved          boolean not null default false,
  resolved_at       timestamptz,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now()
);

create index platform_alerts_target_idx on platform_alerts (target_member_id, resolved);
create index platform_alerts_type_idx on platform_alerts (alert_type, resolved);

create or replace function platform_alerts_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.alert_type is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.resolved and new.resolved_at is null then
    new.resolved_at := now();
  end if;
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
create policy platform_alerts_select on platform_alerts for select to authenticated
  using (
    is_od() or is_director()
    or target_member_id = auth_emp_id()
    or auth_division() in ('CreatorManagement','BizDev')
  );
create policy platform_alerts_insert on platform_alerts for insert to authenticated
  with check (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev'));
create policy platform_alerts_update on platform_alerts for update to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev'));

revoke execute on function platform_alerts_validate() from public, anon, authenticated;
