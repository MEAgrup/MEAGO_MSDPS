-- =============================================================================
-- MSDPS · Fase C · Module 7 — E-commerce / SKU Optimization (`SKU-…`)
-- =============================================================================
-- Brief E-commerce meledak jadi N SKU Work Unit (1 unit = 1 produk nyata).
-- Dua-layer review (E-com Lead -> AM), timer start/stop (1 aktif per staff),
-- Completion % Brief derived, cancelled unit mengurangi Target SKU Count.
-- =============================================================================

create type sku_status as enum (
  '[To Do]','[In Progress]','[Submitted for Review]','[In Review - E-com Lead]',
  '[Approved by Lead]','[In Review - AM]','[Approved]','[Revision Requested]','[Cancelled]'
);

create table sku_work_units (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                  -- SKU-YYYYMM-NNNN
  brief_id            uuid not null references briefs(id),
  product_ref         text not null,                -- nama produk + link/ID listing (wajib nyata)
  scope_checklist     text[] not null,              -- diwarisi dari Brief, read-only
  checklist_done      text[] not null default '{}',
  status              sku_status not null default '[To Do]',
  assigned_staff      uuid references employees(id),
  time_logged_seconds bigint not null default 0,    -- DERIVED dari ecom_time_logs
  revision_count      int not null default 0,
  revision_notes      text,
  last_revision_layer text,                         -- 'lead' | 'am' (routing resubmit)
  cancellation_reason text,
  submitted_at        timestamptz,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  status_changed_by   uuid,
  status_changed_at   timestamptz
);

create index sku_units_brief_idx on sku_work_units (brief_id, status);

create or replace function sku_units_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brief briefs%rowtype;
  v_count int;
begin
  if new.product_ref is null or btrim(new.product_ref) = '' then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  select * into v_brief from briefs where id = new.brief_id;
  if not found then raise exception '[brief tidak ditemukan]'; end if;

  if tg_op = 'INSERT' then
    if v_brief.assigned_division <> 'Ecommerce' then
      raise exception '[brief tidak sesuai dengan tipe service yang dipilih]'
        using errcode = 'check_violation';
    end if;
    if v_brief.status not in ('[In Progress]','[Overdue]') or v_brief.assigned_pic is null then
      raise exception '[brief belum di-pick up dari queue E-commerce]'
        using errcode = 'check_violation';
    end if;
    if not (is_od() or is_director() or auth_division() = 'Ecommerce') then
      raise exception '[hanya staff E-commerce yang dapat membuat SKU Work Unit]'
        using errcode = 'insufficient_privilege';
    end if;
    -- Hard cap: jumlah unit non-cancelled <= Target SKU Count (M7 Rule 3).
    select count(*) into v_count from sku_work_units
    where brief_id = new.brief_id and status <> '[Cancelled]';
    if v_count >= coalesce(v_brief.quantity_target, 0) then
      raise exception '[jumlah SKU Work Unit melebihi Target SKU Count, butuh approval SPV untuk menaikkan target]'
        using errcode = 'check_violation';
    end if;
    -- Checklist diwarisi dari Brief (M7 Rule 4).
    new.scope_checklist := v_brief.optimization_scope
      || case when v_brief.custom_scope_item is not null and btrim(v_brief.custom_scope_item) <> ''
              then array[v_brief.custom_scope_item] else '{}'::text[] end;
    new.assigned_staff := coalesce(new.assigned_staff, auth.uid());
  end if;

  if tg_op = 'UPDATE' then
    if new.scope_checklist is distinct from old.scope_checklist then
      raise exception '[Optimization Scope Checklist diwarisi dari Brief dan tidak dapat diubah]'
        using errcode = 'check_violation';
    end if;
    -- Submit: semua item checklist wajib selesai (M7 Rule 4, ditegakkan di submit).
    if new.status = '[Submitted for Review]' and old.status is distinct from new.status then
      if not (new.checklist_done @> new.scope_checklist) then
        raise exception '[semua item checklist wajib diselesaikan sebelum submit untuk review]'
          using errcode = 'check_violation';
      end if;
      new.submitted_at := now();
    end if;
    -- Resubmit langsung ke AM hanya kalau revisi terakhir dari AM (M7 Rule 5).
    if new.status = '[In Review - AM]' and old.status = '[Submitted for Review]'
       and coalesce(old.last_revision_layer,'') <> 'am' then
      raise exception '[review harus melalui E-com Lead terlebih dahulu]'
        using errcode = 'check_violation';
    end if;
    -- Layer 2 (AM) hanya oleh Account/OD/Director.
    if old.status = '[In Review - AM]' and new.status in ('[Approved]','[Revision Requested]')
       and not (auth_division() = 'Account' or is_od() or is_director()) then
      raise exception '[review layer AM hanya dapat dilakukan oleh Account]'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status = '[Revision Requested]' and old.status is distinct from new.status then
      if new.revision_notes is null or btrim(new.revision_notes) = '' then
        raise exception '[Revision Notes wajib diisi]' using errcode = 'check_violation';
      end if;
      new.revision_count := old.revision_count + 1;
      new.last_revision_layer := case old.status
        when '[In Review - E-com Lead]' then 'lead'
        when '[In Review - AM]' then 'am'
        else old.last_revision_layer end;
    end if;
    if new.status = '[Approved]' and old.status is distinct from new.status then
      new.approved_at := now();
    end if;
    -- Cancel (SKU delisted): hanya AM, alasan wajib (M7 Rule 12).
    if new.status = '[Cancelled]' and old.status is distinct from new.status then
      if not (auth_division() = 'Account' or is_od() or is_director()) then
        raise exception '[hanya AM yang dapat membatalkan SKU Work Unit]'
          using errcode = 'insufficient_privilege';
      end if;
      if new.cancellation_reason is null or btrim(new.cancellation_reason) = '' then
        raise exception '[alasan pembatalan wajib diisi]' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.code is null then new.code := next_code('SKU');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_sku_units_validate before insert or update on sku_work_units
  for each row execute function sku_units_validate();
