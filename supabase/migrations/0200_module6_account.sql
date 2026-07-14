-- =============================================================================
-- MSDPS · Fase C · Module 6 — Account & Service (`STR-…`, `BRF-…`, `CPL-…`)
-- =============================================================================
-- Translation layer between "merchant bought a Service" (M4) and "execution
-- teams have work" (M7–M10). Adds: AM assignment (manual, SPV/Head Account),
-- per-Service Execution Path (Plan-gated vs Direct) on a second lifecycle
-- column, Strategy & Plan (1:1 per Service), Brief (one-division fan-out,
-- Live Stream AM-forward exception), Complaints (two doors in Fase 1),
-- Package decomposition in close_deal().
-- =============================================================================

-- ---- Merchant: AM assignment (M6 §3) ----------------------------------------
alter table merchants
  add column am_id                uuid references employees(id),
  add column am_assigned_by       uuid references employees(id),
  add column am_assigned_at       timestamptz,
  add column am_assignment_reason text;

comment on column merchants.am_id is 'Account Manager pemilik seluruh relasi merchant (M6 §3). Diisi hanya via assign_am().';

-- ---- Service: Execution Path lifecycle (M6 §2) -------------------------------
-- services.status (M4: Active/Voided/Completed) = commercial state; the Account
-- execution path lives in a second column with its own data-driven machine.
create type service_exec_status as enum (
  '[Awaiting Onboarding]','[Strategy Drafting]','[Strategy Submitted for Approval]',
  '[Strategy Approved]','[Direct Breakdown]','[Briefed]','[In Execution]'
);

alter table services
  add column execution_status service_exec_status not null default '[Awaiting Onboarding]';

-- Clone of enforce_status_transition() for the execution_status column
-- (the generic engine is hard-wired to `status`).
create or replace function enforce_execution_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_allowed text[];
  v_found   boolean;
begin
  if new.execution_status is distinct from old.execution_status then
    select allowed_tokens, true into v_allowed, v_found
    from status_transitions
    where entity = 'service_execution'
      and from_status = old.execution_status::text
      and to_status   = new.execution_status::text;

    if not coalesce(v_found, false) then
      raise exception '[transisi status tidak diizinkan: % → %]', old.execution_status, new.execution_status
        using errcode = 'check_violation';
    end if;
    if v_allowed is not null and not (v_allowed && actor_tokens()) then
      raise exception '[anda tidak berwenang melakukan transisi status ini]'
        using errcode = 'insufficient_privilege';
    end if;
    new.status_changed_by := auth.uid();
    new.status_changed_at := now();
  end if;
  return new;
end $$;

create trigger trg_services_exec_status before update on services
  for each row execute function enforce_execution_transition();

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('service_execution','[Awaiting Onboarding]','[Strategy Drafting]',                null),
  ('service_execution','[Strategy Drafting]','[Strategy Submitted for Approval]',    null),
  ('service_execution','[Strategy Submitted for Approval]','[Strategy Drafting]',    null),
  ('service_execution','[Strategy Submitted for Approval]','[Strategy Approved]',    null),
  ('service_execution','[Strategy Approved]','[Briefed]',                            null),
  ('service_execution','[Awaiting Onboarding]','[Direct Breakdown]',                 null),
  ('service_execution','[Direct Breakdown]','[Briefed]',                             null),
  ('service_execution','[Awaiting Onboarding]','[Briefed]',                          null),
  ('service_execution','[Briefed]','[In Execution]',                                 null);

-- =============================================================================
-- Strategy & Plan (`STR-…`) — 1:1 per Plan-gated Service (M6 §4)
-- =============================================================================
create type strategy_status as enum (
  '[Strategy Drafting]','[Strategy Submitted for Approval]','[Strategy Approved]'
);

create table strategies (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                    -- STR-YYYYMM-NNNN
  service_id        uuid not null unique references services(id),
  objective         text not null,
  target_kpis       text not null,                  -- di-set Account (M4-OA-10)
  outline           text not null,                  -- konten per Service Type (M6 §4 Rule 2)
  timeline_start    date not null,
  timeline_end      date not null,
  status            strategy_status not null default '[Strategy Drafting]',
  approved_by       uuid references employees(id),
  revision_count    int not null default 0,
  revision_notes    text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz
);

create or replace function strategies_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_svc services%rowtype;
  v_am  uuid;
