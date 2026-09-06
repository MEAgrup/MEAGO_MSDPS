-- =============================================================================
-- MSDPS · Fase G.1 · Migration 0342 — Fondasi Campaign Kreator MEA GO + budget guard
-- =============================================================================
-- Keputusan Fase G TERKUNCI (docs/HANDOFF_FaseG.md §5, hasil interview 4 ronde
-- — jangan re-litigasi):
--   #1 Campaign = extend brand_deals, satu entitas dengan Merchant Deals.
--   #2 Sumber: Campaign Specialist (budget internal) & BizDev (budget brand).
--   #3 Divisi CampaignSpecialist (0341); penerima campaign BizDev = Account.
--   #5 Over-budget: hard block staff; Lead+ override wajib alasan + log.
--   #6 Alokasi = base_fee × kuota slot ≤ creator_budget.
--   #7 ads_budget: realisasi input manual multi-entri → dipakai hitung ROAS.
--   #8 Base fee flat per campaign, tanpa kelipatan.
--   #9 Segmentasi: Industry, Kota, Level, Jenis kreator, Roster live, Status
--      kontrak, ambang GMV. Follower TIDAK dipakai.
--
-- Cakupan G.1 (fondasi + budget guard SAJA — bukan pendaftaran/bukti/payout,
-- itu G.2-G.5): kolom campaign di brand_deals, budget guard trigger, campaign_
-- stage trigger terpisah, log budget, input ads spend manual, RLS.
--
-- Jebakan yang dihindari (docs/HANDOFF_FaseG.md §7):
--   #1 enforce_status_transition() hardcode kolom `status` (0004_phase0_
--      status_machine.sql:47-53) dan brand_deal sudah pakai entity itu untuk
--      kolom status → campaign_stage butuh trigger sendiri (lihat precedent
--      enforce_execution_transition() di 0200_module6_account.sql).
--   #2 JANGAN pakai brand_deals.shop_id untuk target campaign (unique index
--      brand_deals_shop_uniq, 0305:52) → pakai target_location_id (TikTok
--      Location ID) sesuai temuan parser (docs/GLOSARIUM.md).
--   #3 RLS brand_deals update saat ini hanya BizDev+mgmt (0305:158-159) →
--      diperluas ke CampaignSpecialist, dan Account dibatasi ke baris
--      campaign miliknya sendiri (operational_owner_id = auth_emp_id()).
--   #4 ALTER TYPE ADD VALUE migrasi terpisah → sudah 0341.
--   #8 Setiap perubahan skema live wajib file migrasi (docs/SCHEMA_DRIFT.md).
-- =============================================================================

