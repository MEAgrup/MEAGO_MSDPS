-- =============================================================================
-- MSDPS · Fase G.2 · Migration 0343 — Pendaftaran & kurasi kreator campaign
-- =============================================================================
-- Lanjutan Fase G.1 (0341/0342 — fondasi campaign + budget guard). Cakupan G.2
-- (docs/HANDOFF_FaseG.md §6): campaign_participants (CPT-), gerbang kelayakan/
-- stage/kuota di trigger, view portal, route /kreator/campaign. Bukti (G.3),
-- payout (G.4), ingest (G.5) BELUM di sini.
--
-- Keputusan Fase G TERKUNCI yang relevan (§5):
--   #9  Segmentasi kelayakan: Industry, Kota, Level, Jenis kreator, Roster
--       live, Status kontrak, ambang GMV. Follower TIDAK dipakai.
--   #10 Pendaftaran wajib login Portal Kreator, hanya kreator yang ada di
--       mcn_creators — TIDAK ADA jalur insert untuk staff/employee.
--   #6  Alokasi = base_fee × kuota slot ≤ creator_budget. Desain di sini:
--       kuota membatasi APPROVAL (kurasi), bukan pendaftaran — pendaftar boleh
--       lebih banyak dari kuota (lazimnya campaign influencer: over-subscribe,
--       kurasi yang menyeleksi). Mencegah "kuota penuh oleh yang belum
--       ditinjau" memblokir pendaftar lain yang lebih layak.
--
-- Pemetaan kolom kelayakan (brand_deals, 0342) → mcn_creators
-- (docs/GLOSARIUM.md + audit skema 2026-09-03):
--   eligible_industries     → mcn_creators.niche (ejaan kanonik "Accommodation")
--   eligible_cities         → mcn_creators.city
--   eligible_levels         → mcn_creators.creator_level (teks bebas)
--   eligible_creator_types  → mcn_creators.jenis_creator (live/video/mixed)
--   eligible_roster_status  → mcn_creators.live_roster (boolean) dipetakan ke
--                             token 'active'/'inactive' — SATU-SATUNYA kolom
--                             array di sini yang sumbernya bukan text/text[].
--   eligible_status_kontrak → mcn_creators.status_kontrak ('kontrak'/'non kontrak')
--   min_gmv/min_gmv_metric/min_gmv_period_days → SUM creator_period_summary
--       (gmv_total atau affiliate_video_gmv) dalam window hari terakhir.
--       CATATAN JUJUR: mcn_creators.gmv/gmv_video sendiri DORMAN (0309) —
--       jangan dipakai, creator_period_summary adalah sumber yang benar-benar
--       terisi dari ingest.
-- =============================================================================

-- ---- 1. Fungsi kelayakan (dipakai trigger insert & view portal) ------------
create or replace function creator_meets_campaign_eligibility(p_creator_id uuid, p_deal_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from brand_deals d
    join mcn_creators c on c.id = p_creator_id
    where d.id = p_deal_id
      and d.campaign_enabled
      and (d.eligible_industries is null or c.niche = any(d.eligible_industries))
      and (d.eligible_cities is null or c.city = any(d.eligible_cities))
      and (d.eligible_levels is null or c.creator_level = any(d.eligible_levels))
      and (d.eligible_creator_types is null or c.jenis_creator = any(d.eligible_creator_types))
      and (
        d.eligible_roster_status is null
        or (c.live_roster and 'active' = any(d.eligible_roster_status))
        or (not c.live_roster and 'inactive' = any(d.eligible_roster_status))
      )
      and (d.eligible_status_kontrak is null or c.status_kontrak = any(d.eligible_status_kontrak))
      and (
        d.min_gmv is null
        or coalesce((
              select sum(case when d.min_gmv_metric = 'video_gmv' then cps.affiliate_video_gmv else cps.gmv_total end)
              from creator_period_summary cps
              where cps.mcn_creator_id = c.id
                and cps.period_start >= current_date - make_interval(days => coalesce(d.min_gmv_period_days, 30))
            ), 0) >= d.min_gmv
      )
  )
$$;

comment on function creator_meets_campaign_eligibility(uuid, uuid) is
  'Cek satu kreator vs segmentasi kelayakan satu campaign (keputusan #9). Dipakai trigger pendaftaran & v_portal_campaigns. NULL pada kolom eligible_* di brand_deals = tidak difilter (semua boleh).';

