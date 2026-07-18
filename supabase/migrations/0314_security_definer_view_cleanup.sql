-- =============================================================================
-- MSDPS · Migration 0314 — Advisor security_definer_view: 6 view ERROR tuntas
-- =============================================================================
-- Melanjutkan 0313: 6 view definer yang saat itu DIBIARKAN kini dibereskan
-- sampai advisor bersih, TANPA mengubah kode app (.from() tetap bekerja) dan
-- TANPA mengubah baris yang terlihat per role (diverifikasi lewat impersonasi
-- request.jwt.claims sebelum/sesudah).
--
-- Keputusan per view:
--   · v_management_dashboard — SATU-SATUNYA yang aman di-flip langsung ke
--     invoker: gate WHERE is_od()/is_director(), dan semua relasi dasarnya
--     (merchants, briefs, services, block_requests, complaints,
--     merchant_health_snapshots, employees) sudah punya policy select yang
--     meloloskan OD/Director → hasil identik.
--   · 5 view lain DEFINER-BY-DESIGN (lihat komentar 0206/0207/0209/0311/0312):
--     flip = rusak (0 baris utk divisi eksekusi / kreator, atau permission
--     denied ke v_speed_score_internal), sedangkan kompensasi policy RLS =
--     membocorkan kolom sensitif (merchants.gmv_*, brand_deals.komisi_*,
--     audit_log). Solusi: pola tiga lapis, preseden v_speed_score_internal M13
--     (advisor hanya menandai view yang ter-expose ke anon/authenticated):
--       lapis 1  view *_internal definer, TANPA grant anon/authenticated —
--                menampung body + role-gate lama apa adanya;
--       lapis 2  fungsi definer set-returning `v_*_rows()` sebagai jembatan
--                hak akses (muncul sebagai WARN 0029 "callable by
--                authenticated" — intensional, kategori sama dengan helper
--                auth existing: is_od, auth_division, dst.);
--       lapis 3  view publik di-REPLACE menjadi security_invoker berisi
--                `select * from v_*_rows()` — nama & kolom tidak berubah,
--                jadi app dan v_team_portal_tasks tetap jalan tanpa deploy
--                terkoordinasi.
--     Catatan performa: fungsi definer tidak di-inline planner, jadi filter
--     PostgREST dieksekusi di atas hasil fungsi. Volume dashboard internal
--     kecil — dapat diterima.
--   · Hygiene grant: cabut grant ambient (INSERT/UPDATE/DELETE/TRUNCATE/... +
--     anon) di keenam view publik; sisakan SELECT untuk authenticated (pola
--     0008). postgres/service_role tidak disentuh (pg_cron & backend tetap).
-- =============================================================================

-- =============================================================================
-- 1. v_management_dashboard — flip langsung ke invoker + hygiene grant
-- =============================================================================

alter view v_management_dashboard set (security_invoker = true);

comment on view v_management_dashboard is
  'M15 Management Dashboard (Director/OD): health terbaru semua merchant + beban aktif. band_rank utk sort At Risk dulu. Read-only + drill-through. security_invoker sejak 0314 — semua relasi dasar sudah ber-policy OD/Director.';

revoke all on v_management_dashboard from public, anon, authenticated;
grant select on v_management_dashboard to authenticated;

-- =============================================================================
-- 2. v_speed_score — internal (v_speed_score_internal, M13) sudah ada;
--    gate lama pindah ke fungsi jembatan.
-- =============================================================================

create function v_speed_score_rows()
  returns setof v_speed_score_internal
  language sql stable security definer set search_path = public
as $$
  select * from v_speed_score_internal
  where is_od() or is_director()
     or auth_division() = 'Account'
     or division = auth_division();
$$;

comment on function v_speed_score_rows() is
  'Jembatan definer M12 (0314): v_speed_score_internal + role-gate lama v_speed_score. WARN advisor 0029 (callable by authenticated) = intensional.';

revoke all on function v_speed_score_rows() from public, anon;
grant execute on function v_speed_score_rows() to authenticated, service_role;

create or replace view v_speed_score with (security_invoker = true) as
  select * from v_speed_score_rows();

revoke all on v_speed_score from public, anon, authenticated;
grant select on v_speed_score to authenticated;

-- =============================================================================
-- 3. v_merchant_board — body + gate lama (0210) pindah utuh ke internal
-- =============================================================================

create view v_merchant_board_internal as
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

comment on view v_merchant_board_internal is
  'M11 body + role-gate v_merchant_board (dipindah utuh di 0314). Definer, TIDAK di-grant ke anon/authenticated — akses lewat v_merchant_board_rows().';

revoke all on v_merchant_board_internal from public, anon, authenticated;

