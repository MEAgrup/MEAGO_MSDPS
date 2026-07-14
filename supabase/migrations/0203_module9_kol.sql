-- =============================================================================
-- MSDPS · Fase C · Module 9 — KOL (`CRT-…`, `BKG-…`) + wiring payout PYO (M5)
-- =============================================================================
-- Filosofi (confirmed): creator TIDAK masuk revision cycle — dihitung kuantitas
-- deliverable + GMV. Booking berhenti di [Delivered]/[Cancelled]. Dua akumulator
-- payout independen per creator: PYO-Video per 10 video, PYO-Live per 5 jam,
-- akumulasi lintas merchant. GMV Generated = metrik evaluasi, bukan syarat payout.
-- =============================================================================

create type creator_source_pool as enum ('MCN MEA Roster','KOL External Pool','Ad-hoc New');
create type bkg_deliverable as enum ('Video','Live Session');
create type bkg_status as enum (
  '[Sourcing/Negotiation]','[Booked]','[In Production]','[Delivered]','[Cancelled]'
);

-- ---- Creator Master (`CRT-NNNN`, global sequence, reusable lintas merchant) ----
create table creators (
  id                        uuid primary key default gen_random_uuid(),
  code                      text unique,             -- CRT-NNNN
  name_handle               text not null,
  platforms                 text[] not null,
  niche                     text not null,
  source_pool               creator_source_pool not null,
  roster_ref                text,                    -- kalau Source Pool = Roster
  payment_details           text,                    -- wajib sebelum Booking pertama [Booked]
  -- DERIVED (recompute dari bookings — jangan edit manual)
  total_videos_delivered    int not null default 0,
  total_live_hours          numeric not null default 0,
  total_gmv                 numeric not null default 0,
  gmv_deliverable_count     int not null default 0,
  created_by                uuid default auth.uid(),
  created_at                timestamptz not null default now()
);

create unique index creators_handle_uniq on creators (lower(name_handle));

create or replace function creators_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name_handle is null or btrim(new.name_handle) = ''
     or new.platforms is null or array_length(new.platforms,1) is null
     or new.niche is null or btrim(new.niche) = ''
     or new.source_pool is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.source_pool = 'MCN MEA Roster' and (new.roster_ref is null or btrim(new.roster_ref) = '') then
    raise exception '[MCN MEA Roster Reference wajib diisi untuk creator dari Roster]'
      using errcode = 'check_violation';
  end if;
  if new.code is null then new.code := next_code_global('CRT');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_creators_validate before insert or update on creators
  for each row execute function creators_validate();
create trigger trg_creators_audit after insert or update on creators
  for each row execute function capture_audit('creator');

-- ---- Creator Booking (`BKG-…`) — atomic unit (1 video / 1 sesi live) ----------
create table creator_bookings (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                   -- BKG-YYYYMM-NNNN
  brief_id            uuid not null references briefs(id),
  creator_id          uuid not null references creators(id),
  deliverable_type    bkg_deliverable not null,
  agreed_rate         numeric not null,              -- Video: per video; Live: basis per 5 jam
  hours_logged        numeric,                       -- Live only; wajib sebelum [Delivered]
  source_pool         creator_source_pool,           -- auto dari Creator Master
  status              bkg_status not null default '[Sourcing/Negotiation]',
  due_date            date not null,                 -- Due / Scheduled Date
  delivery_proof      text,                          -- wajib sebelum [Delivered]
  gmv_generated       numeric,                       -- diisi belakangan; metrik, bukan syarat payout
  cancellation_reason text,
  payout_id           uuid references creator_payouts(id),  -- diisi saat PYO terbentuk
  delivered_at        timestamptz,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  status_changed_by   uuid,
  status_changed_at   timestamptz
);

create index bkg_brief_idx on creator_bookings (brief_id, status);
create index bkg_creator_idx on creator_bookings (creator_id, deliverable_type, status);

