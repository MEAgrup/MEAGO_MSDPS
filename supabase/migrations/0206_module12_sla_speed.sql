-- =============================================================================
-- MSDPS · Module 12 — Task Execution & SLA / Speed Score
-- =============================================================================
-- PRD M12 (LOCKED 30 Jun 2026) + keputusan terkunci:
--   * SLA per tipe unit: E-com 3 hari kerja/20 SKU (pro-rata, level Brief),
--     Ads 6 hari kerja pick-up -> campaign [Live], KOL 5 HARI KERJA (keputusan
--     Yohan di 0006, override draft PRD 7 hari) [Booked] -> [Delivered],
--     Live Stream SLA MULAI: sesi/LSR pertama <= 3 hari kerja setelah
--     [Diteruskan ke Vendor] (bukan SLA eksekusi — vendor-driven).
--   * Speed Score 3 tingkat: On-Time (<= SLA), Slight Delay (<= 1.5x), Late.
--   * Block-request formal per BRIEF: staff ajukan -> SPV/Lead approve ->
--     Brief [Blocked]. Blocked-time dikecualikan dari SLA. Selaras Fase C.2:
--     auto-timer Brief memang berhenti saat [Blocked], jadi work_time_seconds
--     sudah bebas blocked-time secara inheren.
--   * Reject tanpa field alasan (konsisten keputusan CDPS).
--   * Speed Score = measurement murni (feed M14), tidak pernah hard-gate.
-- Durasi diukur dalam HARI KERJA antar transisi status (sumber: audit_log yang
-- immutable), dikurangi hari kerja blocked yang di-approve.
-- =============================================================================

-- ---- Helper: hitung hari kerja di antara dua tanggal ------------------------
-- Konsisten dengan add_working_days(): menghitung hari kerja pada rentang
-- (p_from, p_to]. deadline = add_working_days(start, N)  <=>  on-time selama
-- working_days_between(start, selesai) <= N.
create or replace function working_days_between(p_from date, p_to date)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare
  v_count int := 0;
  v_date date := p_from;
  v_is_working boolean;
begin
  if p_to is null or p_from is null or p_to <= p_from then return 0; end if;
  while v_date < p_to loop
    v_date := v_date + 1;
    select is_working_day into v_is_working from working_calendar where cal_date = v_date;
    if v_is_working is null then
      v_is_working := extract(isodow from v_date) < 6;   -- default Sen-Jum
    end if;
    if v_is_working then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

comment on function working_days_between(date, date) is 'Jumlah hari kerja pada rentang (from, to]. Pasangan add_working_days() untuk cek SLA.';

-- ---- Entity: Block Request (BLK-YYYYMM-NNNN) --------------------------------
create type blk_status as enum ('[Pending]','[Approved]','[Rejected]');

create table block_requests (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  brief_id          uuid not null references briefs(id),
  requested_by      uuid not null references employees(id),
  reason            text not null,                     -- wajib
  status            blk_status not null default '[Pending]',
  approver          uuid references employees(id),     -- wajib saat diputuskan
  blocked_from      timestamptz,                       -- rentang exclusion
  blocked_to        timestamptz,
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz
);

comment on table block_requests is 'M12: jalur formal staff minta Brief [Blocked]. Approve (>= lead) -> Brief [Blocked] + jam blocked dikecualikan dari SLA. Reject tanpa alasan.';

-- Satu permintaan terbuka per brief (pending ATAU approved yang belum resume).
create unique index blk_one_pending_per_brief on block_requests (brief_id) where status = '[Pending]';
create unique index blk_one_active_per_brief  on block_requests (brief_id) where status = '[Approved]' and blocked_to is null;

insert into status_transitions (entity, from_status, to_status, allowed_tokens, note) values
  ('block_request','[Pending]','[Approved]','{lead,od,director}','M12: approve block minimal SPV/Lead'),
  ('block_request','[Pending]','[Rejected]','{lead,od,director}','M12: reject tanpa field alasan');