-- ---- 1. Kolom campaign di brand_deals ---------------------------------------
alter table brand_deals
  add column campaign_enabled     boolean not null default false,
  add column funding_source       text check (funding_source in ('internal','brand')),
  add column campaign_mode        text check (campaign_mode in ('collaboration_package','others')),
  add column campaign_track       text check (campaign_track in ('video','live')),
  add column operational_team     division,
  add column operational_owner_id uuid references employees(id),
  add column campaign_stage       text not null default 'draft'
                                     check (campaign_stage in ('draft','active','on_hold','completed','cancelled')),
  add column stage_changed_by     uuid,
  add column stage_changed_at     timestamptz,
  add column creator_budget       numeric,
  add column ads_budget_planned   numeric,
  add column base_fee             numeric,
  add column creator_quota        integer,
  add column allocated_amount     numeric generated always as (base_fee * creator_quota) stored,
  add column over_budget          boolean not null default false,
  add column over_budget_reason   text,
  add column target_gmv           numeric,
  add column target_views         numeric,
  add column target_location_id   text,
  add column post_window_start    date,
  add column post_window_end      date,
  add column submission_deadline  timestamptz,
  add column brief                text,
  add column has_free_meal        boolean not null default false,
  -- Segmentasi kelayakan pendaftar (keputusan #9) — dipakai G.2, disimpan di
  -- sini karena bagian dari definisi campaign yang dibuat operator.
  add column eligible_industries    text[],
  add column eligible_cities        text[],
  add column eligible_levels        text[],
  add column eligible_creator_types text[],
  add column eligible_roster_status text[],
  add column eligible_status_kontrak text[],
  add column min_gmv               numeric,
  add column min_gmv_metric        text check (min_gmv_metric in ('gmv','video_gmv')),
  add column min_gmv_period_days   integer;

comment on column brand_deals.campaign_enabled is
  'true = baris ini campaign kreator MEA GO (Fase G), bukan Merchant Deals biasa. Satu entitas brand_deals dipakai untuk keduanya (keputusan #1).';
comment on column brand_deals.funding_source is
  'internal = budget Campaign Specialist; brand = budget BizDev/brand (keputusan #2).';
comment on column brand_deals.campaign_mode is
  'Selaras Task type export TikTok (lib/mcn/content-analysis.ts): collaboration_package vs others — dipakai validasi ingest G.5.';
comment on column brand_deals.operational_team is
  'Divisi pelaksana operasional: CampaignSpecialist (self-serve) atau Account (BizDev melempar ke AM — keputusan #4).';
comment on column brand_deals.operational_owner_id is
  'AM/pemilik operasional saat operational_team=Account. Menentukan siapa yang boleh menulis (RLS).';
comment on column brand_deals.campaign_stage is
  'State machine TERPISAH dari brand_deals.status (yang dipakai entity brand_deal) — lihat trg_brand_deals_campaign_stage / enforce_campaign_stage_transition(). Nilai baru (mis. registration_open di G.2) tinggal ubah CHECK constraint + baris status_transitions, tidak perlu ALTER TYPE.';
comment on column brand_deals.creator_quota is
  'Jumlah slot kreator. allocated_amount = base_fee × creator_quota (keputusan #6, flat tanpa kelipatan — keputusan #8).';
comment on column brand_deals.allocated_amount is
  'Kolom turunan (generated, read-only) — jangan ditulis langsung, hanya hasil base_fee × creator_quota.';
comment on column brand_deals.over_budget is
  'true hanya boleh menyala lewat override Lead+ dengan over_budget_reason terisi (campaign_budget_guard trigger). Hard block untuk staff (keputusan #5).';
comment on column brand_deals.target_location_id is
  'TikTok Location ID target campaign. BUKAN brand_deals.shop_id (itu partial-unique untuk Merchant Deals, satu shop = satu deal) — satu Location boleh jadi target banyak campaign dari waktu ke waktu.';

create index brand_deals_campaign_idx on brand_deals (campaign_enabled, campaign_stage) where campaign_enabled;
create index brand_deals_operational_owner_idx on brand_deals (operational_owner_id) where operational_owner_id is not null;
create index brand_deals_target_location_idx on brand_deals (target_location_id) where target_location_id is not null;

-- ---- 2. campaign_budget_log (append-only snapshot tiap perubahan budget) ----
create table campaign_budget_log (
  id                 uuid primary key default gen_random_uuid(),
  deal_id            uuid not null references brand_deals(id) on delete cascade,
  creator_budget     numeric,
  base_fee           numeric,
  creator_quota      integer,
  allocated_amount   numeric,
  over_budget        boolean not null default false,
  over_budget_reason text,
  actor              uuid,
  created_at         timestamptz not null default now()
);

comment on table campaign_budget_log is
  'Log append-only setiap kali field budget/over_budget campaign berubah (ditulis trigger campaign_budget_log_write, bukan app). Dasar audit "siapa override over budget, kapan, kenapa" (keputusan #5).';

create index campaign_budget_log_deal_idx on campaign_budget_log (deal_id, created_at);

alter table campaign_budget_log enable row level security;
create policy campaign_budget_log_select on campaign_budget_log for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account'));
-- Tulis hanya lewat trigger SECURITY DEFINER — tidak ada policy insert/update/delete.

-- ---- 3. campaign_ads_spend (realisasi ads_budget, input manual multi-entri) -
create table campaign_ads_spend (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references brand_deals(id) on delete cascade,
  spend_date  date not null,
  amount      numeric not null check (amount >= 0),
  note        text,
  entered_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

comment on table campaign_ads_spend is
  'Realisasi ads_budget, input manual multi-entri (keputusan #7). Dipakai hitung ROAS — target rencana ada di brand_deals.ads_budget_planned.';

create index campaign_ads_spend_deal_idx on campaign_ads_spend (deal_id, spend_date);

create trigger trg_campaign_ads_spend_audit after insert or update on campaign_ads_spend
  for each row execute function capture_audit('campaign_ads_spend');

alter table campaign_ads_spend enable row level security;
create policy campaign_ads_spend_select on campaign_ads_spend for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account'));
create policy campaign_ads_spend_manage on campaign_ads_spend for all to authenticated
  using (
    is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist')
    or (auth_division() = 'Account' and exists (
          select 1 from brand_deals d
          where d.id = campaign_ads_spend.deal_id and d.operational_owner_id = auth_emp_id()
        ))
  )
  with check (
    is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist')
    or (auth_division() = 'Account' and exists (
          select 1 from brand_deals d
          where d.id = campaign_ads_spend.deal_id and d.operational_owner_id = auth_emp_id()
        ))
  );

-- Rekap ringan dipakai halaman detail campaign & (nanti) perhitungan ROAS.
create view v_campaign_ads_spend_summary
  with (security_invoker = true) as
  select deal_id,
         coalesce(sum(amount), 0) as total_ads_spend,
         count(*)                 as entry_count,
         max(spend_date)          as last_spend_date
  from campaign_ads_spend
  group by deal_id;

comment on view v_campaign_ads_spend_summary is
  'Rekap realisasi ads spend per campaign. security_invoker=true → tunduk RLS campaign_ads_spend pemanggil.';

-- ---- 4. Budget guard: hard block staff, Lead+ override wajib alasan + log --
create or replace function campaign_budget_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_allocated numeric;
begin
  if not coalesce(new.campaign_enabled, false) then
    return new;
  end if;

  if new.base_fee is not null and new.creator_quota is not null then
    v_allocated := new.base_fee * new.creator_quota;
  else
    v_allocated := null;
  end if;

  if v_allocated is not null and new.creator_budget is not null and v_allocated > new.creator_budget then
    if not coalesce(new.over_budget, false) then
      raise exception
        '[alokasi budget (base fee × kuota kreator = %) melebihi creator_budget (%) — tandai Over Budget dengan alasan untuk lanjut]',
        v_allocated, new.creator_budget
        using errcode = 'check_violation';
    end if;
    if new.over_budget_reason is null or btrim(new.over_budget_reason) = '' then
      raise exception '[alasan Over Budget wajib diisi]' using errcode = 'check_violation';
    end if;
    if not (actor_tokens() && array['lead','od','director']) then
      raise exception '[hanya Lead ke atas yang dapat mengaktifkan campaign Over Budget]'
        using errcode = 'insufficient_privilege';
    end if;
  else
    -- Tidak (lagi) over budget: bersihkan flag supaya data tidak menyimpan klaim basi.
    new.over_budget := false;
    new.over_budget_reason := null;
  end if;

  return new;
end $$;

comment on function campaign_budget_guard() is
  'BEFORE INSERT/UPDATE brand_deals (campaign_enabled=true): hard block staff kalau alokasi (base_fee×creator_quota) > creator_budget, kecuali Lead+ override dengan alasan (keputusan #5). Auto-bersihkan over_budget saat sudah tidak over budget.';

drop trigger if exists trg_brand_deals_campaign_budget on brand_deals;
create trigger trg_brand_deals_campaign_budget before insert or update on brand_deals
  for each row execute function campaign_budget_guard();

revoke execute on function campaign_budget_guard() from public, anon, authenticated;

-- ---- 5. Log budget: snapshot AFTER setiap perubahan relevan ----------------
create or replace function campaign_budget_log_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(new.campaign_enabled, false) then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.creator_budget     is not distinct from old.creator_budget
     and new.base_fee           is not distinct from old.base_fee
     and new.creator_quota      is not distinct from old.creator_quota
     and new.over_budget        is not distinct from old.over_budget
     and new.over_budget_reason is not distinct from old.over_budget_reason
  then
    return null; -- tidak ada perubahan relevan budget, jangan tulis log kosong
  end if;

  insert into campaign_budget_log
    (deal_id, creator_budget, base_fee, creator_quota, allocated_amount, over_budget, over_budget_reason, actor)
  values (
    new.id, new.creator_budget, new.base_fee, new.creator_quota, new.allocated_amount,
    coalesce(new.over_budget, false), new.over_budget_reason, auth.uid()
  );
  return null;
end $$;

comment on function campaign_budget_log_write() is
  'AFTER INSERT/UPDATE brand_deals (campaign_enabled=true): tulis snapshot ke campaign_budget_log setiap field budget/over_budget berubah. Append-only.';

drop trigger if exists trg_brand_deals_campaign_budget_log on brand_deals;
create trigger trg_brand_deals_campaign_budget_log after insert or update on brand_deals
  for each row execute function campaign_budget_log_write();

revoke execute on function campaign_budget_log_write() from public, anon, authenticated;

-- ---- 6. campaign_stage: state machine TERPISAH dari status -----------------
-- Kloning enforce_execution_transition() (0200_module6_account.sql) — bukan
-- enforce_status_transition() yang hardcode kolom `status` dan sudah dipakai
-- entity 'brand_deal' pada tabel yang sama.
create or replace function enforce_campaign_stage_transition()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_allowed text[];
  v_found   boolean;
begin
  if new.campaign_stage is distinct from old.campaign_stage then
    select allowed_tokens, true into v_allowed, v_found
    from status_transitions
    where entity = 'campaign_stage'
      and from_status = old.campaign_stage
      and to_status   = new.campaign_stage;

    if not coalesce(v_found, false) then
      raise exception '[transisi stage campaign tidak diizinkan: % → %]', old.campaign_stage, new.campaign_stage
        using errcode = 'check_violation';
    end if;
    if v_allowed is not null and not (v_allowed && actor_tokens()) then
      raise exception '[anda tidak berwenang melakukan transisi stage campaign ini]'
        using errcode = 'insufficient_privilege';
    end if;

    -- Gerbang kelengkapan sebelum campaign diaktifkan (G.2+ butuh field ini
    -- untuk pendaftaran/segmentasi).
    if new.campaign_stage = 'active' and old.campaign_stage = 'draft' then
      if new.funding_source is null or new.campaign_track is null or new.operational_team is null
         or new.base_fee is null or new.creator_quota is null or new.creator_budget is null
         or new.target_location_id is null then
        raise exception
          '[data campaign belum lengkap — funding source, track, tim operasional, base fee, kuota kreator, creator budget, dan target location wajib diisi sebelum diaktifkan]'
          using errcode = 'check_violation';
      end if;
    end if;

    new.stage_changed_by := auth.uid();
    new.stage_changed_at := now();
  end if;
  return new;
end $$;

comment on function enforce_campaign_stage_transition() is
  'State machine campaign_stage, terpisah dari enforce_status_transition() (yang hardcode kolom status). Menstempel stage_changed_by/at (bukan status_changed_by/at milik entity brand_deal).';

drop trigger if exists trg_brand_deals_campaign_stage on brand_deals;
create trigger trg_brand_deals_campaign_stage before update on brand_deals
  for each row execute function enforce_campaign_stage_transition();

revoke execute on function enforce_campaign_stage_transition() from public, anon, authenticated;

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('campaign_stage','draft','active',       null),
  ('campaign_stage','draft','cancelled',    array['lead','od','director']),
  ('campaign_stage','active','on_hold',     null),
  ('campaign_stage','on_hold','active',     null),
  ('campaign_stage','active','completed',   null),
  ('campaign_stage','active','cancelled',   array['lead','od','director']),
  ('campaign_stage','on_hold','cancelled',  array['lead','od','director']);

-- ---- 7. RLS brand_deals: tambah CampaignSpecialist, batasi Account --------
-- Sebelumnya (0305_deals.sql:150-159): select BizDev/CreatorManagement/Account,
-- insert/update mgmt+BizDev(+CM self-sourced). Diperluas supaya CampaignSpecialist
-- (kerja sendiri, keputusan #4) setara BizDev, dan Account HANYA boleh menulis
-- baris campaign miliknya sendiri (operational_owner_id = auth_emp_id()) —
-- Account tidak boleh menyentuh Merchant Deals biasa (campaign_enabled=false)
-- ataupun campaign milik AM lain.
drop policy if exists brand_deals_select on brand_deals;
create policy brand_deals_select on brand_deals for select to authenticated
  using (is_od() or is_director()
         or auth_division() in ('BizDev','CreatorManagement','Account','CampaignSpecialist'));

drop policy if exists brand_deals_insert on brand_deals;
create policy brand_deals_insert on brand_deals for insert to authenticated
  with check (
    is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist')
    or (auth_division() = 'CreatorManagement' and sourced_by_role = 'cm')
  );

drop policy if exists brand_deals_update on brand_deals;
create policy brand_deals_update on brand_deals for update to authenticated
  using (
    is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist')
    or (auth_division() = 'Account' and campaign_enabled and operational_owner_id = auth_emp_id())
  );