revoke execute on function creator_meets_campaign_eligibility(uuid, uuid) from public, anon;

-- ---- 2. campaign_participants (pendaftaran kreator) -------------------------
create table campaign_participants (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                                  -- CPT-YYYYMM-NNNN
  deal_id           uuid not null references brand_deals(id) on delete cascade,
  mcn_creator_id    uuid not null references mcn_creators(id),
  status            text not null default 'registered'
                       check (status in ('registered','approved','rejected','withdrawn')),
  rejection_reason  text,
  reviewed_by       uuid references employees(id),
  reviewed_at       timestamptz,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz,
  unique (deal_id, mcn_creator_id)
);

comment on table campaign_participants is
  'Pendaftaran kreator ke campaign (Fase G.2). Satu kreator sekali per campaign (unique deal_id+mcn_creator_id). status: registered (default, siapapun eligible boleh daftar) → approved/rejected (kurasi staff, approved dibatasi kuota) atau withdrawn (kreator/staff batalkan).';

create index campaign_participants_deal_idx on campaign_participants (deal_id, status);
create index campaign_participants_creator_idx on campaign_participants (mcn_creator_id);

-- ---- 3. Validate: ID immutable, status selalu 'registered' saat insert -----
-- Klien (kreator) tidak pernah boleh mengirim status lain saat mendaftar —
-- satu-satunya jalur ke approved/rejected/withdrawn adalah UPDATE lewat
-- trigger kurasi di bawah.
create or replace function campaign_participants_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'registered';
    if new.code is null then
      new.code := next_code('CPT');
    end if;
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_campaign_participants_validate before insert or update on campaign_participants
  for each row execute function campaign_participants_validate();

revoke execute on function campaign_participants_validate() from public, anon, authenticated;

-- ---- 4. Gerbang pendaftaran: campaign aktif + kelayakan (BUKAN kuota) ------
create or replace function campaign_participant_eligibility_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_deal brand_deals%rowtype;
begin
  select * into v_deal from brand_deals where id = new.deal_id;
  if v_deal.id is null then
    raise exception '[campaign tidak ditemukan]' using errcode = 'check_violation';
  end if;
  if not v_deal.campaign_enabled or v_deal.campaign_stage <> 'active' then
    raise exception '[campaign belum/tidak lagi menerima pendaftaran]' using errcode = 'check_violation';
  end if;
  if not creator_meets_campaign_eligibility(new.mcn_creator_id, new.deal_id) then
    raise exception '[anda tidak memenuhi syarat kelayakan campaign ini]' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

comment on function campaign_participant_eligibility_guard() is
  'BEFORE INSERT campaign_participants: campaign harus aktif + kreator harus lolos creator_meets_campaign_eligibility(). Kuota TIDAK dicek di sini — lihat campaign_participants_curation_guard() (kuota digerbang saat approve, keputusan desain: over-subscribe wajar, kurasi yang menyeleksi).';

create trigger trg_campaign_participants_eligibility before insert on campaign_participants
  for each row execute function campaign_participant_eligibility_guard();

revoke execute on function campaign_participant_eligibility_guard() from public, anon, authenticated;

-- ---- 5. Gerbang kurasi: hanya staff boleh approve/reject, kuota di approve -
create or replace function campaign_participants_curation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quota    integer;
  v_approved integer;