begin
  if new.service_id is null
     or new.objective is null or btrim(new.objective) = ''
     or new.target_kpis is null or btrim(new.target_kpis) = ''
     or new.outline is null or btrim(new.outline) = ''
     or new.timeline_start is null or new.timeline_end is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  select * into v_svc from services where id = new.service_id;

  if tg_op = 'INSERT' then
    if not coalesce(v_svc.requires_strategy_plan, false) then
      raise exception '[service ini Direct path, tidak memerlukan Strategy Plan]'
        using errcode = 'check_violation';
    end if;
    if v_svc.status <> '[Active]' then
      raise exception '[service tidak aktif]' using errcode = 'check_violation';
    end if;
    select am_id into v_am from merchants where id = v_svc.merchant_id;
    if v_am is null then
      raise exception '[merchant belum memiliki AM, minta SPV Account melakukan assignment]'
        using errcode = 'check_violation';
    end if;
    if not (is_od() or is_director()
            or (auth_division() = 'Account' and (is_lead() or v_am = auth.uid()))) then
      raise exception '[hanya AM merchant ini yang dapat membuat Strategy Plan]'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- SPV mengembalikan untuk revisi: catatan wajib, Revision Count naik.
    if new.status = '[Strategy Drafting]' and old.status = '[Strategy Submitted for Approval]' then
      if new.revision_notes is null or btrim(new.revision_notes) = '' then
        raise exception '[catatan revisi wajib diisi]' using errcode = 'check_violation';
      end if;
      new.revision_count := old.revision_count + 1;
    end if;
    if new.status = '[Strategy Approved]' and old.status is distinct from new.status then
      new.approved_by := auth.uid();
    end if;
  end if;

  if new.code is null then new.code := next_code('STR');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_strategies_validate before insert or update on strategies
  for each row execute function strategies_validate();
create trigger trg_strategies_status before update on strategies
  for each row execute function enforce_status_transition('strategy');
create trigger trg_strategies_audit after insert or update on strategies
  for each row execute function capture_audit('strategy');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('strategy','[Strategy Drafting]','[Strategy Submitted for Approval]', null),
  ('strategy','[Strategy Submitted for Approval]','[Strategy Approved]', '{lead,od,director}'),
  ('strategy','[Strategy Submitted for Approval]','[Strategy Drafting]', '{lead,od,director}');

-- Sync Strategy lifecycle -> parent Service execution path.
create or replace function strategies_sync_service()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update services set execution_status = '[Strategy Drafting]'
    where id = new.service_id and execution_status = '[Awaiting Onboarding]';
  elsif new.status is distinct from old.status then
    if new.status = '[Strategy Submitted for Approval]' then
      update services set execution_status = '[Strategy Submitted for Approval]'
      where id = new.service_id and execution_status = '[Strategy Drafting]';
    elsif new.status = '[Strategy Drafting]' then
      update services set execution_status = '[Strategy Drafting]'
      where id = new.service_id and execution_status = '[Strategy Submitted for Approval]';
    elsif new.status = '[Strategy Approved]' then
      update services set execution_status = '[Strategy Approved]'
      where id = new.service_id and execution_status = '[Strategy Submitted for Approval]';
    end if;
  end if;
  return null;
end $$;

create trigger trg_strategies_sync after insert or update on strategies
  for each row execute function strategies_sync_service();

-- =============================================================================
-- Brief (`BRF-…`) — unit kerja ke SATU divisi (M6 §5–§7, field tambahan M7/M8/M10)
-- =============================================================================
create type brief_status as enum (
  '[To Do]','[In Progress]','[Submitted]','[In Review]','[Revision Requested]',
  '[Approved]','[Blocked]','[Cancelled - Service Voided]','[Completed]','[Overdue]',
  '[Menunggu Forward ke Vendor]','[Diteruskan ke Vendor]'
);
create type brief_priority as enum ('Low','Medium','High');

create table briefs (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,                   -- BRF-YYYYMM-NNNN
  service_id         uuid not null references services(id),
  strategy_id        uuid references strategies(id), -- null untuk Direct path
  assigned_division  division not null,              -- auto dari Service Type (immutable)
  assigned_pic       uuid references employees(id),  -- staff divisi yang pick-up
  deliverable_type   text not null,
  quantity_target    numeric,                        -- SKU count / campaign count / video count / live hours
  due_date           date not null,                  -- SLA (M12)
  priority           brief_priority not null,
  recurring          boolean not null default false,
  instructions       text,
  -- M7 (E-commerce)
  optimization_scope text[],                         -- checklist baku (subset 6 item)
  custom_scope_item  text,
  -- M8 (Ads)
  platforms          text[],
  budget_total_idr   numeric,
  budget_total_usd   numeric,
  -- M10 (Live Stream)
  target_metrics     jsonb,                          -- fleksibel per kesepakatan (M10-OA-4)
  -- derived
  completion_pct     numeric not null default 0,     -- dihitung trigger M7/M8/M9
  status             brief_status not null,
  revision_count     int not null default 0,
  revision_notes     text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  status_changed_by  uuid,
  status_changed_at  timestamptz
);

