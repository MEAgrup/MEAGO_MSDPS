-- =============================================================================
-- MSDPS · Fase G.3 · Migration 0344 — Bukti video/live + rekening kreator
-- =============================================================================
-- Lanjutan G.1/G.2 (0341-0343). Cakupan G.3 (docs/HANDOFF_FaseG.md §6):
-- campaign_video_submissions, campaign_live_submissions, bucket privat
-- campaign-proofs, mcn_creators + 3 kolom rekening, trigger gate deadline,
-- trigger tandai duplikat post_id. Kurasi batch/payout BELUM di sini (G.4).
--
-- Keputusan TERKUNCI yang relevan (§5):
--   #11 Rekening kreator diisi sekali di profil portal.
--   #12 Bukti live: tabel submission SENDIRI, live_schedule_slots (M9/KOL)
--       TIDAK dicampur — dua entitas beda arti "live" (KOL booking vs bukti
--       campaign MEA GO).
--   #14 Bukti boleh diubah kreator bebas SAMPAI deadline (brand_deals.
--       submission_deadline, 0342), lalu terkunci otomatis — diimplementasi
--       sebagai cek waktu di trigger tiap tulis (bukan kolom locked + cron,
--       supaya tidak butuh pg_cron dan tidak pernah stale).
--   #18 Deliverable video & live terpisah, tidak bentrok — dua tabel beda,
--       bukan satu tabel dengan kolom track.
-- =============================================================================