create trigger trg_sku_units_status before update on sku_work_units
  for each row execute function enforce_status_transition('sku_unit');
create trigger trg_sku_units_audit after insert or update on sku_work_units
  for each row execute function capture_audit('sku_unit');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('sku_unit','[To Do]','[In Progress]',                              null),
  ('sku_unit','[In Progress]','[Submitted for Review]',               null),
  ('sku_unit','[Submitted for Review]','[In Review - E-com Lead]',    null),
  ('sku_unit','[Submitted for Review]','[In Review - AM]',            null),
  ('sku_unit','[In Review - E-com Lead]','[Approved by Lead]',        '{lead,od,director}'),
  ('sku_unit','[In Review - E-com Lead]','[Revision Requested]',      '{lead,od,director}'),
  ('sku_unit','[Approved by Lead]','[In Review - AM]',                null),
  ('sku_unit','[In Review - AM]','[Approved]',                        null),
  ('sku_unit','[In Review - AM]','[Revision Requested]',              null),
  ('sku_unit','[Revision Requested]','[In Progress]',                 null),
  ('sku_unit','[To Do]','[Cancelled]',                                null),
  ('sku_unit','[In Progress]','[Cancelled]',                          null),
  ('sku_unit','[Submitted for Review]','[Cancelled]',                 null),
  ('sku_unit','[In Review - E-com Lead]','[Cancelled]',               null),
  ('sku_unit','[Approved by Lead]','[Cancelled]',                     null),
  ('sku_unit','[In Review - AM]','[Cancelled]',                       null),
  ('sku_unit','[Revision Requested]','[Cancelled]',                   null);

-- Completion % Brief + auto-[Completed] + cancelled mengurangi target (M7 R10–R12).
create or replace function sku_units_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_target   numeric;
  v_approved int;
  v_pct      numeric;
begin
  if tg_op = 'UPDATE' and new.status = '[Cancelled]' and old.status <> '[Cancelled]' then
    update briefs set quantity_target = greatest(coalesce(quantity_target,0) - 1, 0)
    where id = new.brief_id;
  end if;

  select quantity_target into v_target from briefs where id = new.brief_id;
  select count(*) into v_approved from sku_work_units
  where brief_id = new.brief_id and status = '[Approved]';

  v_pct := case when coalesce(v_target,0) > 0
                then round(v_approved::numeric / v_target * 100, 1) else 0 end;

  update briefs set completion_pct = v_pct where id = new.brief_id;

  if v_pct >= 100 then
    update briefs set status = '[Completed]'
    where id = new.brief_id and status in ('[In Progress]','[Overdue]');
  end if;
  return null;
end $$;

create trigger trg_sku_units_after after insert or update on sku_work_units
  for each row execute function sku_units_after_change();

-- =============================================================================
-- Time logs — start/stop timer, maksimal 1 timer aktif per staff (M7 Rule 8)
-- =============================================================================
create table ecom_time_logs (
  id           uuid primary key default gen_random_uuid(),
  work_unit_id uuid not null references sku_work_units(id),
  staff_id     uuid not null default auth.uid() references employees(id),
  started_at   timestamptz not null default now(),
  stopped_at   timestamptz,
  auto_stopped boolean not null default false      -- log transparansi KPI (M7 error path)
);

create index ecom_time_logs_staff_open_idx on ecom_time_logs (staff_id) where stopped_at is null;

-- Start timer baru -> auto-stop timer lain milik staff yang sama.
create or replace function ecom_time_logs_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update ecom_time_logs set stopped_at = now(), auto_stopped = true
  where staff_id = new.staff_id and stopped_at is null;
  return new;
end $$;

create trigger trg_time_logs_start before insert on ecom_time_logs
  for each row execute function ecom_time_logs_before_insert();

-- Stop (manual atau auto) -> akumulasi ke time_logged_seconds unit.
create or replace function ecom_time_logs_accumulate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stopped_at is not null and old.stopped_at is null then
    update sku_work_units
       set time_logged_seconds = time_logged_seconds
         + greatest(0, extract(epoch from new.stopped_at - new.started_at))::bigint
     where id = new.work_unit_id;
  elsif old.stopped_at is not null then
    raise exception '[log timer yang sudah berhenti tidak dapat diubah]'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_time_logs_stop before update on ecom_time_logs
  for each row execute function ecom_time_logs_accumulate();

-- ---- RLS ----------------------------------------------------------------------
alter table sku_work_units enable row level security;
create policy sku_select on sku_work_units for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Ecommerce','Account'));
create policy sku_insert on sku_work_units for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'Ecommerce');
create policy sku_update on sku_work_units for update to authenticated
  using (is_od() or is_director() or auth_division() in ('Ecommerce','Account'));

alter table ecom_time_logs enable row level security;
create policy tlog_select on ecom_time_logs for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Ecommerce','Account'));
create policy tlog_insert on ecom_time_logs for insert to authenticated
  with check (staff_id = auth.uid() and auth_division() = 'Ecommerce');
create policy tlog_update on ecom_time_logs for update to authenticated
  using (staff_id = auth.uid() or is_od() or is_director());

-- ---- Function grants -----------------------------------------------------------
revoke execute on function sku_units_validate()           from public, anon, authenticated;
revoke execute on function sku_units_after_change()       from public, anon, authenticated;
revoke execute on function ecom_time_logs_before_insert() from public, anon, authenticated;
revoke execute on function ecom_time_logs_accumulate()    from public, anon, authenticated;
