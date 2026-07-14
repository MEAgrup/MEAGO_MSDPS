-- =============================================================================
-- MSDPS · Module 14 — Team Performance (auto-generated)
-- =============================================================================
-- PRD M14 (LOCKED 30 Jun 2026):
--   * Performance Score (PERF-) per staff per MINGGU, semua derived (tidak ada
--     input skor manual). Bobot seragam: Output 40% / Speed 30% / Quality 30%.
--   * Tiap komponen DINORMALISASI 0–100 relatif target role (okr_targets,
--     fallback default) -> composite apple-to-apple lintas role.
--   * Komponen per role:
--       E-com: SKU [Approved] | Speed Score SLA batch | sinyal revisi
--       Ads:   campaign go-live + WPE tepat waktu | SLA go-live | revisi
--       KOL:   video delivered / jam live | SLA booking | GMV-generating
--              (KOL TIDAK dinilai dari revisi — M9)
--       AM:    health portfolio (M13) | ketepatan pickup review | complaint
--              handling tepat waktu
--   * Fairness: blocked-time exclusion diwarisi dari M12; skor = measurement,
--     bukan auto-punishment (skor rendah -> daftar coaching, M15).
--   * Staff tanpa aktivitas terukur minggu itu TIDAK diberi baris (bukan nol).
--   * Komponen yang null tidak menghukum: bobot dinormalisasi ulang atas
--     komponen yang tersedia.
-- v_okr_attainment (dijanjikan sejak 0007): attainment kuartalan per target.
-- =============================================================================

create table performance_scores (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null,
  staff_id         uuid not null references employees(id),
  role             perf_role not null,
  week_start       date not null,
  composite_score  numeric not null,
  output_component numeric,
  speed_component  numeric,
  quality_component numeric,
  details          jsonb not null default '{}'::jsonb,
  trend            text not null default '→' check (trend in ('↑','→','↓')),
  created_at       timestamptz not null default now(),
  unique (staff_id, week_start)
);

comment on table performance_scores is 'M14: skor performa mingguan per staff (derived-only, immutable). Output 40 / Speed 30 / Quality 30, ternormalisasi vs target role.';

create trigger trg_perf_no_update before update on performance_scores
  for each row execute function audit_immutable();
create trigger trg_perf_no_delete before delete on performance_scores
  for each row execute function audit_immutable();
create trigger trg_perf_audit after insert on performance_scores
  for each row execute function capture_audit('performance_score');

-- ---- Target helper --------------------------------------------------------------
create or replace function okr_target_value(p_period text, p_role perf_role, p_metric text, p_default numeric)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select target_value from okr_targets
     where period = p_period and role = p_role and metric = p_metric and active
     limit 1),
    p_default);
$$;