create or replace function bookings_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brief    briefs%rowtype;
  v_svc_type service_type;
  v_creator  creators%rowtype;
  v_count    int;
  v_hours    numeric;
begin
  if new.brief_id is null or new.creator_id is null or new.deliverable_type is null
     or new.agreed_rate is null or new.due_date is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  select * into v_brief from briefs where id = new.brief_id;
  if not found then raise exception '[brief tidak ditemukan]'; end if;
  select * into v_creator from creators where id = new.creator_id;
  if not found then
    raise exception '[Creator Master belum ada — buat Creator Master terlebih dahulu]'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if v_brief.assigned_division <> 'KOL' then
      raise exception '[brief tidak sesuai dengan tipe service yang dipilih]'
        using errcode = 'check_violation';
    end if;
    if v_brief.status not in ('[In Progress]','[Overdue]') or v_brief.assigned_pic is null then
      raise exception '[brief belum di-pick up dari queue KOL]' using errcode = 'check_violation';
    end if;
    if not (is_od() or is_director() or auth_division() = 'KOL') then
      raise exception '[hanya tim KOL yang dapat membuat Creator Booking]'
        using errcode = 'insufficient_privilege';
    end if;
    -- Tipe deliverable harus sesuai Service Type Brief (KOL-Video vs KOL-Live).
    select s.service_type into v_svc_type from services s where s.id = v_brief.service_id;
    if (v_svc_type = 'KOL-Video' and new.deliverable_type <> 'Video')
       or (v_svc_type = 'KOL-Live' and new.deliverable_type <> 'Live Session') then
      raise exception '[tipe deliverable tidak sesuai dengan Service Type Brief]'
        using errcode = 'check_violation';
    end if;
    -- Cap Video: jumlah booking non-cancelled <= Target Video Count (M9 Rule 5).
    if new.deliverable_type = 'Video' then
      select count(*) into v_count from creator_bookings
      where brief_id = new.brief_id and status <> '[Cancelled]';
      if v_count >= coalesce(v_brief.quantity_target, 0) then
        raise exception '[jumlah booking melebihi Target Video Count, butuh approval SPV untuk menaikkan target]'
          using errcode = 'check_violation';
      end if;
    end if;
    new.source_pool := v_creator.source_pool;
  end if;

  if tg_op = 'UPDATE' then
    -- Payment Details creator wajib sebelum booking disetujui (M9 §4.2).
    if new.status = '[Booked]' and old.status is distinct from new.status
       and (v_creator.payment_details is null or btrim(v_creator.payment_details) = '') then
      raise exception '[Payment Details creator wajib diisi sebelum booking disetujui]'
        using errcode = 'check_violation';
    end if;
    -- Delivered = konfirmasi keberadaan: bukti wajib; Live wajib Hours Logged.
    if new.status = '[Delivered]' and old.status is distinct from new.status then
      if new.delivery_proof is null or btrim(new.delivery_proof) = '' then
        raise exception '[Delivery Proof (link/bukti tayang) wajib diisi sebelum Delivered]'
          using errcode = 'check_violation';
      end if;
      if new.deliverable_type = 'Live Session' then
        if new.hours_logged is null or new.hours_logged <= 0 then
          raise exception '[Hours Logged wajib diisi untuk sesi live]' using errcode = 'check_violation';
        end if;
        -- Cap Live: akumulasi jam Delivered <= Target Live Hours (M9 Rule 5).
        select coalesce(sum(hours_logged),0) into v_hours from creator_bookings
        where brief_id = new.brief_id and status = '[Delivered]' and id <> new.id;
        if v_hours + new.hours_logged > coalesce(v_brief.quantity_target, 0) then
          raise exception '[melebihi Target Live Hours, butuh approval SPV untuk menaikkan target]'
            using errcode = 'check_violation';
        end if;
      end if;
      new.delivered_at := now();
    end if;
    -- Cancelled: creator gagal deliver — alasan wajib, Hours Logged = 0 (Live).
    if new.status = '[Cancelled]' and old.status is distinct from new.status then
      if new.cancellation_reason is null or btrim(new.cancellation_reason) = '' then
        raise exception '[alasan pembatalan wajib diisi]' using errcode = 'check_violation';
      end if;
      if new.deliverable_type = 'Live Session' then new.hours_logged := 0; end if;
    end if;
    -- payout_id hanya diisi sistem (create_creator_payout).
    if new.payout_id is distinct from old.payout_id
       and current_setting('msdps.payout_ctx', true) is distinct from '1' then
      raise exception '[payout hanya dapat dibentuk melalui Payment Request]'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.code is null then new.code := next_code('BKG');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_bookings_validate before insert or update on creator_bookings
  for each row execute function bookings_validate();