begin
  if new.status is distinct from old.status then
    if new.status in ('approved','rejected') then
      if not (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account')) then
        raise exception '[hanya tim operasional yang dapat menyetujui/menolak pendaftaran]'
          using errcode = 'insufficient_privilege';
      end if;
      if new.status = 'approved' then
        select creator_quota into v_quota from brand_deals where id = new.deal_id;
        if v_quota is not null then
          select count(*) into v_approved from campaign_participants
            where deal_id = new.deal_id and status = 'approved' and id <> new.id;
          if v_approved >= v_quota then
            raise exception '[kuota kreator untuk campaign ini sudah penuh]' using errcode = 'check_violation';
          end if;
        end if;
      end if;
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    elsif new.status = 'withdrawn' then
      if not (
        old.mcn_creator_id = auth_creator_id()
        or is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account')
      ) then
        raise exception '[tidak berwenang membatalkan pendaftaran ini]'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;
  return new;
end $$;

comment on function campaign_participants_curation_guard() is
  'BEFORE UPDATE campaign_participants: approve/reject hanya staff BizDev/CampaignSpecialist/Account/mgmt; approve dibatasi creator_quota (keputusan #6). withdrawn boleh kreator sendiri atau staff. Menstempel reviewed_by/at pada approve/reject.';

create trigger trg_campaign_participants_curation before update on campaign_participants
  for each row execute function campaign_participants_curation_guard();

revoke execute on function campaign_participants_curation_guard() from public, anon, authenticated;

-- ---- 6. Legalitas transisi status (entity baru, kolom `status` generik) ---
create trigger trg_campaign_participants_status before update on campaign_participants
  for each row execute function enforce_status_transition('campaign_participant');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('campaign_participant','registered','approved',  null),
  ('campaign_participant','registered','rejected',  null),
  ('campaign_participant','registered','withdrawn', null),
  ('campaign_participant','approved','withdrawn',   null),
  ('campaign_participant','approved','rejected',    null);

create trigger trg_campaign_participants_audit after insert or update on campaign_participants
  for each row execute function capture_audit('campaign_participant');

-- ---- 7. RLS -------------------------------------------------------------
-- select: kreator lihat pendaftaran sendiri; staff (BizDev/CampaignSpecialist/
-- Account/mgmt) lihat semua untuk kurasi.
alter table campaign_participants enable row level security;
create policy campaign_participants_select on campaign_participants for select to authenticated
  using (
    is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account')
    or mcn_creator_id = auth_creator_id()
  );

-- insert: HANYA kreator mendaftarkan diri sendiri (keputusan #10) — tidak ada
-- jalur employee insert di sini sama sekali.
create policy campaign_participants_insert on campaign_participants for insert to authenticated
  with check (mcn_creator_id = auth_creator_id());

-- update: staff untuk kurasi, kreator untuk membatalkan pendaftaran sendiri.
-- Nilai status yang boleh ditulis masing-masing dibatasi lebih lanjut oleh
-- campaign_participants_curation_guard() di atas.
create policy campaign_participants_update on campaign_participants for update to authenticated
  using (
    is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account')
    or mcn_creator_id = auth_creator_id()
  );

-- ---- 8. v_portal_campaigns (portal kreator, /kreator/campaign) -------------
-- Meniru pola TERKINI v_portal_deals (0340_portal_deals_filter.sql): view
-- polos (BUKAN security_invoker) supaya berjalan dengan privilese pemilik
-- view (brand_deals TIDAK punya RLS select untuk kreator sama sekali), dan
-- filter kelayakan dievaluasi manual lewat auth_creator_id() +
-- creator_meets_campaign_eligibility(). Kolom SENGAJA terbatas — tanpa
-- creator_budget/ads_budget/over_budget (data internal MEA GO).
create view v_portal_campaigns as
  select
    d.id, d.code, d.brand_name, d.campaign_track, d.campaign_mode, d.base_fee,
    d.creator_quota, d.target_location_id, d.post_window_start, d.post_window_end,
    d.submission_deadline, d.brief, d.has_free_meal, d.target_gmv, d.target_views,
    d.created_at,
    (select count(*) from campaign_participants p
       where p.deal_id = d.id and p.status = 'approved')      as approved_count,
    (select p2.id from campaign_participants p2
       where p2.deal_id = d.id and p2.mcn_creator_id = auth_creator_id()
       limit 1)                                                as my_participant_id,
    (select p3.status from campaign_participants p3
       where p3.deal_id = d.id and p3.mcn_creator_id = auth_creator_id()
       limit 1)                                                as my_status
  from brand_deals d
  where d.campaign_enabled
    and d.campaign_stage = 'active'
    and auth_creator_id() is not null
    and creator_meets_campaign_eligibility(auth_creator_id(), d.id);

comment on view v_portal_campaigns is
  'Campaign aktif yang kreator sesi ini LAYAK daftar (keputusan #9), plus status pendaftarannya sendiri kalau sudah pernah daftar (my_participant_id/my_status). Kolom budget internal MEA GO sengaja tidak diikutkan.';

revoke all on v_portal_campaigns from public, anon;
grant select on v_portal_campaigns to authenticated;
