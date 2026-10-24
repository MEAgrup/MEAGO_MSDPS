-- =============================================================================
-- MSDPS · Merchant Portal · Migration 0374 — Data portal merchant (read-only)
-- =============================================================================
-- Kenapa ada: Merchant Portal (/merchant di app.meago.id) dibangun — keputusan
-- 2026-07-18 "Merchant Portal TIDAK akan dibuat" DIBATALKAN Yohan 2026-10-19.
-- Isinya: status kampanye + laporan GMV, hanya milik merchant itu sendiri.
--
-- Akun merchant TIDAK mendapat SELECT ke tabel internal mana pun. Semua data
-- dibaca lewat fungsi security definer di bawah yang:
--   * memfilter ke lead milik auth.uid() (merchant_portal_users aktif + lead
--     masih closing) — akun lain / akses dicabut = hasil kosong;
--   * mengembalikan kolom WHITELIST saja. Tidak pernah keluar: komisi_mea,
--     komisi_kreator_*, service_fee, nominal_harga/benefit, budget internal,
--     review_flags, notes, payout kreator, data merchant lain.
-- Sumber GMV bulanan (prioritas per periode): merchant_gmv_authoritative (label
-- confidence) → merchant_health_monthly (tanda "estimasi" bila gmv_estimated) →
-- rekap poi_dining_cycles. Dua sumber pertama hanya ada bila lead sudah punya
-- baris merchants (close_deal / merchant_portal_users.merchant_id).
-- Idempoten.
-- =============================================================================

create or replace function auth_merchant_lead_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select distinct u.lead_id from merchant_portal_users u
   where u.auth_user_id = auth.uid() and u.active and portal_merchant_eligible(u.lead_id)
$$;

create or replace function auth_merchant_ids() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select u.merchant_id from merchant_portal_users u
   where u.auth_user_id = auth.uid() and u.active and u.merchant_id is not null
     and u.lead_id in (select auth_merchant_lead_ids())
  union
  select m.id from merchants m
    join prospect_attempts pa on pa.id = m.source_attempt_id
   where pa.parent_lead_id in (select auth_merchant_lead_ids())
$$;

create or replace function merchant_portal_me() returns table (
  lead_id uuid, lead_code text, brand_name text, brand_category text, wilayah text)
  language sql stable security definer set search_path = public as $$
  select l.id, l.code, coalesce(l.brand_name, l.lead_name), l.brand_category::text, l.wilayah
    from leads l where l.id in (select auth_merchant_lead_ids())
   order by 3
$$;

create or replace function merchant_portal_campaigns() returns table (
  deal_id uuid, deal_code text, lead_id uuid, brand_name text, campaign_name text,
  kategori text, status text, campaign_stage text, pipeline_stage text,
  visit_start_date date, visit_end_date date,
  kreator_needed integer, kreator_realized integer,
  videos_needed integer, video_realized integer,
  post_window_start date, post_window_end date,
  kontrak_mulai date, kontrak_akhir date)
  language sql stable security definer set search_path = public as $$
  select d.id, d.code, d.lead_id, d.brand_name, d.campaign_name,
         d.kategori_poi, d.status, d.campaign_stage, d.pipeline_stage,
         d.visit_start_date, d.visit_end_date,
         coalesce(d.kreators_needed, d.kreator_needed, d.creator_quota), d.kreator_realized,
         coalesce(d.videos_needed, d.konten_needed), d.video_realized,
         d.post_window_start, d.post_window_end,
         d.tanggal_mulai_kontrak, d.tanggal_akhir_kontrak
    from brand_deals d
   where d.lead_id in (select auth_merchant_lead_ids())
   order by coalesce(d.visit_start_date, d.created_at::date) desc
$$;

create or replace function merchant_portal_cycles() returns table (
  cycle_id uuid, deal_id uuid, campaign_name text, cycle_no integer,
  period_start date, period_end date, total_gmv numeric, actual_vt numeric,
  actual_kreator integer, report_status text, report_link text)
  language sql stable security definer set search_path = public as $$
  select c.id, c.deal_id, coalesce(d.campaign_name, d.brand_name), c.cycle_no,
         c.period_start, c.period_end, c.total_gmv, c.actual_vt, c.actual_kreator,
         c.report_status,
         case when c.report_status = 'Approved' then c.report_link end
    from poi_dining_cycles c
    join brand_deals d on d.id = c.deal_id
   where d.lead_id in (select auth_merchant_lead_ids())
   order by c.period_end desc nulls last, c.cycle_no desc
$$;

create or replace function merchant_portal_gmv_monthly() returns table (
  period text, gmv numeric, sumber text, label text)
  language sql stable security definer set search_path = public as $$
  with auth_gmv as (
    select g.period::text p, sum(g.gmv_value) v,
           case when bool_and(g.confidence = '[GMV Terverifikasi]') then 'Terverifikasi' else 'Estimasi' end lbl
      from merchant_gmv_authoritative g
     where g.merchant_id in (select auth_merchant_ids())
     group by 1),
  health as (
    select h.period::text p, sum(h.total_gmv) v,
           case when bool_or(h.gmv_estimated) then 'Estimasi' else 'Laporan bulanan' end lbl
      from merchant_health_monthly h
     where h.merchant_id in (select auth_merchant_ids())
     group by 1),
  cycles as (
    select to_char(c.period_end, 'YYYYMM') p, sum(c.total_gmv) v
      from poi_dining_cycles c join brand_deals d on d.id = c.deal_id
     where d.lead_id in (select auth_merchant_lead_ids())
       and c.period_end is not null and c.total_gmv is not null
     group by 1),
  periods as (select p from auth_gmv union select p from health union select p from cycles)
  select ps.p,
         coalesce(a.v, h.v, c.v),
         case when a.v is not null then 'otoritatif' when h.v is not null then 'bulanan' else 'siklus' end,
         coalesce(a.lbl, h.lbl, 'Rekap siklus')
    from periods ps
    left join auth_gmv a on a.p = ps.p
    left join health h on h.p = ps.p
    left join cycles c on c.p = ps.p
   order by ps.p desc
$$;

create or replace function merchant_portal_monthly_reports() returns table (
  period text, total_gmv numeric, gmv_estimated boolean)
  language sql stable security definer set search_path = public as $$
  select h.period::text, h.total_gmv, h.gmv_estimated
    from merchant_health_monthly h
   where h.merchant_id in (select auth_merchant_ids()) and h.report_ready
   order by h.period desc
$$;

revoke execute on function auth_merchant_lead_ids(), auth_merchant_ids(), merchant_portal_me(),
  merchant_portal_campaigns(), merchant_portal_cycles(), merchant_portal_gmv_monthly(),
  merchant_portal_monthly_reports() from public, anon;
grant execute on function auth_merchant_lead_ids(), auth_merchant_ids(), merchant_portal_me(),
  merchant_portal_campaigns(), merchant_portal_cycles(), merchant_portal_gmv_monthly(),
  merchant_portal_monthly_reports() to authenticated;
