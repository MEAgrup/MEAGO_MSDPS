-- =============================================================================
-- MSDPS · Module 11 — Merchant Board (Kanban, murni lapisan visualisasi)
-- =============================================================================
-- PRD M11 (LOCKED 30 Jun 2026):
--   * 1 merchant = 1 board; kartu = Brief (semua divisi). TIDAK ada status
--     tersimpan — semua kolom derived real-time dari modul divisi (M6–M10).
--   * 6 kolom kanonik: [Intake] [Planning] [In Execution] [In Review]
--     [Completed] [Blocked], prioritas penempatan:
--     Blocked > In Review > In Execution > Planning > Intake > Completed.
--   * Board read-and-coordinate — tidak ada jalur ubah status dari sini.
--   * Akses: AM board merchant-nya (Account lihat semua), SPV/staf divisi lihat
--     kartu divisinya, Director/OD semua. Role-gate ditanam di WHERE karena
--     view berjalan sebagai owner (merchants ber-RLS tidak mencakup divisi
--     eksekusi, padahal SPV divisi butuh nama merchant di papan — pola sama
--     dengan v_speed_score M12).
--   * [Blocked] juga menangkap block-request [Pending] (kartu "calon blocked"
--     supaya SPV lihat butuh keputusan — M12 Rule 4).
-- =============================================================================

create view v_merchant_board as
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
  end as kanban_column
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

comment on view v_merchant_board is 'M11: kartu Kanban per Brief, kolom kanonik 6-state derived real-time (tidak menyimpan status). Read-and-coordinate — aksi tetap di modul divisi.';

grant select on v_merchant_board to authenticated;