create trigger trg_bookings_status before update on creator_bookings
  for each row execute function enforce_status_transition('creator_booking');
create trigger trg_bookings_audit after insert or update on creator_bookings
  for each row execute function capture_audit('creator_booking');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('creator_booking','[Sourcing/Negotiation]','[Booked]',       null),
  ('creator_booking','[Booked]','[In Production]',              null),
  ('creator_booking','[In Production]','[Delivered]',           null),
  ('creator_booking','[Sourcing/Negotiation]','[Cancelled]',    null),
  ('creator_booking','[Booked]','[Cancelled]',                  null),
  ('creator_booking','[In Production]','[Cancelled]',           null);

-- ---- Akumulator creator + Completion % Brief (M9 §3.4 step 6–7) ---------------
create or replace function bookings_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brief    briefs%rowtype;
  v_type     bkg_deliverable;
  v_done     numeric;
  v_pct      numeric;
begin
  -- Recompute metrik lifetime creator (derived, M9 §4.2).
  update creators c set
    total_videos_delivered = (select count(*) from creator_bookings b
      where b.creator_id = c.id and b.deliverable_type = 'Video' and b.status = '[Delivered]'),
    total_live_hours = coalesce((select sum(b.hours_logged) from creator_bookings b
      where b.creator_id = c.id and b.deliverable_type = 'Live Session' and b.status = '[Delivered]'), 0),
    total_gmv = coalesce((select sum(b.gmv_generated) from creator_bookings b
      where b.creator_id = c.id and b.status = '[Delivered]'), 0),
    gmv_deliverable_count = (select count(*) from creator_bookings b
      where b.creator_id = c.id and b.status = '[Delivered]' and coalesce(b.gmv_generated,0) > 0)
  where c.id = new.creator_id;

  -- Completion % Brief: Video = Delivered/Target; Live = jam Delivered/Target.
  select * into v_brief from briefs where id = new.brief_id;
  v_type := new.deliverable_type;
  if v_type = 'Video' then
    select count(*) into v_done from creator_bookings
    where brief_id = new.brief_id and status = '[Delivered]';
  else
    select coalesce(sum(hours_logged),0) into v_done from creator_bookings
    where brief_id = new.brief_id and status = '[Delivered]';
  end if;

  v_pct := case when coalesce(v_brief.quantity_target,0) > 0
                then round(v_done / v_brief.quantity_target * 100, 1) else 0 end;

  update briefs set completion_pct = least(v_pct, 100) where id = new.brief_id;

  if v_pct >= 100 then
    update briefs set status = '[Completed]'
    where id = new.brief_id and status in ('[In Progress]','[Overdue]');
  end if;
  return null;
end $$;

create trigger trg_bookings_after after insert or update on creator_bookings
  for each row execute function bookings_after_change();

-- ---- FK yang ditunda dari M5 ---------------------------------------------------
alter table creator_payouts
  add constraint creator_payouts_creator_fk
  foreign key (creator_id) references creators(id);

