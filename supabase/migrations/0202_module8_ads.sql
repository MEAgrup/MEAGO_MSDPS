-- =============================================================================
-- MSDPS · Fase C · Module 8 — Ads (`ADC-…`, `WPE-…`)
-- =============================================================================
-- Brief Ads meledak jadi N Ad Campaign Record (1 record = 1 campaign di 1
-- platform). Go-live approval = Ads Lead/SPV; AM informational di go-live tapi
-- punya formal Revision power selama campaign jalan. WPE mingguan wajib saat
-- Live/Optimizing; Final Report wajib sebelum [Completed]. Dual currency
-- IDR/USD tanpa auto-convert; ROAS & CTR auto-calculated (generated columns).
-- =============================================================================

create type adc_status as enum (
  '[Setup In Progress]','[Pending Go-Live Approval]','[Live]','[Optimizing]',
  '[Revision Requested]','[Paused]','[Completed]','[Cancelled]'
);
create type wpe_entry_type as enum ('[Weekly]','[Final Report]');

create table ad_campaign_records (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                  -- ADC-YYYYMM-NNNN
  brief_id            uuid not null references briefs(id),
  platform            text not null check (platform in
                        ('TikTok Ads','Shopee Ads','Meta Ads','Google Ads','Other')),
  objective           text not null check (objective in
                        ('Traffic','Conversion','Awareness','Engagement')),
  currency            text not null default 'IDR' check (currency in ('IDR','USD')),
  budget_allocated    numeric,                      -- wajib sebelum go-live
  creative_ref        text,
  go_live_date        date,                         -- auto saat [Live]
  end_date            date,                         -- auto saat [Completed]
  status              adc_status not null default '[Setup In Progress]',
  assigned_staff      uuid references employees(id),
  revision_count      int not null default 0,
  revision_notes      text,
  pause_reason        text,
  cancellation_reason text,
  created_at          timestamptz not null default now(),
  status_changed_by   uuid,
  status_changed_at   timestamptz
);

create index adc_brief_idx on ad_campaign_records (brief_id, status);

create or replace function adc_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brief  briefs%rowtype;
  v_count  int;
  v_sum    numeric;
  v_budget numeric;
