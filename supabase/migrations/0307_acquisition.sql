-- =============================================================================
-- MSDPS · MCN MEA Features · Migration 0307 — Acquisition & referrals
-- =============================================================================
-- acquisitions: new creator binding with commission snapshot & GMV windows.
-- referrals: inter-creator vs platform referrals with guard constraint.
-- =============================================================================

create table acquisitions (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                         -- ACQ-YYYYMM-NNNN
  mcn_creator_id      uuid not null references mcn_creators(id) on delete cascade,
  specialist_id       uuid not null references employees(id) on delete restrict,  -- forced = actor
  lead_source         text not null check (lead_source in ('inbound', 'outbound', 'platform')),
  binding_date        date not null,
  commission_share_at_binding numeric,                     -- snapshot at binding time
  gmv_last_30d        numeric,                             -- last 30d pre-binding (baseline log)
  gmv_post_join       numeric,                             -- Σ post-join in window (config: 90d)
  gmv_quarter_actual  numeric,                             -- Σ in [binding, quarter_end]
  quarter_end         date,                                -- end of calendar quarter at binding_date
  handoff_done        boolean not null default false,
  notes               text,
  created_at          timestamptz not null default now()
);

comment on table acquisitions is 'Creator acquisition binding with commission snapshot & GMV tracking.';

create or replace function acquisitions_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null then
    new.code := next_code('ACQ');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  -- Force specialist_id = current actor on insert
  if tg_op = 'INSERT' then
    new.specialist_id := auth.uid();
  end if;

  -- Calculate quarter_end if not set
  if new.quarter_end is null and new.binding_date is not null then
    new.quarter_end := date_trunc('quarter', new.binding_date)::date + interval '3 months - 1 day'::interval;
  end if;

  return new;
end $$;

create trigger trg_acquisitions_validate before insert or update on acquisitions
  for each row execute function acquisitions_validate();
create trigger trg_acquisitions_audit after insert or update on acquisitions
  for each row execute function capture_audit('acquisition');

-- Referrals (inter-creator or platform)
create table referrals (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                           -- RFR-YYYYMM-NNNN
  new_creator_id    uuid not null references mcn_creators(id) on delete cascade,
  referrer_creator_id uuid references mcn_creators(id) on delete set null,
  referral_source   text not null check (referral_source in ('antar_creator', 'platform')),
  commission_status text not null default 'pending' check (commission_status in ('pending', 'dibayar')),
  recorded_by       uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  -- Guard: antar_creator must have referrer, platform must not
  check (
    (referral_source = 'antar_creator' and referrer_creator_id is not null)
    or (referral_source = 'platform' and referrer_creator_id is null)
  )
);

comment on table referrals is 'Creator referrals (antar-creator or platform). commission_status tracks payment.';

create or replace function referrals_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null then
    new.code := next_code('RFR');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  return new;
end $$;

create trigger trg_referrals_validate before insert or update on referrals
  for each row execute function referrals_validate();
create trigger trg_referrals_audit after insert or update on referrals
  for each row execute function capture_audit('referral');

-- RLS
alter table acquisitions enable row level security;
alter table referrals enable row level security;

create policy acquisitions_select on acquisitions
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() = 'Acquisition'
  );

create policy acquisitions_insert on acquisitions
  for insert to authenticated
  with check (
    is_od()
    or is_director()
    or auth_division() = 'Acquisition'
  );

create policy acquisitions_update on acquisitions
  for update to authenticated
  using (
    is_od()
    or is_director()
    or (auth_division() = 'Acquisition' and (
      specialist_id = auth_emp_id() or is_lead()
    ))
  )
  with check (
    is_od()
    or is_director()
    or (auth_division() = 'Acquisition' and (
      specialist_id = auth_emp_id() or is_lead()
    ))
  );

create policy referrals_select on referrals
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() = 'Acquisition'
  );

create policy referrals_manage on referrals
  for all to authenticated
  using (
    is_od()
    or is_director()
    or auth_division() = 'Acquisition'
  )
  with check (
    is_od()
    or is_director()
    or auth_division() = 'Acquisition'
  );
