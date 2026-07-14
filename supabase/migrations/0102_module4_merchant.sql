-- =============================================================================
-- MSDPS · Fase B · Module 4 — Merchant Record (`MER-…`, `SVC-…`) + Service Catalog
-- =============================================================================
-- Merchant is born at closing (via close_deal RPC in M5). À la carte Services;
-- targets are set later by Account (M6), so target_fields may be null at closing.
-- =============================================================================

create type service_type as enum
  ('KOL-Video','KOL-Live','E-commerce','Ads','Live Stream');
create type service_status as enum ('[Active]','[Voided]','[Completed]');
create type payment_intent as enum ('Lunas','Bayar Sebagian','Termin','Bayar di Belakang');

-- Closed catalog (M4 §3). requires_strategy_plan per M6-OA-8.
create table service_catalog (
  service_type            service_type primary key,
  division                division not null,
  requires_strategy_plan  boolean not null,
  target_spec             text
);
insert into service_catalog (service_type, division, requires_strategy_plan, target_spec) values
  ('KOL-Video',  'KOL',        true,  'Target Creator Count, Target Video Count'),
  ('KOL-Live',   'KOL',        true,  'Total Live Hours'),
  ('E-commerce', 'Ecommerce',  false, 'Target SKU Count'),
  ('Ads',        'Ads',        true,  'Target ROAS, Ads Budget'),
  ('Live Stream','LiveStream', false, 'Target metric(s), flexible per merchant');

create table package_catalog (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  included_service_types service_type[] not null
);

create table merchants (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,                    -- MER-YYYYMM-NNNN
  nama_toko          text not null,
  kota               text not null,
  link_toko          text not null,
  kategori           text not null,
  origin_campaign_id uuid references campaigns(id),
  source_attempt_id  uuid references prospect_attempts(id),
  gmv_baseline       numeric not null,               -- frozen at closing
  target_gmv         numeric not null,               -- revisable by Account
  total_revenue      numeric not null default 0,     -- DERIVED (hybrid, M4/M13)
  payment_intent     payment_intent,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now()
);

comment on table merchants is 'Merchant record (M4). Born at closing. total_revenue is derived/read-only.';

create table merchant_platforms (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references merchants(id) on delete cascade,
  platform     text not null,
  store_link   text,
  date_managed date,
  active       boolean not null default true
);

create table services (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique,                 -- SVC-YYYYMM-NNNN
  merchant_id            uuid not null references merchants(id),
  service_type           service_type not null,
  source_package_id      uuid references package_catalog(id),
  requires_strategy_plan boolean,                     -- inherited from catalog if null
  execution_path         text generated always as
                           (case when requires_strategy_plan then 'Plan-gated' else 'Direct' end) stored,
  target_fields          jsonb,                       -- set by Account (M6)
  status                 service_status not null default '[Active]',
  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  status_changed_by      uuid,
  status_changed_at      timestamptz
);

-- ---- Merchant validation + ID ----
create or replace function merchants_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.nama_toko is null or btrim(new.nama_toko) = ''
     or new.kota is null or btrim(new.kota) = ''
     or new.link_toko is null or btrim(new.link_toko) = ''
     or new.kategori is null or btrim(new.kategori) = ''
     or new.gmv_baseline is null or new.target_gmv is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.code is null then
    new.code := next_code('MER');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_merchants_validate before insert or update on merchants
  for each row execute function merchants_validate();
create trigger trg_merchants_audit after insert or update on merchants
  for each row execute function capture_audit('merchant');

-- ---- Service validation + ID (inherits plan flag from catalog) ----
create or replace function services_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.merchant_id is null or new.service_type is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.requires_strategy_plan is null then
    select requires_strategy_plan into new.requires_strategy_plan
    from service_catalog where service_type = new.service_type;
  end if;
  if new.code is null then
    new.code := next_code('SVC');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_services_validate before insert or update on services
  for each row execute function services_validate();
create trigger trg_services_status before update on services
  for each row execute function enforce_status_transition('service');
create trigger trg_services_audit after insert or update on services
  for each row execute function capture_audit('service');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('service','[Active]','[Voided]',    null),
  ('service','[Active]','[Completed]', null);

-- ---- RLS ----
alter table service_catalog enable row level security;
create policy catalog_select on service_catalog for select to authenticated using (true);
create policy catalog_manage on service_catalog for all to authenticated
  using (is_od() or is_director() or (is_lead() and auth_division()='Account'))
  with check (is_od() or is_director() or (is_lead() and auth_division()='Account'));

alter table package_catalog enable row level security;
create policy package_select on package_catalog for select to authenticated using (true);
create policy package_manage on package_catalog for all to authenticated
  using (is_od() or is_director() or (is_lead() and auth_division()='Account'))
  with check (is_od() or is_director() or (is_lead() and auth_division()='Account'));

alter table merchants enable row level security;
create policy merchants_select on merchants for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','Account','Finance'));
create policy merchants_update on merchants for update to authenticated
  using (is_od() or is_director() or auth_division() = 'Account');

alter table merchant_platforms enable row level security;
create policy platforms_select on merchant_platforms for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','Account','Finance'));
create policy platforms_manage on merchant_platforms for all to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','Account'))
  with check (is_od() or is_director() or auth_division() in ('BizDev','Account'));

alter table services enable row level security;
create policy services_select on services for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','Account','Finance','Ecommerce','Ads','KOL','LiveStream'));
create policy services_update on services for update to authenticated
  using (is_od() or is_director() or auth_division() = 'Account');