-- ---- Compute mingguan -------------------------------------------------------------
create or replace function generate_performance_scores(p_week_start date default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_week date; v_end date; v_q text;
  v_count int := 0;
  e record;
  v_role perf_role;
  v_output numeric; v_speed numeric; v_quality numeric;
  v_details jsonb;
  v_actual numeric; v_target numeric;
  v_videos numeric; v_hours numeric; v_nv numeric; v_nh numeric;
  v_rev numeric; v_base numeric;
  v_score numeric; v_wsum numeric;
  v_prev numeric; v_trend text;
begin
  if auth.uid() is not null and not (is_od() or is_director()) then
    raise exception '[hanya OD/Director yang dapat men-generate skor performa manual]'
      using errcode = 'insufficient_privilege';
  end if;

  v_week := coalesce(p_week_start,
                     (date_trunc('week', (now() at time zone 'Asia/Jakarta')::date::timestamp))::date - 7);
  v_week := (date_trunc('week', v_week::timestamp))::date;
  v_end  := v_week + 6;
  v_q    := to_char(v_end, 'YYYY-"Q"Q');

  for e in
    select * from employees
    where active and not is_od and not is_director and rank = 'staff'
      and division in ('Ecommerce','Ads','KOL','Account')
  loop
    v_output := null; v_speed := null; v_quality := null; v_details := '{}'::jsonb;
    v_role := case e.division when 'Account' then 'AM' else e.division::text::perf_role end;

    if exists (select 1 from performance_scores p
               where p.staff_id = e.id and p.week_start = v_week) then
      continue;
    end if;

    if e.division = 'Ecommerce' then
      select count(*) into v_actual from sku_work_units
      where assigned_staff = e.id and status = '[Approved]'
        and approved_at::date between v_week and v_end;
      v_target := okr_target_value(v_q, 'Ecommerce', 'sku_approved_per_week', 20);
      if v_actual > 0 then v_output := least(100, v_actual / v_target * 100); end if;

      select count(*) into v_rev from audit_log al
      where al.entity = 'sku_unit' and al.action = 'STATUS_CHANGE'
        and al.after->>'status' = '[Revision Requested]'
        and al.at::date between v_week and v_end
        and exists (select 1 from sku_work_units su
                    where su.id = al.entity_id and su.assigned_staff = e.id);
      if v_actual + v_rev > 0 then
        v_quality := round(100.0 * v_actual / (v_actual + v_rev), 1);
      end if;
      v_details := jsonb_build_object('sku_approved', v_actual, 'revisions', v_rev, 'target', v_target);

    elsif e.division = 'Ads' then
      select (select count(*) from audit_log al
              join ad_campaign_records a on a.id = al.entity_id
              where al.entity = 'ad_campaign' and al.action = 'STATUS_CHANGE'
                and al.after->>'status' = '[Live]'
                and al.at::date between v_week and v_end
                and a.assigned_staff = e.id)
           + (select count(*) from weekly_performance_entries w
              where w.created_by = e.id
                and w.submitted_at::date between v_week and v_end)
      into v_actual;
      v_target := okr_target_value(v_q, 'Ads', 'ads_outputs_per_week', 5);
      if v_actual > 0 then v_output := least(100, v_actual / v_target * 100); end if;

      select count(*) into v_base from audit_log al
      join ad_campaign_records a on a.id = al.entity_id
      where al.entity = 'ad_campaign' and al.action = 'STATUS_CHANGE'
        and al.after->>'status' = '[Live]'
        and al.at::date between v_week and v_end and a.assigned_staff = e.id;
      select count(*) into v_rev from audit_log al
      join ad_campaign_records a on a.id = al.entity_id
      where al.entity = 'ad_campaign' and al.action = 'STATUS_CHANGE'
        and al.after->>'status' = '[Revision Requested]'
        and al.at::date between v_week and v_end and a.assigned_staff = e.id;
      if v_base + v_rev > 0 then
        v_quality := round(100.0 * v_base / (v_base + v_rev), 1);
      end if;
      v_details := jsonb_build_object('ads_outputs', v_actual, 'revisions', v_rev, 'target', v_target);

    elsif e.division = 'KOL' then
      select count(*) into v_videos from creator_bookings
      where created_by = e.id and status = '[Delivered]' and deliverable_type = 'Video'
        and delivered_at::date between v_week and v_end;
      select coalesce(sum(hours_logged), 0) into v_hours from creator_bookings
      where created_by = e.id and status = '[Delivered]' and deliverable_type = 'Live Session'
        and delivered_at::date between v_week and v_end;
      v_nv := v_videos / okr_target_value(v_q, 'KOL', 'videos_delivered_per_week', 3) * 100;
      v_nh := v_hours  / okr_target_value(v_q, 'KOL', 'live_hours_per_week', 10) * 100;
      if v_videos > 0 and v_hours > 0 then v_output := least(100, (v_nv + v_nh) / 2);
      elsif v_videos > 0 then v_output := least(100, v_nv);
      elsif v_hours  > 0 then v_output := least(100, v_nh);
      end if;

      -- Kualitas KOL = deliverable yang menghasilkan GMV (BUKAN revisi — M9)
      select count(*) filter (where coalesce(gmv_generated, 0) > 0), count(*)
      into v_rev, v_base
      from creator_bookings
      where created_by = e.id and status = '[Delivered]'
        and delivered_at::date between v_week and v_end;
      if v_base > 0 then v_quality := round(100.0 * v_rev / v_base, 1); end if;
      v_details := jsonb_build_object('videos', v_videos, 'live_hours', v_hours,
                                      'gmv_generating', v_rev, 'delivered', v_base);

    else  -- Account => AM
      select avg(h.composite_score) into v_actual
      from merchant_health_snapshots h
      join merchants m on m.id = h.merchant_id
      where m.am_id = e.id and h.week_start = v_week;
      v_target := okr_target_value(v_q, 'AM', 'merchant_health_avg', 75);
      if v_actual is not null then v_output := least(100, v_actual / v_target * 100); end if;

      -- Speed AM: pickup review SKU <= 1 hari kerja setelah submit
      select round(100.0 * count(*) filter (
               where working_days_between(su.submitted_at::date, al.at::date) <= 1)
             / count(*), 1)
      into v_speed
      from audit_log al
      join sku_work_units su on su.id = al.entity_id
      where al.entity = 'sku_unit' and al.action = 'STATUS_CHANGE'
        and al.after->>'status' = '[In Review - AM]'
        and al.actor = e.id
        and al.at::date between v_week and v_end
        and su.submitted_at is not null
      having count(*) > 0;

      -- Quality AM: komplain selesai <= 3 hari kerja dari dibuat
      select round(100.0 * count(*) filter (
               where working_days_between(c.created_at::date, c.status_changed_at::date) <= 3)
             / count(*), 1)
      into v_quality
      from complaints c
      where c.assigned_to = e.id and c.status in ('[Resolved]','[Closed]')
        and c.status_changed_at::date between v_week and v_end
      having count(*) > 0;

      v_details := jsonb_build_object('portfolio_health', round(coalesce(v_actual, 0), 1),
                                      'target', v_target);
    end if;

    -- Speed dari M12 (E-com/Ads/KOL): unit selesai minggu ini milik staff
    if e.division in ('Ecommerce','Ads','KOL') then
      select avg(case speed_score when '[On-Time]' then 100
                                  when '[Slight Delay]' then 60
                                  when '[Late]' then 20 end)
      into v_speed
      from v_speed_score_internal
      where staff_id = e.id
        and finished_at::date between v_week and v_end;
    end if;

    -- Composite: bobot 40/30/30 dinormalisasi ulang atas komponen tersedia
    v_score := 0; v_wsum := 0;
    if v_output  is not null then v_score := v_score + 0.4 * v_output;  v_wsum := v_wsum + 0.4; end if;
    if v_speed   is not null then v_score := v_score + 0.3 * v_speed;   v_wsum := v_wsum + 0.3; end if;
    if v_quality is not null then v_score := v_score + 0.3 * v_quality; v_wsum := v_wsum + 0.3; end if;
    if v_wsum = 0 then continue; end if;   -- tanpa aktivitas terukur -> tanpa baris
    v_score := greatest(0, least(100, round(v_score / v_wsum)));

    select composite_score into v_prev from performance_scores
    where staff_id = e.id and week_start = v_week - 7;
    v_trend := case when v_prev is null then '→'
                    when v_score - v_prev >= 3 then '↑'
                    when v_score - v_prev <= -3 then '↓'
                    else '→' end;

    insert into performance_scores
      (code, staff_id, role, week_start, composite_score,
       output_component, speed_component, quality_component, details, trend)
    values
      (next_code('PERF'), e.id, v_role, v_week, v_score,
       round(v_output, 1), round(v_speed, 1), round(v_quality, 1), v_details, v_trend);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

comment on function generate_performance_scores(date) is 'M14: skor performa mingguan per staff. Cron Senin 00:45 WIB (minggu sebelumnya); manual hanya OD/Director. Staff tanpa aktivitas tidak diberi baris.';

-- ---- Seed target OKR default 2026-Q3 (OD/Director bebas supersede) ----------------
insert into okr_targets (period, role, metric, target_value, comparator, set_by)
select '2026-Q3', v.role::perf_role, v.metric, v.target, 'gte',
       (select id from employees where is_director order by created_at limit 1)
from (values
  ('Ecommerce', 'sku_approved_per_week',     20::numeric),
  ('Ads',       'ads_outputs_per_week',       5),
  ('Ads',       'roas',                       4),
  ('KOL',       'videos_delivered_per_week',  3),
  ('KOL',       'live_hours_per_week',       10),
  ('AM',        'merchant_health_avg',       75)
) as v(role, metric, target)
where not exists (select 1 from okr_targets t
                  where t.period = '2026-Q3' and t.role = v.role::perf_role
                    and t.metric = v.metric and t.active);

-- ---- v_okr_attainment ---------------------------------------------------------------
-- Attainment kuartal-berjalan per target aktif. Definer + role-gate eksplisit
-- (cermin okr_select) karena menghitung dari tabel lintas divisi + audit_log.
create view v_okr_attainment as
with bounds as (
  select t.*,
         make_date(left(t.period, 4)::int, (right(t.period, 1)::int - 1) * 3 + 1, 1) as q_start,
         (make_date(left(t.period, 4)::int, (right(t.period, 1)::int - 1) * 3 + 1, 1)
          + interval '3 months')::date as q_end
  from okr_targets t
  where t.active and t.period ~ '^\d{4}-Q[1-4]$'
),
calc as (
  select b.*,
         greatest(1, ceil((least(current_date, b.q_end) - b.q_start) / 7.0)) as weeks_elapsed,
         case b.metric
           when 'sku_approved_per_week' then
             (select count(*)::numeric from sku_work_units su
              where su.status = '[Approved]'
                and su.approved_at::date >= b.q_start and su.approved_at::date < b.q_end)
           when 'ads_outputs_per_week' then
             (select count(*)::numeric from audit_log al
              where al.entity = 'ad_campaign' and al.action = 'STATUS_CHANGE'
                and al.after->>'status' = '[Live]'
                and al.at::date >= b.q_start and al.at::date < b.q_end)
             + (select count(*)::numeric from weekly_performance_entries w
                where w.submitted_at::date >= b.q_start and w.submitted_at::date < b.q_end)
           when 'videos_delivered_per_week' then
             (select count(*)::numeric from creator_bookings k
              where k.status = '[Delivered]' and k.deliverable_type = 'Video'
                and k.delivered_at::date >= b.q_start and k.delivered_at::date < b.q_end)
           when 'live_hours_per_week' then
             (select coalesce(sum(k.hours_logged), 0) from creator_bookings k
              where k.status = '[Delivered]' and k.deliverable_type = 'Live Session'
                and k.delivered_at::date >= b.q_start and k.delivered_at::date < b.q_end)
           when 'roas' then
             (select avg(w.roas) from weekly_performance_entries w
              where w.submitted_at::date >= b.q_start and w.submitted_at::date < b.q_end)
           when 'merchant_health_avg' then
             (select avg(h.composite_score) from merchant_health_snapshots h
              where h.week_start >= b.q_start and h.week_start < b.q_end)
           else null
         end as raw_actual
  from bounds b
)
select c.period, c.role, c.metric, c.target_value, c.comparator,
       case when c.metric like '%_per_week'
            then round(coalesce(c.raw_actual, 0) / c.weeks_elapsed, 2)
            else round(c.raw_actual, 2) end as actual_value,
       case
         when c.comparator = 'gte' then
           round(coalesce(case when c.metric like '%_per_week'
                               then c.raw_actual / c.weeks_elapsed
                               else c.raw_actual end, 0) / nullif(c.target_value, 0) * 100, 1)
         else
           round(c.target_value / nullif(case when c.metric like '%_per_week'
                                              then c.raw_actual / c.weeks_elapsed
                                              else c.raw_actual end, 0) * 100, 1)
       end as attainment_pct
from calc c
where is_od() or is_director()
   or (is_lead() and ((c.role = 'AM' and auth_division() = 'Account')
                      or c.role::text = auth_division()::text));

comment on view v_okr_attainment is 'M14: attainment OKR kuartal-berjalan per target aktif (metric *_per_week dirata-rata per minggu berjalan).';

-- ---- RLS ------------------------------------------------------------------------------
alter table performance_scores enable row level security;

create policy perf_select on performance_scores for select to authenticated
  using (
    staff_id = auth.uid() or is_od() or is_director()
    or (is_lead() and ((role = 'AM' and auth_division() = 'Account')
                       or role::text = auth_division()::text))
  );
-- Tidak ada policy tulis — baris hanya dari fungsi definer.

-- ---- Cron (Senin 00:45 WIB = Minggu 17:45 UTC; setelah health 00:30) -------------------
select cron.schedule('msdps_perf_weekly', '45 17 * * 0',
  $$select generate_performance_scores()$$);

-- ---- Grants ----------------------------------------------------------------------------
revoke execute on function okr_target_value(text, perf_role, text, numeric) from public, anon, authenticated;
grant execute on function generate_performance_scores(date) to authenticated;
grant select on v_okr_attainment to authenticated;
