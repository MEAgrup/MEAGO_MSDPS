-- =============================================================================
-- MSDPS · Fase G.4 · Migration 0345 — Batch kurasi + payout campaign
-- =============================================================================
-- Lanjutan G.1-G.3 (0341-0344). Cakupan G.4 (docs/HANDOFF_FaseG.md §6):
-- campaign_curation_batches (CUR-), campaign_payouts (CPY-),
-- close_curation_batch() idempoten, antrian di /finance. INI LOGIKA UANG —
-- lib/campaign-completion.ts (cermin fungsi close_curation_batch di bawah)
-- WAJIB diuji lewat scripts/test_campaign_completion.mjs sebelum dipakai UI.
--
-- Keputusan TERKUNCI yang relevan (§5):
--   #6  Alokasi = base_fee × kuota slot ≤ creator_budget — payout PER KREATOR
--       tetap flat base_fee (bukan alokasi dibagi rata), sesuai #8.
--   #8  Base fee flat per campaign, tanpa kelipatan.
--   #13 Kurasi: batch periode formal → tutup periode → SATU pengajuan ke
--       Finance. Sekali batch ditutup, peserta yang lolos di batch itu tidak
--       diproses ulang di batch berikutnya (no double-pay).
--   #15 Payout: tabel BARU campaign_payouts — creator_payouts (M5/M9) TIDAK
--       disentuh (referenced_bookings/creator_id/milestone_unit_value M9
--       tidak relevan di sini). Enum payout_status DIPAKAI ULANG (sudah ada
--       dari 0103_module5_finance.sql) supaya antrian /finance seragam.
--
-- "Completed" (berhak payout) = participant approved + punya minimal satu
-- bukti valid sesuai campaign_track (video: campaign_video_submissions
-- non-duplikat; live: minimal satu campaign_live_submissions) + belum pernah
-- dibayar di batch lain untuk deal yang sama. Definisi ini hidup di DUA
-- tempat yang HARUS disinkronkan manual bila berubah: close_curation_batch()
-- di bawah (otoritas final) dan lib/campaign-completion.ts (preview UI).
-- =============================================================================

-- ---- 1. campaign_curation_batches -------------------------------------------
create table campaign_curation_batches (
  id               uuid primary key default gen_random_uuid(),
  code             text unique,                              -- CUR-YYYYMM-NNNN
  deal_id          uuid not null references brand_deals(id),
  period_start     date not null,
  period_end       date not null,
  status           text not null default 'draft' check (status in ('draft','closed')),
  total_completed  integer,
  total_amount     numeric,
  closed_by        uuid references employees(id),
  closed_at        timestamptz,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz,
  constraint chk_curation_batch_period check (period_end >= period_start)
);

comment on table campaign_curation_batches is
  'Batch kurasi periode formal per campaign (keputusan #13). total_completed/total_amount diisi close_curation_batch() saat ditutup — NULL selama masih draft.';

create index campaign_curation_batches_deal_idx on campaign_curation_batches (deal_id);

create or replace function campaign_curation_batches_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null then
    new.code := next_code('CUR');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_campaign_curation_batches_validate before insert or update on campaign_curation_batches
  for each row execute function campaign_curation_batches_validate();
create trigger trg_campaign_curation_batches_status before update on campaign_curation_batches
  for each row execute function enforce_status_transition('campaign_curation_batch');
create trigger trg_campaign_curation_batches_audit after insert or update on campaign_curation_batches
  for each row execute function capture_audit('campaign_curation_batch');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('campaign_curation_batch','draft','closed', null);

revoke execute on function campaign_curation_batches_validate() from public, anon, authenticated;

