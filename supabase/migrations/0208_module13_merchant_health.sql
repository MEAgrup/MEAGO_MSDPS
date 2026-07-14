-- =============================================================================
-- MSDPS · Module 13 — Merchant Health Report (auto-generated)
-- =============================================================================
-- PRD M13 (LOCKED 30 Jun 2026):
--   * Skor komposit 0–100 per merchant, snapshot MINGGUAN immutable (MHR-) +
--     rollup bulanan (MHRM-) untuk laporan merchant.
--   * Bobot: GMV 40% (ANTI DOUBLE-COUNT: pakai Total GMV otoritatif
--     merchant_gmv_authoritative; GMV channel hanya atribusi, tidak dijumlah),
--     Completion 30%, SLA 30%; komplain = penalti Low −5 / Medium −15 /
--     High −30; revisi berlebih E-com/Ads = penalti ringan (KOL tidak — M9).
--   * Band: Healthy >= 75, Watch 50–74, At Risk < 50.
--   * Fallback GMV: channel TERTINGGI (bukan jumlah) sebagai proxy konservatif,
--     ditandai [GMV Estimasi]; tanpa data sama sekali -> komponen netral 70.
--   * Tidak ada hard action otomatis; skor murni visibilitas (M11/M15).
-- Implementasi: pg_cron Senin 00:30 WIB menyusun snapshot minggu yang baru
-- selesai; RPC manual (OD/Director) untuk backfill/uji. Minggu yang sudah punya
-- snapshot dilewati (immutable).
-- =============================================================================

-- ---- Refactor v_speed_score: internal (tanpa role-gate, utk cron/definer) ----
-- Fungsi cron berjalan tanpa JWT sehingga role-gate WHERE membuat view kosong.
create view v_speed_score_internal as
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
  select 'Ads Go-Live', b.assigned_division, b.id, b.code, null, null,
         b.service_id, b.assigned_pic, 6,
         s.ts, g.ts
  from briefs b
  left join brief_start s on s.entity_id = b.id
  left join adc_live    g on g.brief_id  = b.id
  where b.assigned_division = 'Ads'
    and b.status not in ('[Cancelled - Service Voided]')

  union all
  select 'KOL Booking', b.assigned_division, b.id, b.code, k.id, k.code,
         b.service_id, coalesce(k.created_by, b.assigned_pic), 5,
         bk.ts, k.delivered_at
  from creator_bookings k
  join briefs b on b.id = k.brief_id
  left join bkg_booked bk on bk.entity_id = k.id
  where k.status not in ('[Cancelled]')
    and bk.ts is not null

  union all
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
left join blocked bl on bl.brief_id = u.brief_id;

comment on view v_speed_score_internal is 'M12 tanpa role-gate — HANYA untuk fungsi definer/cron (M13/M14). Tidak di-grant ke authenticated.';

-- View publik menjadi proyeksi ber-gate dari internal (kolom identik).
create or replace view v_speed_score as
select * from v_speed_score_internal
where is_od() or is_director()
   or auth_division() = 'Account'
   or division = auth_division();

revoke all on v_speed_score_internal from public, anon, authenticated;

-- ---- Entity: Merchant Health Snapshot (MHR-YYYYMM-NNNN) ----------------------
create table merchant_health_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique not null,
  merchant_id          uuid not null references merchants(id),
  week_start           date not null,            -- Senin minggu snapshot
  period               char(6) not null,         -- YYYYMM (bulan akhir minggu)
  composite_score      numeric not null,
  band                 text not null check (band in ('Healthy','Watch','At Risk')),
  gmv_component        numeric not null,
  gmv_value            numeric,
  gmv_estimated        boolean not null default false,
  completion_component numeric not null,
  sla_component        numeric not null,
  complaint_penalty    numeric not null default 0,
  revision_signal      numeric not null default 0,
  channel_gmv          jsonb not null default '{}'::jsonb,   -- atribusi, TIDAK masuk skor
  trend                text not null default '→' check (trend in ('↑','→','↓')),
  trend_driver         text,
  created_at           timestamptz not null default now(),
  unique (merchant_id, week_start)
);

comment on table merchant_health_snapshots is 'M13: snapshot mingguan Merchant Health (derived, immutable). GMV komponen = Total GMV otoritatif (anti double-count); channel_gmv murni atribusi.';