-- ---- 1. Rekening kreator (mcn_creators + 3 kolom) --------------------------
-- CATATAN DESAIN: "diisi sekali di profil portal" (#11) dibaca sebagai UX
-- (satu field profil, bukan form berulang tiap campaign) — BUKAN kunci
-- permanen setelah terisi. Kreator tetap bisa mengoreksi rekeningnya sendiri
-- kapan saja (salah ketik nomor rekening adalah risiko nyata); jika nanti
-- perlu dikunci setelah payout pertama cair, tambahkan guard terpisah saat
-- G.4 payout berjalan nyata — jangan diasumsikan di sini.
alter table mcn_creators
  add column bank_name           text,
  add column bank_account_number text,
  add column bank_account_name   text;

comment on column mcn_creators.bank_account_number is
  'Rekening pencairan payout campaign MEA GO (keputusan #11). Ditulis HANYA lewat server action service-role (lib/actions/portal.ts updateBankAccount) — RLS tidak bisa membatasi per kolom (jebakan #6), sama seperti pola auth_user_id.';

-- ---- 2. Bucket privat campaign-proofs ---------------------------------------
-- Pola identik creator-reports (0312_creator_portal_f2.sql:97-102): TANPA
-- policy storage.objects sama sekali — anon/authenticated tidak bisa
-- menyentuh file langsung, semua akses lewat service-role server action yang
-- lebih dulu memverifikasi hak lewat SELECT metadata ber-RLS (campaign_video_
-- submissions/campaign_live_submissions).
insert into storage.buckets (id, name, public)
values ('campaign-proofs', 'campaign-proofs', false)
on conflict (id) do nothing;

-- ---- 3. Helper: ekstrak Post ID dari URL TikTok -----------------------------
create or replace function extract_tiktok_post_id(p_url text)
returns text
language sql immutable as $$
  select (regexp_match(p_url, '/video/(\d+)'))[1]
$$;

comment on function extract_tiktok_post_id(text) is
  'Ambil digit setelah "/video/" dari URL TikTok, mis. https://www.tiktok.com/@user/video/123... -> "123...". NULL kalau pola tidak cocok (link bukan URL video TikTok standar) — pengisian post_id manual tetap didukung di trigger dedup.';

-- ---- 4. campaign_video_submissions ------------------------------------------
create table campaign_video_submissions (
  id               uuid primary key default gen_random_uuid(),
  participant_id   uuid not null references campaign_participants(id) on delete cascade,
  post_url         text not null,
  post_id          text,
  storage_path     text,
  is_duplicate     boolean not null default false,
  duplicate_of_id  uuid references campaign_video_submissions(id),
  submitted_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid()
);

comment on table campaign_video_submissions is
  'Bukti video kreator per pendaftaran campaign (Fase G.3). post_id diekstrak otomatis dari post_url (trigger) dipakai deteksi duplikat DI SINI dan validasi ingest TikTok (G.5, tiktok_post_index). storage_path opsional (screenshot di bucket campaign-proofs).';

create index campaign_video_submissions_participant_idx on campaign_video_submissions (participant_id);
create index campaign_video_submissions_post_id_idx on campaign_video_submissions (post_id);

-- ---- 5. campaign_live_submissions -------------------------------------------
create table campaign_live_submissions (
  id               uuid primary key default gen_random_uuid(),
  participant_id   uuid not null references campaign_participants(id) on delete cascade,
  live_date        date not null,
  duration_minutes integer not null check (duration_minutes > 0),
  proof_url        text,
  storage_path     text,
  submitted_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid default auth.uid()
);

comment on table campaign_live_submissions is
  'Bukti live kreator per pendaftaran campaign (Fase G.3). Entitas TERPISAH dari live_schedule_slots (booking KOL, M9/0304) — arti "live" beda (keputusan #12, #18): ini realisasi live campaign MEA GO, bukan jadwal booking.';

create index campaign_live_submissions_participant_idx on campaign_live_submissions (participant_id);

-- ---- 6. Gerbang bersama: hanya participant approved + belum lewat deadline -
create or replace function campaign_submission_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_participant_id     uuid := coalesce(new.participant_id, old.participant_id);
  v_participant_status text;
  v_deadline            timestamptz;
begin
  select p.status, d.submission_deadline
    into v_participant_status, v_deadline
  from campaign_participants p
  join brand_deals d on d.id = p.deal_id
  where p.id = v_participant_id;

  if v_participant_status is null then
    raise exception '[pendaftaran campaign tidak ditemukan]' using errcode = 'check_violation';
  end if;
  if tg_op in ('INSERT','UPDATE') and v_participant_status <> 'approved' then
    raise exception '[hanya kreator yang sudah disetujui yang dapat submit bukti]'
      using errcode = 'insufficient_privilege';
  end if;
  if v_deadline is not null and now() > v_deadline
     and not (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account'))
  then
    raise exception '[deadline submit bukti sudah lewat — bukti terkunci]' using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := now();
  return new;
end $$;

comment on function campaign_submission_guard() is
  'BEFORE INSERT/UPDATE/DELETE campaign_video_submissions & campaign_live_submissions: participant harus approved (insert/update), dan sebelum submission_deadline untuk tulis MAUPUN hapus (kecuali staff BizDev/CampaignSpecialist/Account/mgmt — override manual, keputusan #14 "terkunci otomatis" mencakup delete supaya bukti tak bisa ditarik setelah deadline).';

create trigger trg_campaign_video_submissions_guard before insert or update or delete on campaign_video_submissions
  for each row execute function campaign_submission_guard();
create trigger trg_campaign_live_submissions_guard before insert or update or delete on campaign_live_submissions
  for each row execute function campaign_submission_guard();

revoke execute on function campaign_submission_guard() from public, anon, authenticated;

-- ---- 7. Tandai duplikat post_id (video saja — live tidak punya post_id) ----
create or replace function campaign_video_submission_dedup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_existing uuid;
begin
  if new.post_id is null and new.post_url is not null then
    new.post_id := extract_tiktok_post_id(new.post_url);
  end if;

  new.is_duplicate := false;
  new.duplicate_of_id := null;
  if new.post_id is not null then
    select id into v_existing
    from campaign_video_submissions
    where post_id = new.post_id
      and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    order by submitted_at
    limit 1;
    if v_existing is not null then
      new.is_duplicate := true;
      new.duplicate_of_id := v_existing;
    end if;
  end if;
  return new;
end $$;

comment on function campaign_video_submission_dedup() is
  'BEFORE INSERT/UPDATE campaign_video_submissions: TANDAI (bukan blokir) submission dengan post_id yang sudah pernah masuk — is_duplicate/duplicate_of_id dipakai kurasi (G.4) & display, bukan hard reject (submit ganda oleh kreator sama bisa jadi typo link, biarkan staff yang putuskan).';

create trigger trg_campaign_video_submissions_dedup before insert or update on campaign_video_submissions
  for each row execute function campaign_video_submission_dedup();

revoke execute on function campaign_video_submission_dedup() from public, anon, authenticated;

-- ---- 8. Audit ----------------------------------------------------------------
create trigger trg_campaign_video_submissions_audit after insert or update on campaign_video_submissions
  for each row execute function capture_audit('campaign_video_submission');
create trigger trg_campaign_live_submissions_audit after insert or update on campaign_live_submissions
  for each row execute function capture_audit('campaign_live_submission');

-- ---- 9. RLS -------------------------------------------------------------
-- select: staff (kurasi) + kreator pemilik. manage (insert/update/delete):
-- HANYA kreator pemilik pendaftaran — staff tidak menulis bukti atas nama
-- kreator (konsisten keputusan #10: portal kreator adalah satu-satunya jalur).
alter table campaign_video_submissions enable row level security;
create policy campaign_video_submissions_select on campaign_video_submissions for select to authenticated
  using (
    is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account')
    or exists (
      select 1 from campaign_participants p
      where p.id = campaign_video_submissions.participant_id and p.mcn_creator_id = auth_creator_id()
    )
  );
create policy campaign_video_submissions_manage on campaign_video_submissions for all to authenticated
  using (exists (
    select 1 from campaign_participants p
    where p.id = campaign_video_submissions.participant_id and p.mcn_creator_id = auth_creator_id()
  ))
  with check (exists (
    select 1 from campaign_participants p
    where p.id = campaign_video_submissions.participant_id and p.mcn_creator_id = auth_creator_id()
  ));

alter table campaign_live_submissions enable row level security;
create policy campaign_live_submissions_select on campaign_live_submissions for select to authenticated
  using (
    is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account')
    or exists (
      select 1 from campaign_participants p
      where p.id = campaign_live_submissions.participant_id and p.mcn_creator_id = auth_creator_id()
    )
  );
create policy campaign_live_submissions_manage on campaign_live_submissions for all to authenticated
  using (exists (
    select 1 from campaign_participants p
    where p.id = campaign_live_submissions.participant_id and p.mcn_creator_id = auth_creator_id()
  ))
  with check (exists (
    select 1 from campaign_participants p
    where p.id = campaign_live_submissions.participant_id and p.mcn_creator_id = auth_creator_id()
  ));