-- select: tim campaign + mgmt + Finance (lihat apa yang akan/sudah masuk
-- antrian). insert: tim campaign + mgmt buat batch draft untuk campaign
-- mereka. TIDAK ADA policy update — satu-satunya jalan ke status 'closed'
-- adalah close_curation_batch() (SECURITY DEFINER di bawah), supaya
-- perhitungan payout tidak bisa dipintas lewat PATCH langsung ke tabel.
alter table campaign_curation_batches enable row level security;
create policy campaign_curation_batches_select on campaign_curation_batches for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account','Finance'));
create policy campaign_curation_batches_insert on campaign_curation_batches for insert to authenticated
  with check (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account'));

-- ---- 2. campaign_payouts (reuse payout_status dari 0103, tabel BARU) -------
create table campaign_payouts (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique,                            -- CPY-YYYYMM-NNNN
  batch_id            uuid not null references campaign_curation_batches(id),
  deal_id             uuid not null references brand_deals(id),
  participant_id      uuid not null references campaign_participants(id),
  mcn_creator_id      uuid not null references mcn_creators(id),
  amount              numeric not null,
  status              payout_status not null default '[Menunggu Disbursement]',
  requested_by        uuid,
  requested_at        timestamptz not null default now(),
  transferred_at      timestamptz,
  transfer_proof      text,
  cancelled_by        uuid,
  cancellation_reason text,
  status_changed_by   uuid,
  status_changed_at   timestamptz,
  unique (participant_id)  -- satu peserta hanya sekali dibayar, lintas batch manapun
);

comment on table campaign_payouts is
  'Payout campaign kreator (Fase G.4, keputusan #15) — TABEL BARU, creator_payouts (M5/M9) tidak disentuh. Enum payout_status dipakai ulang supaya antrian /finance seragam dengan payout KOL. Baris HANYA dibuat lewat close_curation_batch(), tidak ada insert manual.';

create index campaign_payouts_deal_idx on campaign_payouts (deal_id);
create index campaign_payouts_batch_idx on campaign_payouts (batch_id);
create index campaign_payouts_status_idx on campaign_payouts (status);

create or replace function campaign_payouts_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = '[Dibatalkan]' and (new.cancellation_reason is null or btrim(new.cancellation_reason) = '') then
    raise exception '[alasan pembatalan wajib diisi]' using errcode = 'check_violation';
  end if;
  if new.code is null then
    new.code := next_code('CPY');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  if tg_op = 'UPDATE' and new.status = '[Ditransfer]' and old.status <> '[Ditransfer]' and new.transferred_at is null then
    new.transferred_at := now();
  end if;
  return new;
end $$;

create trigger trg_campaign_payouts_validate before insert or update on campaign_payouts
  for each row execute function campaign_payouts_validate();
create trigger trg_campaign_payouts_status before update on campaign_payouts
  for each row execute function enforce_status_transition('campaign_payout');
create trigger trg_campaign_payouts_audit after insert or update on campaign_payouts
  for each row execute function capture_audit('campaign_payout');

-- Cermin persis status_transitions creator_payout (0103:142-143) supaya
-- perilaku antrian /finance identik.
insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('campaign_payout','[Menunggu Disbursement]','[Ditransfer]', null),
  ('campaign_payout','[Menunggu Disbursement]','[Dibatalkan]', array['lead','director']);

revoke execute on function campaign_payouts_validate() from public, anon, authenticated;

-- select: Finance + tim campaign + mgmt (lihat status payout mereka) +
-- kreator sendiri (portal — lihat apakah sudah dibayar). update: HANYA
-- Finance/mgmt, cermin pyo_update (0103:261-263) — tim campaign tidak
-- menulis status payout, itu wewenang Finance.
alter table campaign_payouts enable row level security;
create policy campaign_payouts_select on campaign_payouts for select to authenticated
  using (
    is_od() or is_director() or auth_division() in ('Finance','BizDev','CampaignSpecialist','Account')
    or mcn_creator_id = auth_creator_id()
  );
create policy campaign_payouts_update on campaign_payouts for update to authenticated
  using (auth_division() = 'Finance' or is_director() or is_od());

-- ---- 3. close_curation_batch(): idempoten, hitung completed + insert payout
create or replace function close_curation_batch(p_batch_id uuid)
returns table(payouts_created integer, total_amount numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_batch   campaign_curation_batches%rowtype;
  v_deal    brand_deals%rowtype;
  v_created integer := 0;
  v_total   numeric := 0;
  r         record;
begin
  select * into v_batch from campaign_curation_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception '[batch kurasi tidak ditemukan]' using errcode = 'check_violation';
  end if;

  if not (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account')) then
    raise exception '[tidak berwenang menutup batch kurasi]' using errcode = 'insufficient_privilege';
  end if;

  -- Idempoten: batch yang sudah closed TIDAK diproses ulang (tidak ada payout
  -- dobel bila tombol Tutup Periode ditekan lagi/ganda) — kembalikan angka
  -- yang sudah tersimpan dari penutupan pertama.
  if v_batch.status = 'closed' then
    return query select v_batch.total_completed, v_batch.total_amount;
    return;
  end if;

  select * into v_deal from brand_deals where id = v_batch.deal_id;

  -- base_fee belum diisi (null) atau negatif -> campaign belum siap dihitung.
  -- JANGAN buat payout Rp 0 — cermin persis lib/campaign-completion.ts, yang
  -- sengaja mengembalikan array kosong pada kondisi yang sama (lihat komentar
  -- di sana). Batch tetap ditutup (total_completed/total_amount = 0) supaya
  -- staff sadar tidak ada yang terbayar, bukan gagal senyap.
  if v_deal.base_fee is not null and v_deal.base_fee >= 0 then
    for r in
      select p.id as participant_id, p.mcn_creator_id
      from campaign_participants p
      where p.deal_id = v_batch.deal_id
        and p.status = 'approved'
        -- Belum pernah dibayar (unique participant_id di campaign_payouts) —
        -- no double-pay lintas batch (keputusan #13).
        and not exists (select 1 from campaign_payouts py where py.participant_id = p.id)
        and (
          (v_deal.campaign_track = 'video' and exists (
            select 1 from campaign_video_submissions v
            where v.participant_id = p.id and not v.is_duplicate
          ))
          or
          (v_deal.campaign_track = 'live' and exists (
            select 1 from campaign_live_submissions l where l.participant_id = p.id
          ))
        )
    loop
      insert into campaign_payouts (batch_id, deal_id, participant_id, mcn_creator_id, amount, requested_by)
      values (p_batch_id, v_batch.deal_id, r.participant_id, r.mcn_creator_id, v_deal.base_fee, auth.uid());
      v_created := v_created + 1;
      v_total := v_total + v_deal.base_fee;
    end loop;
  end if;

  update campaign_curation_batches
    set status = 'closed', total_completed = v_created, total_amount = v_total,
        closed_by = auth.uid(), closed_at = now()
    where id = p_batch_id;

  return query select v_created, v_total;
end $$;

comment on function close_curation_batch(uuid) is
  'RPC tutup periode kurasi (keputusan #13). Idempoten: batch closed dipanggil ulang mengembalikan angka lama tanpa menulis apa pun. "Completed" = participant approved + punya bukti valid sesuai campaign_track + belum pernah dibayar (unique campaign_payouts.participant_id). Payout flat base_fee per kreator (keputusan #6/#8). Cermin TS: lib/campaign-completion.ts (preview UI) — WAJIB disinkronkan manual bila logika ini berubah.';

revoke execute on function close_curation_batch(uuid) from public, anon;
grant execute on function close_curation_batch(uuid) to authenticated;
