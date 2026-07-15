-- =============================================================================
-- MSDPS · MCN · Migration 0307 — Akuisisi Kreator (`ACQ-…`, `RFR-…`)
-- =============================================================================
-- acquisitions : catatan closing/binding kreator oleh specialist. code
--                ACQ-YYYYMM-NNNN. specialist_id DIPAKSA = auth.uid() saat insert
--                (trigger) — actor tak bisa mengklaim closing orang lain. Snapshot
--                commission_share_at_binding; GMV baseline/post-join log-only.
-- referrals    : referral kreator baru. code RFR-YYYYMM-NNNN. Check constraint
--                referral_source ↔ referrer (antar_creator wajib referrer;
--                platform tanpa referrer). markReferralPaid: guard sudah dibayar +
--                hanya lead/management (enforce trigger).
-- =============================================================================

create table acquisitions (
  id                          uuid primary key default gen_random_uuid(),
  code                        text unique,                        -- ACQ-YYYYMM-NNNN
  mcn_creator_id              uuid not null references mcn_creators(id),
  specialist_id               uuid not null,                      -- dipaksa = auth.uid() (trigger)
  lead_source                 text check (lead_source in ('inbound','outbound','platform')),
  binding_date                date not null,
  commission_share_at_binding numeric,                            -- snapshot
  gmv_last_30d                numeric,                            -- baseline log-only
  gmv_post_join               numeric,
  gmv_quarter_actual          numeric,
  quarter_end                 date,
  handoff_done                boolean not null default false,
  notes                       text,
  created_at                  timestamptz not null default now()
);

create index acquisitions_creator_idx on acquisitions (mcn_creator_id);
create index acquisitions_specialist_idx on acquisitions (specialist_id);

create or replace function acquisitions_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Specialist selalu actor sendiri (tak bisa diklaim atas nama orang lain).
  if tg_op = 'INSERT' then
    new.specialist_id := auth.uid();
  end if;
  if new.mcn_creator_id is null or new.binding_date is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.code is null then
    new.code := next_code('ACQ');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_acquisitions_validate before insert or update on acquisitions
  for each row execute function acquisitions_validate();
create trigger trg_acquisitions_audit after insert or update on acquisitions
  for each row execute function capture_audit('acquisition');

-- ---- referrals --------------------------------------------------------------
create table referrals (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                                -- RFR-YYYYMM-NNNN
  new_creator_id      uuid not null references mcn_creators(id),
  referrer_creator_id uuid references mcn_creators(id),
  referral_source     text not null check (referral_source in ('antar_creator','platform')),
  commission_status   text not null default 'pending'
                        check (commission_status in ('pending','dibayar')),
  recorded_by         uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  constraint chk_referral_source check (
    (referral_source = 'antar_creator' and referrer_creator_id is not null)
    or (referral_source = 'platform' and referrer_creator_id is null)
  )
);

create index referrals_new_creator_idx on referrals (new_creator_id);

create or replace function referrals_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.new_creator_id is null or new.referral_source is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  -- markReferralPaid: guard sudah dibayar + hanya lead/management.
  if tg_op = 'UPDATE' and new.commission_status is distinct from old.commission_status then
    if old.commission_status = 'dibayar' then
      raise exception '[referral sudah dibayar]' using errcode = 'check_violation';
    end if;
    if not (actor_tokens() && array['lead','od','director']) then
      raise exception '[hanya lead/management yang dapat menandai referral dibayar]'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  if new.code is null then
    new.code := next_code('RFR');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_referrals_validate before insert or update on referrals
  for each row execute function referrals_validate();
create trigger trg_referrals_audit after insert or update on referrals
  for each row execute function capture_audit('referral');

-- ---- RLS --------------------------------------------------------------------
-- Baca: Acquisition + CM + mgmt. Insert/update: Acquisition + mgmt
-- (markReferralPaid lead/od/director diperketat trigger).
alter table acquisitions enable row level security;
create policy acquisitions_select on acquisitions for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Acquisition','CreatorManagement'));
create policy acquisitions_insert on acquisitions for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'Acquisition');
create policy acquisitions_update on acquisitions for update to authenticated
  using (is_od() or is_director() or auth_division() = 'Acquisition');

alter table referrals enable row level security;
create policy referrals_select on referrals for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Acquisition','CreatorManagement'));
create policy referrals_insert on referrals for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'Acquisition');
create policy referrals_update on referrals for update to authenticated
  using (is_od() or is_director() or auth_division() = 'Acquisition');

revoke execute on function acquisitions_validate() from public, anon, authenticated;
revoke execute on function referrals_validate()    from public, anon, authenticated;