create table merchant_health_monthly (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null,
  merchant_id      uuid not null references merchants(id),
  period           char(6) not null,             -- YYYYMM
  avg_score        numeric not null,
  eom_band         text not null check (eom_band in ('Healthy','Watch','At Risk')),
  monthly_trend    text not null default '→' check (monthly_trend in ('↑','→','↓')),
  total_gmv        numeric,
  gmv_estimated    boolean not null default false,
  total_complaints int not null default 0,
  report_ready     boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (merchant_id, period)
);

comment on table merchant_health_monthly is 'M13: Monthly Health Summary per merchant (agregat snapshot mingguan) — siap di-feed ke laporan merchant.';

-- Immutable: histori tren tidak boleh ditulis ulang (konsisten audit_log).
create trigger trg_mhr_no_update before update on merchant_health_snapshots
  for each row execute function audit_immutable();
create trigger trg_mhr_no_delete before delete on merchant_health_snapshots
  for each row execute function audit_immutable();
create trigger trg_mhrm_no_update before update on merchant_health_monthly
  for each row execute function audit_immutable();
create trigger trg_mhrm_no_delete before delete on merchant_health_monthly
  for each row execute function audit_immutable();

create trigger trg_mhr_audit after insert on merchant_health_snapshots
  for each row execute function capture_audit('merchant_health');
create trigger trg_mhrm_audit after insert on merchant_health_monthly
  for each row execute function capture_audit('merchant_health_monthly');