create function v_merchant_board_rows()
  returns setof v_merchant_board_internal
  language sql stable security definer set search_path = public
as $$ select * from v_merchant_board_internal $$;

comment on function v_merchant_board_rows() is
  'Jembatan definer M11 (0314). WARN advisor 0029 (callable by authenticated) = intensional.';

revoke all on function v_merchant_board_rows() from public, anon;
grant execute on function v_merchant_board_rows() to authenticated, service_role;

create or replace view v_merchant_board with (security_invoker = true) as
  select * from v_merchant_board_rows();

revoke all on v_merchant_board from public, anon, authenticated;
grant select on v_merchant_board to authenticated;

-- =============================================================================
-- 4. v_okr_attainment — body + gate lama (0209) pindah utuh ke internal
-- =============================================================================

create view v_okr_attainment_internal as
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

comment on view v_okr_attainment_internal is
  'M14 body + role-gate v_okr_attainment (dipindah utuh di 0314). Definer, TIDAK di-grant ke anon/authenticated — akses lewat v_okr_attainment_rows().';

revoke all on v_okr_attainment_internal from public, anon, authenticated;

create function v_okr_attainment_rows()
  returns setof v_okr_attainment_internal
  language sql stable security definer set search_path = public
as $$ select * from v_okr_attainment_internal $$;

comment on function v_okr_attainment_rows() is
  'Jembatan definer M14 (0314). WARN advisor 0029 (callable by authenticated) = intensional.';

revoke all on function v_okr_attainment_rows() from public, anon;
grant execute on function v_okr_attainment_rows() to authenticated, service_role;

create or replace view v_okr_attainment with (security_invoker = true) as
  select * from v_okr_attainment_rows();

revoke all on v_okr_attainment from public, anon, authenticated;
grant select on v_okr_attainment to authenticated;

-- =============================================================================
-- 5. v_portal_merchants — body + gate lama (0311) pindah utuh ke internal
-- =============================================================================

create view v_portal_merchants_internal as
  select id, nama_toko, kota, kategori
  from merchants
  where auth_creator_id() is not null;

comment on view v_portal_merchants_internal is
  'Body v_portal_merchants (dipindah utuh di 0314): kolom aman merchants utk sesi kreator. Definer, TIDAK di-grant ke anon/authenticated — akses lewat v_portal_merchants_rows(). JANGAN tambah kolom sensitif (gmv/target/revenue).';

revoke all on v_portal_merchants_internal from public, anon, authenticated;

create function v_portal_merchants_rows()
  returns setof v_portal_merchants_internal
  language sql stable security definer set search_path = public
as $$ select * from v_portal_merchants_internal $$;

comment on function v_portal_merchants_rows() is
  'Jembatan definer portal kreator F.1 (0314). WARN advisor 0029 (callable by authenticated) = intensional.';

revoke all on function v_portal_merchants_rows() from public, anon;
grant execute on function v_portal_merchants_rows() to authenticated, service_role;

create or replace view v_portal_merchants with (security_invoker = true) as
  select * from v_portal_merchants_rows();

revoke all on v_portal_merchants from public, anon, authenticated;
grant select on v_portal_merchants to authenticated;

-- =============================================================================
-- 6. v_portal_deals — body + gate lama (0312) pindah utuh ke internal
-- =============================================================================

create view v_portal_deals_internal as
  select id, code, brand_name, niche, campaign_type, komisi_kreator_pct,
         kreators_needed, videos_needed, poi_location, deal_end, created_at
  from brand_deals
  where status = 'running' and auth_creator_id() is not null;

comment on view v_portal_deals_internal is
  'Body v_portal_deals (dipindah utuh di 0314): deal running, kolom aman utk sesi kreator. Definer, TIDAK di-grant ke anon/authenticated — akses lewat v_portal_deals_rows(). JANGAN tambah kolom sensitif (komisi MEA/gmv/fee).';

revoke all on v_portal_deals_internal from public, anon, authenticated;

create function v_portal_deals_rows()
  returns setof v_portal_deals_internal
  language sql stable security definer set search_path = public
as $$ select * from v_portal_deals_internal $$;

comment on function v_portal_deals_rows() is
  'Jembatan definer portal kreator F.2 (0314). WARN advisor 0029 (callable by authenticated) = intensional.';

revoke all on function v_portal_deals_rows() from public, anon;
grant execute on function v_portal_deals_rows() to authenticated, service_role;

create or replace view v_portal_deals with (security_invoker = true) as
  select * from v_portal_deals_rows();

revoke all on v_portal_deals from public, anon, authenticated;
grant select on v_portal_deals to authenticated;