create or replace function blk_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brief briefs%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.reason is null or btrim(new.reason) = '' then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;
    select * into v_brief from briefs where id = new.brief_id;
    if not found then raise exception '[brief tidak ditemukan]'; end if;
    if v_brief.status not in ('[In Progress]','[Overdue]') then
      raise exception '[block hanya dapat diajukan untuk Brief yang sedang berjalan]'
        using errcode = 'check_violation';
    end if;
    if not (is_od() or is_director()
            or auth_division() = v_brief.assigned_division
            or auth_division() = 'Account') then
      raise exception '[anda tidak berwenang mengajukan block untuk Brief ini]'
        using errcode = 'insufficient_privilege';
    end if;
    new.requested_by := coalesce(new.requested_by, auth.uid());
    new.status       := '[Pending]';
    new.approver     := null;
    new.blocked_from := null;
    new.blocked_to   := null;
  end if;

  if tg_op = 'UPDATE' then
    if new.brief_id is distinct from old.brief_id
       or new.requested_by is distinct from old.requested_by then
      raise exception '[referensi block request tidak dapat diubah]'
        using errcode = 'check_violation';
    end if;
    -- Kolom rentang blocked = derived; hanya trigger yang mengubah.
    new.blocked_from := old.blocked_from;
    new.blocked_to   := old.blocked_to;

    if new.status is distinct from old.status then
      if new.status = '[Approved]' then
        select * into v_brief from briefs where id = new.brief_id;
        if v_brief.status not in ('[In Progress]','[Overdue]') then
          raise exception '[brief sudah tidak dalam status berjalan — block tidak relevan]'
            using errcode = 'check_violation';
        end if;
        new.approver     := auth.uid();
        new.blocked_from := now();
      elsif new.status = '[Rejected]' then
        new.approver := auth.uid();
      end if;
    end if;
  end if;

  if new.code is null then new.code := next_code('BLK');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Approve -> Brief pindah [Blocked] (state machine brief tetap yang memvalidasi;
-- auto-timer Fase C.2 berhenti otomatis = exclusion berjalan sendiri).
create or replace function blk_apply_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = '[Approved]' and old.status = '[Pending]' then
    update briefs set status = '[Blocked]'
    where id = new.brief_id and status in ('[In Progress]','[Overdue]');
  end if;
  return null;
end $$;

create trigger trg_blk_validate before insert or update on block_requests
  for each row execute function blk_validate();
create trigger trg_blk_status before update on block_requests
  for each row execute function enforce_status_transition('block_request');
create trigger trg_blk_apply after update on block_requests
  for each row execute function blk_apply_block();
create trigger trg_blk_audit after insert or update on block_requests
  for each row execute function capture_audit('block_request');

-- Brief resume/keluar dari [Blocked] -> tutup rentang blocked (blocked_to).
create or replace function briefs_close_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = '[Blocked]' and new.status is distinct from old.status then
    update block_requests set blocked_to = now()
    where brief_id = new.id and status = '[Approved]' and blocked_to is null;
  end if;
  return null;
end $$;

create trigger trg_briefs_close_block after update on briefs
  for each row execute function briefs_close_block();

-- Formalisasi M12: staff tidak lagi menandai [Blocked] langsung — harus lewat
-- block-request. Transisi langsung ke [Blocked] kini minimal lead.
update status_transitions set allowed_tokens = '{lead,od,director}'
where entity = 'brief' and to_status = '[Blocked]';

-- ---- RLS ---------------------------------------------------------------------
alter table block_requests enable row level security;

create policy blk_select on block_requests for select to authenticated
  using (
    is_od() or is_director() or requested_by = auth.uid()
    or auth_division() = 'Account'
    or exists (select 1 from briefs b where b.id = brief_id
               and b.assigned_division = auth_division())
  );

create policy blk_insert on block_requests for insert to authenticated
  with check (requested_by = auth.uid());

create policy blk_update on block_requests for update to authenticated
  using (
    is_od() or is_director()
    or (is_lead() and exists (select 1 from briefs b where b.id = brief_id
                              and b.assigned_division = auth_division()))
  );