-- ---- Compute: snapshot mingguan ----------------------------------------------
-- p_week_start default = Senin minggu SEBELUMNYA (dipakai cron Senin dini hari).
create or replace function generate_health_snapshots(p_week_start date default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_week  date;
  v_end   date;
  v_month char(6);
  v_count int := 0;
  r record;
  v_gmv numeric; v_gmv_est boolean; v_gmv_score numeric;
  v_ads numeric; v_kol numeric; v_live numeric;
  v_completion numeric; v_sla numeric;
  v_penalty numeric; v_rev numeric;
  v_score numeric; v_band text;
  v_prev merchant_health_snapshots%rowtype;
  v_trend text; v_driver text; v_delta numeric; v_best numeric;
begin
  if auth.uid() is not null and not (is_od() or is_director()) then
    raise exception '[hanya OD/Director yang dapat men-generate snapshot manual]'
      using errcode = 'insufficient_privilege';
  end if;

  v_week  := coalesce(p_week_start,
                      (date_trunc('week', (now() at time zone 'Asia/Jakarta')::date::timestamp))::date - 7);
  v_week  := (date_trunc('week', v_week::timestamp))::date;   -- normalisasi ke Senin
  v_end   := v_week + 6;
  v_month := to_char(v_end, 'YYYYMM');

  for r in
    select m.* from merchants m
    where exists (select 1 from services s where s.merchant_id = m.id)
      and not exists (select 1 from merchant_health_snapshots h
                      where h.merchant_id = m.id and h.week_start = v_week)
  loop
    -- 1) GMV 40% — otoritatif dulu; fallback channel TERTINGGI ([GMV Estimasi])
    select gmv_value into v_gmv from merchant_gmv_authoritative
    where merchant_id = r.id and period = v_month
    order by entered_at desc limit 1;
    v_gmv_est := false;

    select coalesce(sum(w.gmv_generated), 0) into v_ads
    from weekly_performance_entries w
    join ad_campaign_records a on a.id = w.campaign_record_id
    join briefs b on b.id = a.brief_id
    join services s on s.id = b.service_id
    where s.merchant_id = r.id and to_char(w.submitted_at, 'YYYYMM') = v_month;

    select coalesce(sum(k.gmv_generated), 0) into v_kol
    from creator_bookings k
    join briefs b on b.id = k.brief_id
    join services s on s.id = b.service_id
    where s.merchant_id = r.id and k.status = '[Delivered]'
      and to_char(k.delivered_at, 'YYYYMM') = v_month;

    select coalesce(sum(l.gmv), 0) into v_live
    from live_stream_results l
    join briefs b on b.id = l.brief_id
    join services s on s.id = b.service_id
    where s.merchant_id = r.id and to_char(l.uploaded_at, 'YYYYMM') = v_month;

    if v_gmv is null then
      v_gmv := nullif(greatest(v_ads, v_kol, v_live), 0);
      v_gmv_est := v_gmv is not null;
    end if;

    if v_gmv is null then
      v_gmv_score := 70; v_gmv_est := true;             -- tanpa data: netral
    elsif coalesce(r.target_gmv, 0) > 0 then
      v_gmv_score := least(100, v_gmv / r.target_gmv * 100);
    elsif coalesce(r.gmv_baseline, 0) > 0 then
      v_gmv_score := 50 + greatest(-50, least(50, (v_gmv - r.gmv_baseline) / r.gmv_baseline * 100));
    else
      v_gmv_score := 70;
    end if;

    -- 2) Completion 30% — rata-rata Completion % Brief merchant (non-cancel)
    select avg(b.completion_pct) into v_completion
    from briefs b join services s on s.id = b.service_id
    where s.merchant_id = r.id
      and b.status <> '[Cancelled - Service Voided]'
      and b.created_at::date <= v_end;
    v_completion := coalesce(v_completion, 70);

    -- 3) SLA 30% — unit selesai 28 hari terakhir: On-Time 100 / Slight 60 / Late 20
    select avg(case speed_score when '[On-Time]' then 100
                                when '[Slight Delay]' then 60
                                when '[Late]' then 20 end) into v_sla
    from v_speed_score_internal
    where merchant_id = r.id
      and finished_at::date > v_end - 28 and finished_at::date <= v_end;
    v_sla := coalesce(v_sla, 70);

    -- 4) Penalti komplain minggu ini (Low −5 / Medium −15 / High −30, cap 45)
    select least(45, coalesce(sum(case severity when 'Low' then 5
                                                when 'Medium' then 15
                                                when 'High' then 30 end), 0)) into v_penalty
    from complaints
    where merchant_id = r.id
      and created_at::date between v_week and v_end;

    -- 5) Sinyal revisi minggu ini (E-com/Ads/Brief; KOL TIDAK — M9), 2 poin/revisi cap 10
    select least(10, 2 * count(*)) into v_rev
    from audit_log al
    where al.action = 'STATUS_CHANGE'
      and al.after->>'status' = '[Revision Requested]'
      and al.at::date between v_week and v_end
      and ((al.entity = 'sku_unit' and exists (
              select 1 from sku_work_units su join briefs b on b.id = su.brief_id
              join services s on s.id = b.service_id
              where su.id = al.entity_id and s.merchant_id = r.id))
        or (al.entity = 'ad_campaign' and exists (
              select 1 from ad_campaign_records a join briefs b on b.id = a.brief_id
              join services s on s.id = b.service_id
              where a.id = al.entity_id and s.merchant_id = r.id))
        or (al.entity = 'brief' and exists (
              select 1 from briefs b join services s on s.id = b.service_id
              where b.id = al.entity_id and s.merchant_id = r.id
                and b.assigned_division in ('Ecommerce','Ads'))));

    v_score := greatest(0, least(100,
      round(0.4 * v_gmv_score + 0.3 * v_completion + 0.3 * v_sla - v_penalty - v_rev)));
    v_band  := case when v_score >= 75 then 'Healthy'
                    when v_score >= 50 then 'Watch'
                    else 'At Risk' end;

    -- Tren vs minggu sebelumnya + komponen penggerak terbesar
    select * into v_prev from merchant_health_snapshots
    where merchant_id = r.id and week_start = v_week - 7;
    if found then
      v_trend := case when v_score - v_prev.composite_score >= 3 then '↑'
                      when v_score - v_prev.composite_score <= -3 then '↓'
                      else '→' end;
      v_best := -1; v_driver := null;
      v_delta := abs(v_gmv_score - v_prev.gmv_component);
      if v_delta > v_best then v_best := v_delta; v_driver := 'GMV'; end if;
      v_delta := abs(v_completion - v_prev.completion_component);
      if v_delta > v_best then v_best := v_delta; v_driver := 'Completion'; end if;
      v_delta := abs(v_sla - v_prev.sla_component);
      if v_delta > v_best then v_best := v_delta; v_driver := 'SLA'; end if;
      v_delta := abs(v_penalty - v_prev.complaint_penalty);
      if v_delta > v_best then v_best := v_delta; v_driver := 'Complaints'; end if;
      v_delta := abs(v_rev - v_prev.revision_signal);
      if v_delta > v_best then v_best := v_delta; v_driver := 'Revisions'; end if;
    else
      v_trend := '→'; v_driver := null;
    end if;

    insert into merchant_health_snapshots
      (code, merchant_id, week_start, period, composite_score, band,
       gmv_component, gmv_value, gmv_estimated, completion_component, sla_component,
       complaint_penalty, revision_signal, channel_gmv, trend, trend_driver)
    values
      (next_code('MHR'), r.id, v_week, v_month, v_score, v_band,
       round(v_gmv_score, 1), v_gmv, v_gmv_est, round(v_completion, 1), round(v_sla, 1),
       v_penalty, v_rev,
       jsonb_build_object('ads', v_ads, 'kol', v_kol, 'live', v_live),
       v_trend, v_driver);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

