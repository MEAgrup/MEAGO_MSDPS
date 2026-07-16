-- =============================================================================
-- MSDPS · MCN · Migration 0304 — Jadwal Live (`live_schedule_slots`)
-- =============================================================================
-- Matriks kreator × hari. BOLEH multi-slot per kreator per hari → SENGAJA TANPA
-- unique(creator,date). Status scheduled/tentative/off/done. `done` = TERKUNCI:
-- server menolak UPDATE/DELETE bila slot sudah done. Transisi ke `done` hanya
-- lewat aksi verify yang mengisi actual_start & verified_by (divalidasi trigger).
-- deal_id opsional (FK ke brand_deals ditambahkan di 0305).
-- =============================================================================

create table live_schedule_slots (
  id                    uuid primary key default gen_random_uuid(),
  mcn_creator_id        uuid not null references mcn_creators(id) on delete cascade,
  schedule_date         date not null,
  start_time            time,
  end_time              time,
  status                text not null default 'scheduled'
                          check (status in ('scheduled','tentative','off','done')),
  off_reason            text,
  brand_name            text,
  deal_id               uuid,                                     -- FK -> brand_deals(id) di 0305
  deals_by              text check (deals_by in ('bd','cm','creator')),
  ads_payer             text check (ads_payer in ('brand','mea','invoicing_mea','organik')),
  ads_note              text,
  pk_ready              boolean,
  product_set_title     text,
  product_connected_tap boolean,
  fokus_produk          text,
  actual_start          time,
  actual_end            time,
  verified_by           uuid references employees(id),
  verified_at           timestamptz,
  created_by            uuid default auth.uid(),
  updated_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  status_changed_by     uuid,
  status_changed_at     timestamptz
);

create index live_slots_date_idx on live_schedule_slots (schedule_date);
create index live_slots_creator_date_idx on live_schedule_slots (mcn_creator_id, schedule_date);

-- ---- Validate: field wajib + syarat verifikasi ke `done` --------------------
create or replace function live_slots_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mcn_creator_id is null or new.schedule_date is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  -- Transisi ke `done` wajib actual_start & verified_by terisi (aksi verify).
  if tg_op = 'UPDATE' and new.status = 'done' and old.status is distinct from 'done' then
    if new.actual_start is null or new.verified_by is null then
      raise exception '[verifikasi wajib mengisi actual_start dan verified_by sebelum slot ditandai done]'
        using errcode = 'check_violation';
    end if;
    new.verified_at := coalesce(new.verified_at, now());
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

-- ---- Lock: slot `done` terkunci (tolak update & delete) ---------------------
create or replace function live_slots_lock_done()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'done' then
    raise exception '[slot sudah diverifikasi dan terkunci]'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create trigger trg_live_slots_lock before update or delete on live_schedule_slots
  for each row execute function live_slots_lock_done();
create trigger trg_live_slots_status before update on live_schedule_slots
  for each row execute function enforce_status_transition('live_slot');
create trigger trg_live_slots_validate before insert or update on live_schedule_slots
  for each row execute function live_slots_validate();
create trigger trg_live_slots_audit after insert or update on live_schedule_slots
  for each row execute function capture_audit('live_slot');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('live_slot','scheduled','tentative', null),
  ('live_slot','tentative','scheduled', null),
  ('live_slot','scheduled','off',       null),
  ('live_slot','tentative','off',       null),
  ('live_slot','off','scheduled',       null),
  ('live_slot','scheduled','done',      null),
  ('live_slot','tentative','done',      null);

-- ---- RLS --------------------------------------------------------------------
-- Baca: CM + BizDev + mgmt. Tulis: mgmt + BizDev + CM (staff CM scope kreator
-- miliknya via owner_cpm_id; Lead CM lintas).
alter table live_schedule_slots enable row level security;

create policy live_slots_select on live_schedule_slots for select to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev'));

create policy live_slots_insert on live_schedule_slots for insert to authenticated
  with check (
    is_od() or is_director() or auth_division() = 'BizDev'
    or (auth_division() = 'CreatorManagement' and (is_lead()
        or exists (select 1 from mcn_creators c
                   where c.id = mcn_creator_id and c.owner_cpm_id = auth_emp_id())))
  );

create policy live_slots_update on live_schedule_slots for update to authenticated
  using (
    is_od() or is_director() or auth_division() = 'BizDev'
    or (auth_division() = 'CreatorManagement' and (is_lead()
        or exists (select 1 from mcn_creators c
                   where c.id = mcn_creator_id and c.owner_cpm_id = auth_emp_id())))
  );

create policy live_slots_delete on live_schedule_slots for delete to authenticated
  using (
    is_od() or is_director() or auth_division() = 'BizDev'
    or (auth_division() = 'CreatorManagement' and (is_lead()
        or exists (select 1 from mcn_creators c
                   where c.id = mcn_creator_id and c.owner_cpm_id = auth_emp_id())))
  );

revoke execute on function live_slots_validate()  from public, anon, authenticated;
revoke execute on function live_slots_lock_done() from public, anon, authenticated;