-- =============================================================================
-- create_creator_payout(): Payment Request saat milestone tercapai (M9 §3.3)
--   PYO-Video : per 10 video [Delivered] belum dibayar (lintas merchant)
--   PYO-Live  : akumulasi >= 5 jam live [Delivered] belum dibayar
-- =============================================================================
create or replace function create_creator_payout(
  p_creator_id  uuid,
  p_payout_type payout_type,
  p_amount      numeric
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ids       uuid[] := '{}';
  v_hours     numeric := 0;
  v_merchants uuid[];
  v_payout    uuid;
  r           record;
begin
  if not (is_od() or is_director() or auth_division() = 'KOL') then
    raise exception '[hanya KOL Coordinator yang dapat membuat Payment Request]'
      using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception '[nominal payout wajib diisi]' using errcode = 'check_violation';
  end if;

  if p_payout_type = 'PYO-Video' then
    select coalesce(array_agg(id),'{}') into v_ids from (
      select id from creator_bookings
      where creator_id = p_creator_id and deliverable_type = 'Video'
        and status = '[Delivered]' and payout_id is null
      order by delivered_at limit 10
    ) t;
    if coalesce(array_length(v_ids,1),0) < 10 then
      raise exception '[milestone belum tercapai: butuh 10 video Delivered yang belum dibayar]'
        using errcode = 'check_violation';
    end if;
  else
    for r in
      select id, hours_logged from creator_bookings
      where creator_id = p_creator_id and deliverable_type = 'Live Session'
        and status = '[Delivered]' and payout_id is null
      order by delivered_at
    loop
      v_ids := v_ids || r.id;
      v_hours := v_hours + coalesce(r.hours_logged,0);
      exit when v_hours >= 5;
    end loop;
    if v_hours < 5 then
      raise exception '[milestone belum tercapai: butuh akumulasi 5 jam live Delivered yang belum dibayar]'
        using errcode = 'check_violation';
    end if;
  end if;

  -- merchant_id terisi hanya kalau seluruh batch dari satu merchant.
  select array_agg(distinct s.merchant_id) into v_merchants
  from creator_bookings b
  join briefs br on br.id = b.brief_id
  join services s on s.id = br.service_id
  where b.id = any(v_ids);

  insert into creator_payouts (payout_type, referenced_bookings, merchant_id, creator_id, amount, requested_by)
  values (p_payout_type, v_ids,
          case when array_length(v_merchants,1) = 1 then v_merchants[1] end,
          p_creator_id, p_amount, auth.uid())
  returning id into v_payout;

  perform set_config('msdps.payout_ctx','1', true);
  update creator_bookings set payout_id = v_payout where id = any(v_ids);
  perform set_config('msdps.payout_ctx','0', true);

  return v_payout;
end $$;

-- ---- RLS ----------------------------------------------------------------------
alter table creators enable row level security;
create policy creators_select on creators for select to authenticated
  using (is_od() or is_director() or auth_division() in ('KOL','Account','Finance'));
create policy creators_insert on creators for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'KOL');
create policy creators_update on creators for update to authenticated
  using (is_od() or is_director() or auth_division() = 'KOL');

alter table creator_bookings enable row level security;
create policy bkg_select on creator_bookings for select to authenticated
  using (is_od() or is_director() or auth_division() in ('KOL','Account','Finance'));
create policy bkg_insert on creator_bookings for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'KOL');
create policy bkg_update on creator_bookings for update to authenticated
  using (is_od() or is_director() or auth_division() = 'KOL');

-- ---- Function grants -----------------------------------------------------------
revoke execute on function creators_validate()     from public, anon, authenticated;
revoke execute on function bookings_validate()     from public, anon, authenticated;
revoke execute on function bookings_after_change() from public, anon, authenticated;

revoke execute on function create_creator_payout(uuid,payout_type,numeric) from public, anon;
grant  execute on function create_creator_payout(uuid,payout_type,numeric) to authenticated;