comment on function generate_health_snapshots(date) is 'M13: snapshot mingguan Merchant Health. Cron Senin 00:30 WIB (minggu sebelumnya); manual hanya OD/Director. Minggu yang sudah ada dilewati (immutable).';

-- ---- Compute: Monthly Health Summary -------------------------------------------
create or replace function generate_health_monthly(p_period char(6) default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_period char(6);
  v_prev_period char(6);
  v_count int := 0;
  r record;
  v_gmv numeric; v_gmv_est boolean;
  v_prev_avg numeric;
  v_trend text;
begin
  if auth.uid() is not null and not (is_od() or is_director()) then
    raise exception '[hanya OD/Director yang dapat men-generate ringkasan bulanan manual]'
      using errcode = 'insufficient_privilege';
  end if;

  v_period := coalesce(p_period,
                       to_char((date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '1 month'), 'YYYYMM'));
  v_prev_period := to_char(to_date(v_period, 'YYYYMM') - interval '1 month', 'YYYYMM');

  for r in
    select h.merchant_id,
           avg(h.composite_score) as avg_score,
           (array_agg(h.band order by h.week_start desc))[1] as eom_band,
           count(*) filter (where true) as n_weeks
    from merchant_health_snapshots h
    where h.period = v_period
      and not exists (select 1 from merchant_health_monthly mm
                      where mm.merchant_id = h.merchant_id and mm.period = v_period)
    group by h.merchant_id
  loop
    select gmv_value into v_gmv from merchant_gmv_authoritative
    where merchant_id = r.merchant_id and period = v_period
    order by entered_at desc limit 1;
    v_gmv_est := v_gmv is null;
    if v_gmv is null then
      select max(gmv_value) into v_gmv
      from (select (h.channel_gmv->>'ads')::numeric as gmv_value from merchant_health_snapshots h where h.merchant_id = r.merchant_id and h.period = v_period
            union all
            select (h.channel_gmv->>'kol')::numeric from merchant_health_snapshots h where h.merchant_id = r.merchant_id and h.period = v_period
            union all
            select (h.channel_gmv->>'live')::numeric from merchant_health_snapshots h where h.merchant_id = r.merchant_id and h.period = v_period) x;
    end if;

    select avg_score into v_prev_avg from merchant_health_monthly
    where merchant_id = r.merchant_id and period = v_prev_period;
    v_trend := case when v_prev_avg is null then '→'
                    when r.avg_score - v_prev_avg >= 3 then '↑'
                    when r.avg_score - v_prev_avg <= -3 then '↓'
                    else '→' end;

    insert into merchant_health_monthly
      (code, merchant_id, period, avg_score, eom_band, monthly_trend,
       total_gmv, gmv_estimated, total_complaints)
    values
      (next_code('MHRM'), r.merchant_id, v_period, round(r.avg_score, 1), r.eom_band, v_trend,
       v_gmv, v_gmv_est,
       (select count(*) from complaints c
        where c.merchant_id = r.merchant_id and to_char(c.created_at, 'YYYYMM') = v_period));
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

comment on function generate_health_monthly(char) is 'M13: Monthly Health Summary dari snapshot mingguan. Cron awal bulan utk bulan sebelumnya; manual hanya OD/Director.';

-- ---- RLS -----------------------------------------------------------------------
alter table merchant_health_snapshots enable row level security;
alter table merchant_health_monthly   enable row level security;

create policy mhr_select on merchant_health_snapshots for select to authenticated
  using (is_od() or is_director() or is_lead() or auth_division() = 'Account');
create policy mhrm_select on merchant_health_monthly for select to authenticated
  using (is_od() or is_director() or is_lead() or auth_division() = 'Account');
-- Tidak ada policy tulis: baris hanya lahir dari fungsi definer (derived-only).

-- ---- Jadwal pg_cron (waktu UTC; WIB = UTC+7) -----------------------------------
-- Senin 00:30 WIB = Minggu 17:30 UTC — snapshot minggu yang baru selesai.
select cron.schedule('msdps_health_weekly', '30 17 * * 0',
  $$select generate_health_snapshots()$$);
-- Tanggal 1 pukul 18:00 UTC (= tgl 2 pukul 01:00 WIB) — ringkasan bulan sebelumnya.
select cron.schedule('msdps_health_monthly', '0 18 1 * *',
  $$select generate_health_monthly()$$);

-- ---- Grants --------------------------------------------------------------------
grant execute on function generate_health_snapshots(date) to authenticated;
grant execute on function generate_health_monthly(char)  to authenticated;
