-- =============================================================================
-- MSDPS · Module 15 — Team Portal & Management Dashboard (Fase 1: INTERNAL saja)
-- =============================================================================
-- PRD M15 (LOCKED 30 Jun 2026) + phasing confirmed:
--   * Fase 1 (sekarang): Team Portal + Management Dashboard internal.
--   * Merchant Portal = Fase 2 — TIDAK dibangun di sini (M15-OA-2).
--   * CSAT di luar scope sistem (M15-OA-3).
--   * Murni lapisan tampilan: agregasi M11/M12/M13/M14, tidak ada aksi
--     eksekusi baru (aksi tetap di modul asal; block-approve tetap lewat
--     block_requests M12).
-- =============================================================================

-- v_merchant_board + kolom assigned_pic (id) di ujung, supaya Team Portal bisa
-- memfilter "kartu saya" tanpa menduplikasi logika papan.
-- (CREATE OR REPLACE VIEW mengizinkan penambahan kolom di akhir.)
create or replace view v_merchant_board as
with sku_agg as (
  select brief_id,
         count(*) filter (where status <> '[Cancelled]')                                    as units_total,
         count(*) filter (where status = '[Approved]')                                      as units_done,
         count(*) filter (where status in ('[Submitted for Review]','[In Review - AM]'))    as units_in_review,
         count(*) filter (where status in ('[To Do]','[In Progress]','[Revision Requested]')) as units_active,
         coalesce(sum(revision_count), 0)                                                   as unit_revisions
  from sku_work_units group by brief_id
),
adc_agg as (
  select brief_id,
         count(*) filter (where status <> '[Cancelled]')                                    as units_total,
         count(*) filter (where status = '[Completed]')                                     as units_done,
         count(*) filter (where status = '[Revision Requested]')                            as units_in_review,
         count(*) filter (where status in ('[Setup In Progress]','[Pending Go-Live Approval]','[Live]','[Optimizing]','[Paused]')) as units_active,
         coalesce(sum(revision_count), 0)                                                   as unit_revisions
  from ad_campaign_records group by brief_id
),
bkg_agg as (
  select brief_id,
         count(*) filter (where status <> '[Cancelled]')                                    as units_total,
         count(*) filter (where status = '[Delivered]')                                     as units_done,
         0::bigint                                                                          as units_in_review,
         count(*) filter (where status in ('[Sourcing/Negotiation]','[Booked]','[In Production]')) as units_active,
         0::bigint                                                                          as unit_revisions
  from creator_bookings group by brief_id
),
lsr_agg as (
  select brief_id,
         count(*)                                            as units_total,
         count(*) filter (where entry_status = '[Lengkap]')  as units_done,
         0::bigint                                           as units_in_review,
         count(*) filter (where entry_status <> '[Lengkap]') as units_active,
         0::bigint                                           as unit_revisions
  from live_stream_results group by brief_id
),
pending_blk as (
  select brief_id, count(*) as n from block_requests where status = '[Pending]' group by brief_id
)
select
  m.id            as merchant_id,
  m.code          as merchant_code,
  m.nama_toko     as merchant_name,
  m.am_id,
  am.full_name    as am_name,
  b.id            as brief_id,
  b.code          as brief_code,
  b.assigned_division as division,
  sv.service_type,
  b.status        as brief_status,
  b.priority,
  b.due_date,
  b.completion_pct,
  b.quantity_target,
  b.deliverable_type,
  pic.full_name   as pic_name,
  b.work_time_seconds,
  b.timer_started_at,
  coalesce(u.units_total, 0)     as units_total,
  coalesce(u.units_done, 0)      as units_done,
  coalesce(u.units_in_review, 0) as units_in_review,
  coalesce(u.units_active, 0)    as units_active,
  b.revision_count + coalesce(u.unit_revisions, 0) as revision_total,
  (b.revision_count + coalesce(u.unit_revisions, 0)) >= 3 as flag_revision,
  (b.status = '[Overdue]'
   or (b.due_date is not null and b.due_date < current_date
       and b.status not in ('[Completed]')))               as flag_overdue,
  b.status = '[Blocked]'                                   as flag_blocked,
  coalesce(pb.n, 0) > 0                                    as flag_pending_block,
  case
    when b.status = '[Blocked]' or coalesce(pb.n, 0) > 0 then '[Blocked]'
    when b.status in ('[Submitted]','[In Review]')
         or coalesce(u.units_in_review, 0) > 0            then '[In Review]'
    when b.status in ('[In Progress]','[Overdue]','[Revision Requested]',
                      '[Diteruskan ke Vendor]')           then '[In Execution]'
    when b.status = '[To Do]'
         and sv.execution_status in ('[Strategy Drafting]','[Strategy Submitted for Approval]')
                                                          then '[Planning]'
    when b.status = '[Completed]'                         then '[Completed]'
    else '[Intake]'
  end as kanban_column,
  b.assigned_pic
from briefs b
join services sv on sv.id = b.service_id
join merchants m on m.id = sv.merchant_id
left join employees am  on am.id  = m.am_id
left join employees pic on pic.id = b.assigned_pic
left join sku_agg u_sku on b.assigned_division = 'Ecommerce'  and u_sku.brief_id = b.id
left join adc_agg u_adc on b.assigned_division = 'Ads'        and u_adc.brief_id = b.id
left join bkg_agg u_bkg on b.assigned_division = 'KOL'        and u_bkg.brief_id = b.id
left join lsr_agg u_lsr on b.assigned_division = 'LiveStream' and u_lsr.brief_id = b.id
cross join lateral (
  select coalesce(u_sku.units_total, u_adc.units_total, u_bkg.units_total, u_lsr.units_total)             as units_total,
         coalesce(u_sku.units_done, u_adc.units_done, u_bkg.units_done, u_lsr.units_done)                 as units_done,
         coalesce(u_sku.units_in_review, u_adc.units_in_review, u_bkg.units_in_review, u_lsr.units_in_review) as units_in_review,
         coalesce(u_sku.units_active, u_adc.units_active, u_bkg.units_active, u_lsr.units_active)         as units_active,
         coalesce(u_sku.unit_revisions, u_adc.unit_revisions, u_bkg.unit_revisions, u_lsr.unit_revisions) as unit_revisions
) u
left join pending_blk pb on pb.brief_id = b.id
where b.status <> '[Cancelled - Service Voided]'
  and (is_od() or is_director()
       or auth_division() = 'Account'
       or b.assigned_division = auth_division());