create index briefs_service_idx on briefs (service_id);
create index briefs_division_idx on briefs (assigned_division, status);

create or replace function briefs_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_svc services%rowtype;
  v_div division;
  v_am  uuid;
begin
  if tg_op = 'INSERT' then
    if new.service_id is null
       or new.deliverable_type is null or btrim(new.deliverable_type) = ''
       or new.due_date is null or new.priority is null then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;

    select * into v_svc from services where id = new.service_id;
    if not found then raise exception '[service tidak ditemukan]'; end if;
    if v_svc.status <> '[Active]' then
      raise exception '[service tidak aktif]' using errcode = 'check_violation';
    end if;

    -- Divisi WAJIB mengikuti Service Type (division isolation, M6 §2).
    select division into v_div from service_catalog where service_type = v_svc.service_type;
    if new.assigned_division is not null and new.assigned_division is distinct from v_div then
      raise exception '[brief tidak sesuai dengan tipe service yang dipilih]'
        using errcode = 'check_violation';
    end if;
    new.assigned_division := v_div;

    -- Plan gate (M6 §5 Rule 5).
    if coalesce(v_svc.requires_strategy_plan, false)
       and v_svc.execution_status not in ('[Strategy Approved]','[Briefed]','[In Execution]') then
      raise exception '[strategi belum disetujui, brief belum bisa dibuat]'
        using errcode = 'check_violation';
    end if;
    if coalesce(v_svc.requires_strategy_plan, false) and new.strategy_id is null then
      select id into new.strategy_id from strategies where service_id = v_svc.id;
    end if;

    -- Pembuat = AM merchant (atau SPV Account / OD / Director).
    select am_id into v_am from merchants where id = v_svc.merchant_id;
    if v_am is null then
      raise exception '[merchant belum memiliki AM, minta SPV Account melakukan assignment]'
        using errcode = 'check_violation';
    end if;
    if not (is_od() or is_director()
            or (auth_division() = 'Account' and (is_lead() or v_am = auth.uid()))) then
      raise exception '[hanya AM merchant ini yang dapat membuat Brief]'
        using errcode = 'insufficient_privilege';
    end if;

    -- Field minimum per divisi (M7 §3.1 R1, M8 §3.1 R1, M9 §3.1 R1, M10 §4.2).
    if v_div = 'Ecommerce' then
      if new.quantity_target is null or new.quantity_target <= 0
         or new.optimization_scope is null or array_length(new.optimization_scope,1) is null then
        raise exception '[Brief E-commerce wajib memiliki Target SKU Count dan Optimization Scope Checklist]'
          using errcode = 'check_violation';
      end if;
    elsif v_div = 'Ads' then
      if new.quantity_target is null or new.quantity_target <= 0
         or new.platforms is null or array_length(new.platforms,1) is null
         or (coalesce(new.budget_total_idr,0) <= 0 and coalesce(new.budget_total_usd,0) <= 0) then
        raise exception '[Brief Ads wajib memiliki Target Campaign Count, Platform, dan Budget Total]'
          using errcode = 'check_violation';
      end if;
    elsif v_div = 'KOL' then
      if new.quantity_target is null or new.quantity_target <= 0 then
        raise exception '[Brief KOL wajib memiliki target (jumlah video / total jam live)]'
          using errcode = 'check_violation';
      end if;
    elsif v_div = 'LiveStream' then
      if new.target_metrics is null then
        raise exception '[Brief Live Stream wajib memiliki Target Metric(s)]'
          using errcode = 'check_violation';
      end if;
    end if;

    -- Live Stream: pengecualian forward (M6 §6 Rule 3) — tidak masuk queue internal.
    if new.status is null then
      new.status := case when v_div = 'LiveStream'
                         then '[Menunggu Forward ke Vendor]'::brief_status
                         else '[To Do]'::brief_status end;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.assigned_division is distinct from old.assigned_division then
      raise exception '[divisi Brief tidak dapat diubah]' using errcode = 'check_violation';
    end if;
    -- Revision routing (M6 §7): feedback wajib, Revision Count naik.
    if new.status = '[Revision Requested]' and old.status is distinct from new.status then
      if new.revision_notes is null or btrim(new.revision_notes) = '' then
        raise exception '[feedback revisi wajib diisi]' using errcode = 'check_violation';
      end if;
      new.revision_count := old.revision_count + 1;
    end if;
    -- Pick-up: staff divisi self-assign.
    if new.status = '[In Progress]' and old.status = '[To Do]' and new.assigned_pic is null then
      new.assigned_pic := auth.uid();
    end if;
    -- Forward ke vendor hanya oleh Account (AM).
    if new.status = '[Diteruskan ke Vendor]' and old.status is distinct from new.status
       and not (auth_division() = 'Account' or is_od() or is_director()) then
      raise exception '[hanya AM yang dapat meneruskan Brief ke vendor]'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.code is null then new.code := next_code('BRF');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_briefs_validate before insert or update on briefs
  for each row execute function briefs_validate();