begin
  select * into v_brief from briefs where id = new.brief_id;
  if not found then raise exception '[brief tidak ditemukan]'; end if;

  if tg_op = 'INSERT' then
    if v_brief.assigned_division <> 'Ads' then
      raise exception '[brief tidak sesuai dengan tipe service yang dipilih]'
        using errcode = 'check_violation';
    end if;
    if v_brief.status not in ('[In Progress]','[Overdue]') or v_brief.assigned_pic is null then
      raise exception '[brief belum di-pick up dari queue Ads]' using errcode = 'check_violation';
    end if;
    if not (is_od() or is_director() or auth_division() = 'Ads') then
      raise exception '[hanya staff Ads yang dapat membuat Ad Campaign Record]'
        using errcode = 'insufficient_privilege';
    end if;
    -- Hard cap: jumlah campaign non-cancelled <= Target Campaign Count (M8 Rule 3).
    select count(*) into v_count from ad_campaign_records
    where brief_id = new.brief_id and status <> '[Cancelled]';
    if v_count >= coalesce(v_brief.quantity_target, 0) then
      raise exception '[jumlah campaign melebihi Target Campaign Count, butuh approval SPV untuk menaikkan target]'
        using errcode = 'check_violation';
    end if;
    new.assigned_staff := coalesce(new.assigned_staff, auth.uid());
  end if;

  -- Validasi budget per currency (M8 Rule 4 & §4.4) — saat isi/ubah budget.
  if new.budget_allocated is not null then
    v_budget := case new.currency when 'IDR' then v_brief.budget_total_idr
                                  else v_brief.budget_total_usd end;
    select coalesce(sum(budget_allocated),0) into v_sum from ad_campaign_records
    where brief_id = new.brief_id and currency = new.currency
      and status <> '[Cancelled]' and id <> new.id;
    if v_budget is null or v_sum + new.budget_allocated > v_budget then
      raise exception '[Budget Allocated melebihi total budget Brief pada currency %]', new.currency
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- Submit go-live: currency + budget wajib (M8 Rule 4).
    if new.status = '[Pending Go-Live Approval]' and old.status is distinct from new.status then
      if new.budget_allocated is null or new.budget_allocated <= 0 then
        raise exception '[Currency dan Budget Allocated wajib diisi sebelum go-live]'
          using errcode = 'check_violation';
      end if;
    end if;
    if new.status = '[Live]' and old.status is distinct from new.status then
      new.go_live_date := coalesce(new.go_live_date, current_date);
    end if;
    -- Formal Revision Request hanya oleh AM/Account (M8 Rule 9).
    if new.status = '[Revision Requested]' and old.status is distinct from new.status then
      if not (auth_division() = 'Account' or is_od() or is_director()) then
        raise exception '[formal Revision Request hanya dapat diajukan oleh AM]'
          using errcode = 'insufficient_privilege';
      end if;
      if new.revision_notes is null or btrim(new.revision_notes) = '' then
        raise exception '[Revision Notes wajib diisi]' using errcode = 'check_violation';
      end if;
      new.revision_count := old.revision_count + 1;
    end if;
    -- Pause: AM set, alasan wajib (M8 Rule 5).
    if new.status = '[Paused]' and old.status is distinct from new.status then
      if not (auth_division() = 'Account' or is_od() or is_director()) then
        raise exception '[hanya AM yang dapat mem-pause campaign]'
          using errcode = 'insufficient_privilege';
      end if;
      if new.pause_reason is null or btrim(new.pause_reason) = '' then
        raise exception '[alasan pause wajib diisi]' using errcode = 'check_violation';
      end if;
    end if;
    -- Cancel: AM, alasan wajib; target Brief turun via AFTER trigger (M8 Rule 11).
    if new.status = '[Cancelled]' and old.status is distinct from new.status then
      if not (auth_division() = 'Account' or is_od() or is_director()) then
        raise exception '[hanya AM yang dapat membatalkan campaign]'
          using errcode = 'insufficient_privilege';
      end if;
      if new.cancellation_reason is null or btrim(new.cancellation_reason) = '' then
        raise exception '[alasan pembatalan wajib diisi]' using errcode = 'check_violation';
      end if;
    end if;
    -- Completed: Final Report wajib ada (M8 Rule 8).
    if new.status = '[Completed]' and old.status is distinct from new.status then
      if not exists (select 1 from weekly_performance_entries
                     where campaign_record_id = new.id and entry_type = '[Final Report]') then
        raise exception '[Final Report wajib disubmit sebelum campaign di-set Completed]'
          using errcode = 'check_violation';
      end if;
      new.end_date := coalesce(new.end_date, current_date);
    end if;
  end if;

  if new.code is null then new.code := next_code('ADC');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- =============================================================================
-- Weekly Performance Entry (`WPE-…`) — time series performa per campaign
-- =============================================================================
create table weekly_performance_entries (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,                   -- WPE-YYYYMM-NNNN
  campaign_record_id uuid not null references ad_campaign_records(id),
  week_number        int not null,
  entry_type         wpe_entry_type not null default '[Weekly]',
  spend              numeric not null,
  impressions        bigint not null,
  clicks             bigint not null,
  conversions        numeric,                       -- untuk campaign non-GMV
  gmv_generated      numeric,                       -- TikTok/Shopee Conversion campaigns
  roas               numeric generated always as
                       (case when spend > 0 and gmv_generated is not null
                             then round(gmv_generated / spend, 2) end) stored,
  ctr                numeric generated always as
                       (case when impressions > 0
                             then round(clicks::numeric / impressions * 100, 2) end) stored,
  notes              text,                          -- wajib untuk Final Report
  am_comment         text,                          -- komentar ringan AM (non-formal)
  created_by         uuid default auth.uid(),
  submitted_at       timestamptz not null default now(),
  unique (campaign_record_id, week_number, entry_type)
);

create or replace function wpe_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_adc ad_campaign_records%rowtype;
begin
  if new.week_number is null or new.entry_type is null
     or new.spend is null or new.impressions is null or new.clicks is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.conversions is null and new.gmv_generated is null then
    raise exception '[Conversions atau GMV Generated wajib diisi]' using errcode = 'check_violation';
  end if;
  if new.entry_type = '[Final Report]' and (new.notes is null or btrim(new.notes) = '') then
    raise exception '[Final Report wajib berisi summary dan rekomendasi di kolom Notes]'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    select * into v_adc from ad_campaign_records where id = new.campaign_record_id;
    if not found then raise exception '[campaign record tidak ditemukan]'; end if;
    if v_adc.status not in ('[Live]','[Optimizing]') then
      raise exception '[WPE hanya dapat dibuat saat campaign Live atau Optimizing]'
        using errcode = 'check_violation';
    end if;
    if not (is_od() or is_director() or auth_division() = 'Ads') then
      raise exception '[hanya staff Ads yang dapat membuat WPE]'
        using errcode = 'insufficient_privilege';
    end if;
    if exists (select 1 from weekly_performance_entries
               where campaign_record_id = new.campaign_record_id
                 and week_number = new.week_number and entry_type = new.entry_type) then
      raise exception '[sudah ada WPE untuk minggu ini di campaign ini]'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.code is null then new.code := next_code('WPE');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_adc_validate before insert or update on ad_campaign_records
  for each row execute function adc_validate();