-- ---- Team Portal: My Tasks -------------------------------------------------------
-- Kartu yang relevan buat SAYA: (a) brief yang saya kerjakan, (b) antrian [To Do]
-- divisi saya, (c) untuk AM: semua kartu merchant portofolio saya.
create view v_team_portal_tasks as
select *
from v_merchant_board b
where b.assigned_pic = auth.uid()
   or (b.division = auth_division() and b.brief_status = '[To Do]')
   or (auth_division() = 'Account' and b.am_id = auth.uid());

comment on view v_team_portal_tasks is 'M15 Team Portal: My Tasks — kartu saya + antrian divisi + (AM) portofolio. Read-only; aksi di modul asal.';

-- ---- Team Portal: My Performance --------------------------------------------------
-- RLS performance_scores sudah menggerbang (own/lead/OD/Director) -> invoker.
create view v_team_portal_performance
with (security_invoker = true) as
select p.code, p.staff_id, e.full_name as staff_name, p.role, p.week_start,
       p.composite_score, p.output_component, p.speed_component, p.quality_component,
       p.details, p.trend, p.created_at
from performance_scores p
join employees e on e.id = p.staff_id;

comment on view v_team_portal_performance is 'M15 Team Portal: skor performa (RLS: milik sendiri / lead divisi / OD / Director).';

-- ---- Team Portal: Block requests (status saya + antrian approve SPV) --------------
create view v_team_portal_blocks
with (security_invoker = true) as
select bq.id, bq.code, bq.status, bq.reason, bq.created_at,
       bq.blocked_from, bq.blocked_to,
       bq.requested_by, req.full_name as requested_by_name,
       bq.approver, apr.full_name as approver_name,
       b.id as brief_id, b.code as brief_code, b.assigned_division as division,
       b.status as brief_status
from block_requests bq
join briefs b on b.id = bq.brief_id
left join employees req on req.id = bq.requested_by
left join employees apr on apr.id = bq.approver;

comment on view v_team_portal_blocks is 'M15 Team Portal: block request milik saya + antrian approve untuk SPV/Lead (RLS block_requests).';

-- ---- Management Dashboard (Director/OD) --------------------------------------------
-- Semua merchant: health terakhir, tren, komponen penyeret, beban aktif.
-- Definer + gate eksplisit Director/OD (lintas seluruh basis merchant).
create view v_management_dashboard as
with latest as (
  select distinct on (merchant_id) *
  from merchant_health_snapshots
  order by merchant_id, week_start desc
),
briefs_agg as (
  select sv.merchant_id,
         count(*) filter (where b.status not in ('[Completed]','[Cancelled - Service Voided]')) as briefs_active,
         count(*) filter (where b.status = '[Blocked]')  as briefs_blocked,
         count(*) filter (where b.status = '[Overdue]' or
                          (b.due_date is not null and b.due_date < current_date
                           and b.status not in ('[Completed]','[Cancelled - Service Voided]'))) as briefs_overdue
  from briefs b join services sv on sv.id = b.service_id
  group by sv.merchant_id
),
pending_blk as (
  select sv.merchant_id, count(*) as n
  from block_requests bq
  join briefs b on b.id = bq.brief_id
  join services sv on sv.id = b.service_id
  where bq.status = '[Pending]'
  group by sv.merchant_id
),
open_complaints as (
  select merchant_id, count(*) as n from complaints
  where status in ('[Open]','[In Progress]') group by merchant_id
)
select m.id as merchant_id, m.code as merchant_code, m.nama_toko as merchant_name,
       m.am_id, am.full_name as am_name,
       l.code as snapshot_code, l.week_start, l.composite_score, l.band,
       l.trend, l.trend_driver, l.gmv_value, l.gmv_estimated,
       l.complaint_penalty, l.revision_signal,
       coalesce(ba.briefs_active, 0)  as briefs_active,
       coalesce(ba.briefs_blocked, 0) as briefs_blocked,
       coalesce(ba.briefs_overdue, 0) as briefs_overdue,
       coalesce(pb.n, 0)              as blocks_pending,
       coalesce(oc.n, 0)              as complaints_open,
       case l.band when 'At Risk' then 0 when 'Watch' then 1 else 2 end as band_rank
from merchants m
left join employees am on am.id = m.am_id
left join latest l on l.merchant_id = m.id
left join briefs_agg ba on ba.merchant_id = m.id
left join pending_blk pb on pb.merchant_id = m.id
left join open_complaints oc on oc.merchant_id = m.id
where is_od() or is_director();

comment on view v_management_dashboard is 'M15 Management Dashboard (Director/OD): health terbaru semua merchant + beban aktif. band_rank utk sort At Risk dulu. Read-only + drill-through.';

grant select on v_team_portal_tasks       to authenticated;
grant select on v_team_portal_performance to authenticated;
grant select on v_team_portal_blocks      to authenticated;
grant select on v_management_dashboard    to authenticated;