create trigger trg_briefs_status before update on briefs
  for each row execute function enforce_status_transition('brief');
create trigger trg_briefs_audit after insert or update on briefs
  for each row execute function capture_audit('brief');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('brief','[To Do]','[In Progress]',                       null),
  ('brief','[In Progress]','[Submitted]',                   null),
  ('brief','[Submitted]','[In Review]',                     null),
  ('brief','[In Review]','[Approved]',                      null),
  ('brief','[In Review]','[Revision Requested]',            null),
  ('brief','[Revision Requested]','[In Progress]',          null),
  ('brief','[In Progress]','[Blocked]',                     null),
  ('brief','[Blocked]','[In Progress]',                     null),
  ('brief','[In Progress]','[Completed]',                   null),
  ('brief','[In Progress]','[Overdue]',                     null),
  ('brief','[Overdue]','[In Progress]',                     null),
  ('brief','[Overdue]','[Completed]',                       null),
  ('brief','[Menunggu Forward ke Vendor]','[Diteruskan ke Vendor]', null),
  ('brief','[Diteruskan ke Vendor]','[Completed]',          null),
  ('brief','[To Do]','[Cancelled - Service Voided]',        null),
  ('brief','[In Progress]','[Cancelled - Service Voided]',  null),
  ('brief','[Submitted]','[Cancelled - Service Voided]',    null),
  ('brief','[In Review]','[Cancelled - Service Voided]',    null),
  ('brief','[Revision Requested]','[Cancelled - Service Voided]', null),
  ('brief','[Blocked]','[Cancelled - Service Voided]',      null),
  ('brief','[Overdue]','[Cancelled - Service Voided]',      null),
  ('brief','[Menunggu Forward ke Vendor]','[Cancelled - Service Voided]', null);

-- Brief lahir -> Service [Briefed]; Brief dikerjakan/diteruskan -> [In Execution].
create or replace function briefs_sync_service()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update services set execution_status = '[Briefed]'
    where id = new.service_id
      and execution_status in ('[Awaiting Onboarding]','[Direct Breakdown]','[Strategy Approved]');
  elsif new.status is distinct from old.status
        and new.status in ('[In Progress]','[Diteruskan ke Vendor]') then
    update services set execution_status = '[In Execution]'
    where id = new.service_id and execution_status = '[Briefed]';
  end if;
  return null;
end $$;

create trigger trg_briefs_sync after insert or update on briefs
  for each row execute function briefs_sync_service();

-- Void Service cascade (M6 §5 Rule 7): brief yang belum [Approved] auto-cancel.
create or replace function services_void_cascade()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = '[Voided]' and old.status <> '[Voided]' then
    update briefs set status = '[Cancelled - Service Voided]'
    where service_id = new.id
      and status in ('[To Do]','[In Progress]','[Submitted]','[In Review]',
                     '[Revision Requested]','[Blocked]','[Overdue]','[Menunggu Forward ke Vendor]');
  end if;
  return null;
end $$;

create trigger trg_services_void_cascade after update on services
  for each row execute function services_void_cascade();

-- =============================================================================
-- Complaint (`CPL-…`) — dua pintu di Fase 1: AM (primer) + BizDev (sekunder)
-- =============================================================================
create type complaint_source as enum ('WhatsApp (AM-logged)','BizDev-logged','Merchant Portal');
create type complaint_severity as enum ('Low','Medium','High');
create type complaint_status as enum ('[Open]','[In Progress]','[Resolved]','[Closed]');