create trigger trg_adc_status before update on ad_campaign_records
  for each row execute function enforce_status_transition('ad_campaign');
create trigger trg_adc_audit after insert or update on ad_campaign_records
  for each row execute function capture_audit('ad_campaign');

create trigger trg_wpe_validate before insert or update on weekly_performance_entries
  for each row execute function wpe_validate();
create trigger trg_wpe_audit after insert or update on weekly_performance_entries
  for each row execute function capture_audit('wpe');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('ad_campaign','[Setup In Progress]','[Pending Go-Live Approval]', null),
  ('ad_campaign','[Pending Go-Live Approval]','[Setup In Progress]', '{lead,od,director}'),
  ('ad_campaign','[Pending Go-Live Approval]','[Live]',              '{lead,od,director}'),
  ('ad_campaign','[Live]','[Optimizing]',                            null),
  ('ad_campaign','[Optimizing]','[Live]',                            null),
  ('ad_campaign','[Live]','[Revision Requested]',                    null),
  ('ad_campaign','[Optimizing]','[Revision Requested]',              null),
  ('ad_campaign','[Revision Requested]','[Pending Go-Live Approval]',null),
  ('ad_campaign','[Live]','[Paused]',                                null),
  ('ad_campaign','[Optimizing]','[Paused]',                          null),
  ('ad_campaign','[Paused]','[Live]',                                null),
  ('ad_campaign','[Live]','[Completed]',                             null),
  ('ad_campaign','[Setup In Progress]','[Cancelled]',                null),
  ('ad_campaign','[Paused]','[Cancelled]',                           null),
  ('ad_campaign','[Live]','[Cancelled]',                             null);

-- Completion % Brief = Completed campaigns / Target Campaign Count (M8 Rule 10–11).
create or replace function adc_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_target    numeric;
  v_completed int;
  v_pct       numeric;
begin
  if tg_op = 'UPDATE' and new.status = '[Cancelled]' and old.status <> '[Cancelled]' then
    update briefs set quantity_target = greatest(coalesce(quantity_target,0) - 1, 0)
    where id = new.brief_id;
  end if;

  select quantity_target into v_target from briefs where id = new.brief_id;
  select count(*) into v_completed from ad_campaign_records
  where brief_id = new.brief_id and status = '[Completed]';

  v_pct := case when coalesce(v_target,0) > 0
                then round(v_completed::numeric / v_target * 100, 1) else 0 end;

  update briefs set completion_pct = v_pct where id = new.brief_id;

  if v_pct >= 100 then
    update briefs set status = '[Completed]'
    where id = new.brief_id and status in ('[In Progress]','[Overdue]');
  end if;
  return null;
end $$;

create trigger trg_adc_after after insert or update on ad_campaign_records
  for each row execute function adc_after_change();

-- ---- RLS ----------------------------------------------------------------------
alter table ad_campaign_records enable row level security;
create policy adc_select on ad_campaign_records for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Ads','Account'));
create policy adc_insert on ad_campaign_records for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'Ads');
create policy adc_update on ad_campaign_records for update to authenticated
  using (is_od() or is_director() or auth_division() in ('Ads','Account'));

alter table weekly_performance_entries enable row level security;
create policy wpe_select on weekly_performance_entries for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Ads','Account'));
create policy wpe_insert on weekly_performance_entries for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'Ads');
create policy wpe_update on weekly_performance_entries for update to authenticated
  using (is_od() or is_director() or auth_division() in ('Ads','Account'));

-- ---- Function grants -----------------------------------------------------------
revoke execute on function adc_validate()      from public, anon, authenticated;
revoke execute on function adc_after_change()  from public, anon, authenticated;
revoke execute on function wpe_validate()      from public, anon, authenticated;