-- ---- v_speed_score -------------------------------------------------------------
-- Durasi hari-kerja antar transisi (audit_log) dikurangi blocked hari-kerja yang
-- di-approve. View berjalan sebagai owner (bisa baca audit_log yang RLS-nya
-- OD/Director-only), maka role-gate ditanam EKSPLISIT di WHERE (pola alternatif
-- yang dicatat di BUILD_PLAN Fase B).
create view v_speed_score as
with brief_start as (
  select entity_id, min(at) as ts from audit_log
  where entity = 'brief' and action = 'STATUS_CHANGE' and after->>'status' = '[In Progress]'
  group by entity_id
),
brief_done as (
  select entity_id, min(at) as ts from audit_log
  where entity = 'brief' and action = 'STATUS_CHANGE' and after->>'status' = '[Completed]'
  group by entity_id
),
brief_forwarded as (
  select entity_id, min(at) as ts from audit_log
  where entity = 'brief' and action = 'STATUS_CHANGE' and after->>'status' = '[Diteruskan ke Vendor]'
  group by entity_id
),
adc_live as (
  select a.brief_id, min(l.at) as ts
  from ad_campaign_records a
  join audit_log l on l.entity = 'ad_campaign' and l.entity_id = a.id
                  and l.action = 'STATUS_CHANGE' and l.after->>'status' = '[Live]'
  group by a.brief_id
),
bkg_booked as (
  select entity_id, min(at) as ts from audit_log
  where entity = 'creator_booking' and action = 'STATUS_CHANGE' and after->>'status' = '[Booked]'
  group by entity_id
),
lsr_first as (
  select brief_id, min(uploaded_at) as ts from live_stream_results group by brief_id
),
blocked as (
  select brief_id,
         coalesce(sum(working_days_between(blocked_from::date, coalesce(blocked_to, now())::date)), 0) as wd
  from block_requests where status = '[Approved]'
  group by brief_id
),
units as (
  -- E-commerce: SLA batch level Brief, 3 hk / 20 SKU pro-rata
  select 'E-commerce Batch'::text as kind, b.assigned_division as division,
         b.id as brief_id, b.code as brief_code, null::uuid as unit_id, null::text as unit_code,
         b.service_id, b.assigned_pic as staff_id,
         round(coalesce(nullif(b.quantity_target, 0), 20) / 20.0 * 3, 2) as sla_working_days,
         s.ts as started_at, d.ts as finished_at
  from briefs b
  left join brief_start s on s.entity_id = b.id
  left join brief_done  d on d.entity_id = b.id
  where b.assigned_division = 'Ecommerce'
    and b.status not in ('[Cancelled - Service Voided]')

  union all
  -- Ads: 6 hk dari pick-up Brief sampai campaign pertama [Live]
  select 'Ads Go-Live', b.assigned_division, b.id, b.code, null, null,
         b.service_id, b.assigned_pic, 6,
         s.ts, g.ts
  from briefs b
  left join brief_start s on s.entity_id = b.id
  left join adc_live    g on g.brief_id  = b.id
  where b.assigned_division = 'Ads'
    and b.status not in ('[Cancelled - Service Voided]')

  union all
  -- KOL: 5 hk per booking, [Booked] -> [Delivered] (keputusan 0006, override PRD 7)
  select 'KOL Booking', b.assigned_division, b.id, b.code, k.id, k.code,
         b.service_id, coalesce(k.created_by, b.assigned_pic), 5,
         bk.ts, k.delivered_at
  from creator_bookings k
  join briefs b on b.id = k.brief_id
  left join bkg_booked bk on bk.entity_id = k.id
  where k.status not in ('[Cancelled]')
    and bk.ts is not null

  union all
  -- Live Stream: SLA MULAI — sesi/LSR pertama <= 3 hk setelah diteruskan ke vendor
  select 'Live Stream Start', b.assigned_division, b.id, b.code, null, null,
         b.service_id, m.am_id, 3,
         coalesce(f.ts, case when b.status = '[Diteruskan ke Vendor]' then b.status_changed_at end),
         l.ts
  from briefs b
  join services sv on sv.id = b.service_id
  join merchants m on m.id = sv.merchant_id
  left join brief_forwarded f on f.entity_id = b.id
  left join lsr_first       l on l.brief_id  = b.id
  where b.assigned_division = 'LiveStream'
    and b.status not in ('[Cancelled - Service Voided]','[Menunggu Forward ke Vendor]')
)
select u.kind, u.division, u.brief_id, u.brief_code, u.unit_id, u.unit_code,
       m.id as merchant_id, m.nama_toko as merchant_name, m.am_id,
       u.staff_id, e.full_name as staff_name,
       u.sla_working_days, u.started_at, u.finished_at,
       coalesce(bl.wd, 0) as blocked_working_days,
       greatest(0, working_days_between(u.started_at::date, coalesce(u.finished_at, now())::date)
                   - coalesce(bl.wd, 0)) as elapsed_working_days,
       add_working_days(u.started_at::date,
                        u.sla_working_days + coalesce(bl.wd, 0)) as deadline_date,
       case
         when u.started_at is null then '[Belum Mulai]'
         when u.finished_at is null then
           case when now()::date > add_working_days(u.started_at::date, u.sla_working_days + coalesce(bl.wd, 0))
                then '[Berjalan - Lewat SLA]' else '[Berjalan]' end
         when working_days_between(u.started_at::date, u.finished_at::date) - coalesce(bl.wd, 0)
              <= u.sla_working_days then '[On-Time]'
         when working_days_between(u.started_at::date, u.finished_at::date) - coalesce(bl.wd, 0)
              <= u.sla_working_days * 1.5 then '[Slight Delay]'
         else '[Late]'
       end as speed_score
from units u
join services sv on sv.id = u.service_id
join merchants m on m.id = sv.merchant_id
left join employees e on e.id = u.staff_id
left join blocked bl on bl.brief_id = u.brief_id
where is_od() or is_director()
   or auth_division() = 'Account'
   or u.division = auth_division();

comment on view v_speed_score is 'M12: SLA & Speed Score per unit terukur (hari kerja, blocked-time approved dikecualikan). Role-gate ditanam di WHERE karena view membaca audit_log.';

-- ---- Grants --------------------------------------------------------------------
revoke execute on function blk_validate()        from public, anon, authenticated;
revoke execute on function blk_apply_block()     from public, anon, authenticated;
revoke execute on function briefs_close_block()  from public, anon, authenticated;
grant execute on function working_days_between(date, date) to authenticated;
grant select on v_speed_score to authenticated;