create table complaints (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,                   -- CPL-YYYYMM-NNNN
  merchant_id        uuid not null references merchants(id),
  related_service_id uuid references services(id),
  related_brief_id   uuid references briefs(id),
  source             complaint_source,
  description        text not null,
  severity           complaint_severity not null,   -- Low -5 / Medium -15 / High -30 (M13)
  status             complaint_status not null default '[Open]',
  assigned_to        uuid references employees(id), -- AM pemilik merchant
  resolution_notes   text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  status_changed_by  uuid,
  status_changed_at  timestamptz
);

create or replace function complaints_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.merchant_id is null
     or new.description is null or btrim(new.description) = ''
     or new.severity is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if auth_division() = 'BizDev' then
      -- Pintu sekunder: hanya untuk merchant yang di-closing sendiri.
      if not exists (
        select 1 from merchants m join prospect_attempts pa on pa.id = m.source_attempt_id
        where m.id = new.merchant_id and pa.owner_id = auth.uid()
      ) then
        raise exception '[BizDev hanya dapat mencatat komplain untuk merchant yang di-closing sendiri]'
          using errcode = 'insufficient_privilege';
      end if;
      new.source := 'BizDev-logged';
    else
      new.source := 'WhatsApp (AM-logged)';
    end if;
    select am_id into new.assigned_to from merchants where id = new.merchant_id;
  end if;

  if tg_op = 'UPDATE' and new.status = '[Resolved]' and old.status is distinct from new.status then
    if new.resolution_notes is null or btrim(new.resolution_notes) = '' then
      raise exception '[Resolution Notes wajib diisi sebelum komplain di-resolve]'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.code is null then new.code := next_code('CPL');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_complaints_validate before insert or update on complaints
  for each row execute function complaints_validate();
create trigger trg_complaints_status before update on complaints
  for each row execute function enforce_status_transition('complaint');
create trigger trg_complaints_audit after insert or update on complaints
  for each row execute function capture_audit('complaint');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('complaint','[Open]','[In Progress]',      null),
  ('complaint','[In Progress]','[Resolved]',  null),
  ('complaint','[Resolved]','[Closed]',       null);

