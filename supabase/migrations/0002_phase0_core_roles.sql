-- =============================================================================
-- MSDPS · Phase 0 · Migration 0002 — Core roles, employees, RLS helper functions
-- =============================================================================
-- Implements Phase 0 §2.7 / §4 role model:
--   Staff      -> own data only
--   Lead/SPV   -> division dashboard  (we model Lead = Head = SPV as rank 'lead')
--   OD         -> read-only across operations + manages OKR  (layered flag)
--   Director   -> full view + manage employees               (layered flag)
--
-- Representational note (no logic change): the PRD's many division-specific role
-- names (Finance Staff, AM, Account SPV, KOL Coordinator, Ads Lead, ...) are
-- modeled as the pair (division, rank) + layered flags. The matrix semantics are
-- preserved exactly; only the naming is normalized.
-- =============================================================================

-- The eight divisions of MSDPS (Phase 0 §1 branch point + §4 matrix).
create type division as enum (
  'Marketing','BizDev','Finance','Account','Ecommerce','Ads','KOL','LiveStream'
);

-- Rank within a division. 'lead' = Lead / Head / Supervisor (SPV).
create type emp_rank as enum ('staff','lead');

-- One account per employee (Phase 0 §2.7). OD/Director are layered booleans.
create table employees (
  id           uuid primary key references auth.users(id) on delete restrict,
  full_name    text not null,
  division     division not null,
  rank         emp_rank not null default 'staff',
  is_od        boolean not null default false,
  is_director  boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

comment on table employees is 'Internal MSDPS users. Mirrors auth.users 1:1. Layered roles via is_od / is_director.';

-- -----------------------------------------------------------------------------
-- RLS helper functions. All SECURITY DEFINER so they read employees as the
-- table owner and never trip RLS recursion. STABLE so the planner can cache them
-- within a statement.
-- -----------------------------------------------------------------------------

create or replace function auth_emp_id() returns uuid
  language sql stable as $$ select auth.uid() $$;

create or replace function auth_division() returns division
  language sql stable security definer set search_path = public as $$
  select division from employees where id = auth.uid()
$$;

create or replace function auth_rank() returns emp_rank
  language sql stable security definer set search_path = public as $$
  select rank from employees where id = auth.uid()
$$;

create or replace function is_lead() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select rank = 'lead' from employees where id = auth.uid()), false)
$$;

create or replace function is_od() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select is_od from employees where id = auth.uid()), false)
$$;

create or replace function is_director() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select is_director from employees where id = auth.uid()), false)
$$;

-- Returns the actor's authority tokens, e.g. {'staff'} or {'lead','od'} or
-- {'lead','director'}. Used by the state-machine engine to gate transitions
-- (e.g. the global escalation rule: approval requires >= SPV i.e. 'lead').
create or replace function actor_tokens() returns text[]
  language sql stable security definer set search_path = public as $$
  select array_remove(array[
    (select rank::text from employees where id = auth.uid()),
    case when (select is_od from employees where id = auth.uid()) then 'od' end,
    case when (select is_director from employees where id = auth.uid()) then 'director' end
  ], null)
$$;

-- -----------------------------------------------------------------------------
-- RLS on employees: everyone internal may read the directory (needed for
-- assignee pickers, dashboards). Only Director or OD (HR function) may manage.
-- -----------------------------------------------------------------------------
alter table employees enable row level security;

create policy employees_select_all on employees
  for select to authenticated using (true);

create policy employees_manage on employees
  for all to authenticated
  using (is_director() or is_od())
  with check (is_director() or is_od());
