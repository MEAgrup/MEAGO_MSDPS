-- =============================================================================
-- MSDPS · Phase 0 · Migration 0007 — OKR engine (target + auto-achievement)
-- =============================================================================
-- Resolves OTA-1 (your confirmed feature). Purpose: HR/OD set quarterly team
-- targets; the system AUTO-checks achievement against real operational data — no
-- manual scoring (consistent with the derived-only philosophy of Module 14).
--
-- Decisions you made:
--   * Granularity: PER ROLE  (one target per scored role; matches M14 which
--     normalizes performance "relative to role target").
--   * Period: per QUARTER, freely changed each quarter (just insert new rows).
--   * Owners: OD + Director (jointly authorized to set/supersede targets).
--
-- The attainment VIEW (v_okr_attainment) is created in the Module 14 migration,
-- because it joins to performance_scores / division actuals that don't exist yet.
-- This migration creates the target table + the scored-role enum it shares with M14.
-- =============================================================================

-- Roles that are scored in Module 14 / measured by OKR.
-- (AM lives in the Account division; the others are their own divisions.)
create type perf_role as enum ('Ecommerce','Ads','KOL','AM');

create type okr_comparator as enum ('gte','lte');   -- gte: higher is better; lte: lower is better (cost)

create table okr_targets (
  id            uuid primary key default gen_random_uuid(),
  period        text not null,                 -- e.g. '2026-Q3'
  role          perf_role not null,
  metric        text not null,                 -- e.g. 'sku_approved_per_week', 'roas',
                                               -- 'videos_delivered', 'live_hours',
                                               -- 'merchant_health_avg'
  target_value  numeric not null,
  comparator    okr_comparator not null default 'gte',
  active        boolean not null default true,
  set_by        uuid references employees(id),
  created_at    timestamptz not null default now()
);

comment on table okr_targets is 'Quarterly per-role performance targets. Set by OD/Director. Achievement is auto-computed in v_okr_attainment (M14). Supersede by setting active=false, never edit history.';

-- Only one active target per (period, role, metric); supersession sets active=false.
create unique index okr_targets_active_uniq
  on okr_targets (period, role, metric) where active;

-- Capture changes to the audit log (targets are management-sensitive).
create trigger trg_audit_okr after insert or update on okr_targets
  for each row execute function capture_audit('okr_target');

-- RLS: Director/OD manage; division leads may read their own role's targets;
-- OD/Director read all.
alter table okr_targets enable row level security;

create policy okr_select on okr_targets
  for select to authenticated
  using (
    is_od() or is_director()
    or (is_lead() and (
         (role = 'Ecommerce' and auth_division() = 'Ecommerce') or
         (role = 'Ads'       and auth_division() = 'Ads') or
         (role = 'KOL'       and auth_division() = 'KOL') or
         (role = 'AM'        and auth_division() = 'Account')
       ))
  );

create policy okr_manage on okr_targets
  for all to authenticated
  using (is_od() or is_director())
  with check (is_od() or is_director());