-- =============================================================================
-- assign_am(): SPV/Head Account menugaskan AM secara manual (M6 §3)
-- =============================================================================
create or replace function assign_am(
  p_merchant_id uuid,
  p_am_id       uuid,
  p_reason      text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_m   merchants%rowtype;
  v_div division;
begin
  if not (is_od() or is_director() or (is_lead() and auth_division() = 'Account')) then
    raise exception '[hanya SPV/Head Account yang dapat menugaskan AM]'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_m from merchants where id = p_merchant_id;
  if not found then raise exception '[merchant tidak ditemukan]'; end if;

  if not exists (select 1 from transactions t
                 where t.merchant_id = p_merchant_id and t.released_to_account_at is not null) then
    raise exception '[merchant belum dirilis oleh Finance (belum ada pembayaran terverifikasi)]'
      using errcode = 'check_violation';
  end if;

  select division into v_div from employees where id = p_am_id and active;
  if v_div is distinct from 'Account'::division then
    raise exception '[AM harus karyawan divisi Account yang aktif]' using errcode = 'check_violation';
  end if;

  -- Reassignment wajib beralasan (M6 §3 Rule 3).
  if v_m.am_id is not null and v_m.am_id is distinct from p_am_id
     and (p_reason is null or btrim(p_reason) = '') then
    raise exception '[alasan wajib diisi untuk penggantian AM]' using errcode = 'check_violation';
  end if;

  update merchants
     set am_id = p_am_id,
         am_assigned_by = auth.uid(),
         am_assigned_at = now(),
         am_assignment_reason = coalesce(p_reason, am_assignment_reason)
   where id = p_merchant_id;
end $$;

-- =============================================================================
-- close_deal() + Package decomposition (M6 §2, CONFIRMED): Package meledak jadi
-- N Service entries saat closing, atomik, source_package_id tercatat.
-- =============================================================================
drop function if exists close_deal(uuid,text,text,text,text,numeric,numeric,service_type[],numeric,payment_intent);

create or replace function close_deal(
  p_attempt_id     uuid,
  p_nama_toko      text,
  p_kota           text,
  p_link_toko      text,
  p_kategori       text,
  p_gmv_baseline   numeric,
  p_target_gmv     numeric,
  p_service_types  service_type[],
  p_total_fee      numeric,
  p_payment_intent payment_intent,
  p_package_id     uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_attempt   prospect_attempts%rowtype;
  v_campaign  uuid;
  v_merchant  uuid;
  v_pkg       service_type[];
  st          service_type;
begin
  select * into v_attempt from prospect_attempts where id = p_attempt_id;
  if not found then raise exception '[prospect tidak ditemukan]'; end if;
  if not (v_attempt.owner_id = auth.uid() or is_director()) then
    raise exception '[hanya pemilik prospect atau Director yang dapat closing]' using errcode='insufficient_privilege';
  end if;
  if v_attempt.status <> '[Negotiation]' then
    raise exception '[closing hanya dari tahap Negotiation]' using errcode='check_violation';
  end if;
  if (p_service_types is null or array_length(p_service_types,1) is null) and p_package_id is null then
    raise exception '[minimal satu service atau satu package harus dipilih]' using errcode='check_violation';
  end if;

  if p_package_id is not null then
    select included_service_types into v_pkg from package_catalog where id = p_package_id;
    if v_pkg is null then raise exception '[package tidak ditemukan]'; end if;
  end if;

  select origin_campaign_id into v_campaign from leads where id = v_attempt.parent_lead_id;

  insert into merchants (nama_toko, kota, link_toko, kategori, origin_campaign_id,
                         source_attempt_id, gmv_baseline, target_gmv, payment_intent)
  values (p_nama_toko, p_kota, p_link_toko, p_kategori, v_campaign,
          p_attempt_id, p_gmv_baseline, p_target_gmv, p_payment_intent)
  returning id into v_merchant;

  -- Package decomposition: 1 Package -> N Service entries (atomik, teraudit).
  if v_pkg is not null then
    foreach st in array v_pkg loop
      insert into services (merchant_id, service_type, source_package_id)
      values (v_merchant, st, p_package_id);
    end loop;
  end if;
  if p_service_types is not null then
    foreach st in array p_service_types loop
      insert into services (merchant_id, service_type) values (v_merchant, st);
    end loop;
  end if;

  insert into transactions (merchant_id, payment_intent, total_agreed_value)
  values (v_merchant, p_payment_intent, p_total_fee);

  update prospect_attempts set status = '[Closed - Success]' where id = p_attempt_id;

  return v_merchant;
end $$;

-- ---- RLS ----------------------------------------------------------------------
alter table strategies enable row level security;
create policy strategies_select on strategies for select to authenticated
  using (is_od() or is_director() or auth_division() = 'Account');
create policy strategies_insert on strategies for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'Account');
create policy strategies_update on strategies for update to authenticated
  using (is_od() or is_director() or auth_division() = 'Account');

alter table briefs enable row level security;
create policy briefs_select on briefs for select to authenticated
  using (is_od() or is_director() or auth_division() = 'Account'
         or assigned_division = auth_division());
create policy briefs_insert on briefs for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'Account');
create policy briefs_update on briefs for update to authenticated
  using (is_od() or is_director() or auth_division() = 'Account'
         or assigned_division = auth_division());

alter table complaints enable row level security;
create policy complaints_select on complaints for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Account','BizDev'));
create policy complaints_insert on complaints for insert to authenticated
  with check (is_od() or is_director() or auth_division() in ('Account','BizDev'));
create policy complaints_update on complaints for update to authenticated
  using (is_od() or is_director() or auth_division() = 'Account');

-- ---- Function grants -----------------------------------------------------------
revoke execute on function enforce_execution_transition() from public, anon, authenticated;
revoke execute on function strategies_validate()          from public, anon, authenticated;
revoke execute on function strategies_sync_service()      from public, anon, authenticated;
revoke execute on function briefs_validate()              from public, anon, authenticated;
revoke execute on function briefs_sync_service()          from public, anon, authenticated;
revoke execute on function services_void_cascade()        from public, anon, authenticated;
revoke execute on function complaints_validate()          from public, anon, authenticated;

revoke execute on function assign_am(uuid,uuid,text) from public, anon;
grant  execute on function assign_am(uuid,uuid,text) to authenticated;
revoke execute on function close_deal(uuid,text,text,text,text,numeric,numeric,service_type[],numeric,payment_intent,uuid) from public, anon;
grant  execute on function close_deal(uuid,text,text,text,text,numeric,numeric,service_type[],numeric,payment_intent,uuid) to authenticated;
