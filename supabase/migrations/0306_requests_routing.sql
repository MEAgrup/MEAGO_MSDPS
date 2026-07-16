-- =============================================================================
-- MSDPS · MCN MEA Features · Migration 0306 — Requests & campaign routing
-- =============================================================================
-- creator_requests: sample/ads/hsl with approval gate for ads over budget.
-- campaign_requests: deal routing state machine (CM confirm → brand acc → final → handover).
-- =============================================================================

create table creator_requests (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,                             -- REQ-YYYYMM-NNNN
  mcn_creator_id  uuid not null references mcn_creators(id) on delete cascade,
  type            text not null check (type in ('sample', 'ads', 'hsl')),
  target_brand    text,
  detail          text,
  status          text not null default 'diajukan' check (status in ('diajukan', 'diproses', 'selesai', 'ditolak')),
  needs_approval  boolean not null default false,         -- true if ads over budget cap
  approved_by     uuid references employees(id) on delete set null,  -- Director only
  approved_at     timestamptz,
  requested_by    uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz
);

comment on table creator_requests is 'Creator sample/ads/hsl requests with approval gate.';

create or replace function creator_requests_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null then
    new.code := next_code('REQ');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  -- Validate approval for needs_approval transitions
  if tg_op = 'UPDATE' and new.status = 'diproses' and old.status = 'diajukan' then
    if new.needs_approval and new.approved_by is null then
      raise exception '[request ads melebihi budget cap — butuh approval Director]' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

create trigger trg_creator_requests_validate before insert or update on creator_requests
  for each row execute function creator_requests_validate();
create trigger trg_creator_requests_status before update on creator_requests
  for each row execute function enforce_status_transition('creator_request');
create trigger trg_creator_requests_audit after insert or update on creator_requests
  for each row execute function capture_audit('creator_request');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('creator_request', 'diajukan', 'diproses', null),
  ('creator_request', 'diajukan', 'ditolak', null),
  ('creator_request', 'diproses', 'selesai', null);

-- Campaign routing: deal → CM confirm → brand acc → final → handover
create table campaign_requests (
  id              uuid primary key default gen_random_uuid(),
  code            text unique,                             -- CRQ-YYYYMM-NNNN
  deal_id         uuid not null references brand_deals(id) on delete cascade,
  mcn_creator_id  uuid not null references mcn_creators(id) on delete cascade,
  owner_cpm_id    uuid references employees(id) on delete set null,  -- auto-derived from mcn_creator
  cm_confirm_status text not null default 'menunggu' check (cm_confirm_status in ('menunggu', 'mau', 'tidak')),
  needs_brand_acc  boolean not null default false,
  brand_acc_status text not null default 'n_a' check (brand_acc_status in ('n_a', 'menunggu', 'approved', 'ditolak')),
  final_status    text not null default 'proses' check (final_status in ('proses', 'fix', 'batal')),
  handover_done   boolean not null default false,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);

comment on table campaign_requests is 'Deal routing: CM → brand → final → handover state machine.';

create or replace function campaign_requests_derive_cpm()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Auto-derive owner_cpm from mcn_creator on insert
  if tg_op = 'INSERT' and new.owner_cpm_id is null then
    new.owner_cpm_id := (select owner_cpm_id from mcn_creators where id = new.mcn_creator_id);
  end if;
  return new;
end $$;

create trigger trg_campaign_requests_derive_cpm before insert on campaign_requests
  for each row execute function campaign_requests_derive_cpm();
create trigger trg_campaign_requests_audit after insert or update on campaign_requests
  for each row execute function capture_audit('campaign_request');

-- RLS
alter table creator_requests enable row level security;
alter table campaign_requests enable row level security;

create policy creator_requests_select on creator_requests
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev')
  );

create policy creator_requests_insert on creator_requests
  for insert to authenticated
  with check (
    is_od()
    or is_director()
    or (auth_division() = 'CreatorManagement' and (
      is_lead() or (select owner_cpm_id from mcn_creators where id = mcn_creator_id) = auth_emp_id()
    ))
  );

create policy creator_requests_update on creator_requests
  for update to authenticated
  using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev')
  )
  with check (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev')
  );

create policy campaign_requests_select on campaign_requests
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev')
  );

create policy campaign_requests_manage on campaign_requests
  for all to authenticated
  using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev')
  )
  with check (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev')
  );
