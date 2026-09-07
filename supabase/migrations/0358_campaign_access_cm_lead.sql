-- =============================================================================
-- MSDPS · Migration 0358 — Campaign MEA GO: akses SPV Creator Management
--                          + tutup bypass NULL pada gerbang wewenang campaign
-- =============================================================================
-- KOREKSI PRD (docs/HANDOFF_FaseG.md §5 keputusan #2/#3), diminta user
-- 2026-09-07. Fase G mengasumsikan "Campaign Specialist" adalah DIVISI sendiri
-- (`division` enum `CampaignSpecialist`, dibuat 0341). Kenyataan organisasi
-- berbeda dan sudah bisa dibuktikan dari data production:
--
--   select division, rank, count(*) from employees where active group by 1,2;
--   → CampaignSpecialist : 0 karyawan
--   → CreatorManagement  : 3 lead (termasuk "Rizal", SPV) + 2 staff, salah
--                          satunya bernama "Campaign Specialist 1"
--
-- Jadi enum `CampaignSpecialist` hidup di skema tapi TIDAK dipakai siapa pun,
-- dan pemilik sebenarnya alur campaign adalah **SPV Creator Management**
-- bersama **BizDev**. Akibatnya SPV CM ter-redirect keluar dari
-- /meago/campaigns dan tidak bisa membuat/mengurus campaign sama sekali.
--
-- Yang dilakukan migrasi ini:
--   1. Dua fungsi helper — `is_campaign_owner()` dan `is_campaign_staff()` —
--      sebagai SATU sumber kebenaran wewenang campaign. Sebelumnya daftar
--      divisi yang sama ditulis ulang di 20 tempat (policy + trigger + RPC);
--      itulah kenapa perubahan sekecil "tambah satu peran" menyentuh 7 tabel.
--   2. Seluruh policy/trigger/RPC campaign memakai helper itu.
--   3. `brand_deals` insert/update: SPV CM ditambahkan, TAPI dibatasi ke baris
--      campaign (`campaign_enabled`) saja — Merchant Deals biasa tetap
--      director-only sesuai 0348/PR #27. Merchant Deals TIDAK ikut terbuka.
--
-- Enum `CampaignSpecialist` SENGAJA dipertahankan di semua daftar (bukan
-- dihapus): `alter type ... drop value` tidak ada di Postgres, kolom
-- `brand_deals.operational_team` boleh menyimpannya, dan membuangnya dari
-- policy tidak menambah keamanan apa pun sementara berisiko mengunci divisi
-- itu bila nanti benar-benar diisi orang.
--
-- Cakupan peran SESUDAH migrasi ini:
--   is_campaign_owner() — buat campaign, ubah budget & stage, kelola ads spend
--     = OD · Director · BizDev · CampaignSpecialist · CreatorManagement rank
--       'lead' (SPV). CM rank 'staff' TIDAK termasuk.
--   is_campaign_staff() — lihat + kurasi + batch + ingest + validasi
--     = is_campaign_owner() + Account (AM). Batasan per-baris Account
--       (operational_owner_id) tetap seperti sebelumnya, tidak dilonggarkan.
--
-- -----------------------------------------------------------------------------
-- BUG KEAMANAN yang ikut tertutup (ditemukan saat menulis migrasi ini)
-- -----------------------------------------------------------------------------
-- Pola lama `if not (is_od() or is_director() or auth_division() in (...))`
-- BOCOR untuk sesi yang bukan karyawan — yaitu kreator Portal Kreator, yang
-- juga role `authenticated`. Untuk mereka `auth_division()` NULL, sehingga:
--
--   false or false or (NULL in ('BizDev',...))  →  NULL
--   not NULL                                    →  NULL
--   if NULL then raise ...                      →  cabang TIDAK dieksekusi
--
-- Diverifikasi langsung di production:
--   select (not (false or false or (null::division in ('BizDev','Account'))))
--          is null;  → t
--
-- Artinya gerbang wewenang berikut tidak pernah menolak kreator. Dua di
-- antaranya tetap gagal karena sebab lain — bukan karena gerbangnya bekerja:
--
--   · validate_campaign_posts() — TEREKSPLOITASI PENUH. SECURITY DEFINER +
--     `grant execute ... to authenticated` (0346:136), dan yang ditulisnya
--     (tiktok_verdict setiap submission satu campaign) tidak dijaga FK apa
--     pun. Kreator mana pun bisa menimpa verdict seluruh peserta campaign.
--   · campaign_submission_guard() — TEREKSPLOITASI PENUH. Kunci deadline
--     (keputusan #14) tidak berlaku sama sekali untuk kreator: bukti masih
--     bisa ditambah/diubah/dihapus sesudah submission_deadline.
--   · campaign_participants_curation_guard() — gerbang dilewati (kreator bisa
--     meng-approve pendaftarannya sendiri; policy update-nya memang
--     mengizinkan baris miliknya dan status_transitions 'campaign_participant'
--     tidak memasang allowed_tokens), tapi UPDATE-nya kandas di FK
--     campaign_participants_reviewed_by_fkey → employees, karena guard
--     menstempel reviewed_by = auth.uid(). Kebetulan, bukan pertahanan.
--   · close_curation_batch() — sama polanya: gerbang dilewati (kreator bisa
--     memanggil RPC pembuat payout), kandas di FK
--     campaign_curation_batches_closed_by_fkey → employees.
--
-- Keempatnya direproduksi di database hasil scripts/pg_test_reset.sh dan
-- sekarang dikunci sebagai assertion regresi di scripts/test_campaign_access.sql
-- (mengembalikan pola lama membuat assertion itu merah).
--
-- Belum ada bukti hal ini pernah terjadi (tabel campaign masih 0 baris di
-- production per 2026-09-06), jadi ini penutupan celah, bukan pembersihan
-- insiden. Helper baru mengembalikan `coalesce(..., false)` sehingga tidak
-- pernah NULL dan pola `if not (...)` kembali berperilaku benar.
-- =============================================================================

-- ---- 1. Helper wewenang campaign (satu sumber kebenaran) --------------------
-- Cermin sisi aplikasi: lib/campaign-access.ts. Kalau salah satu diubah,
-- ubah keduanya — DB tetap gerbang terakhir, TS hanya menentukan render.
create or replace function is_campaign_owner() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(
    is_od() or is_director()
    or auth_division() in ('BizDev','CampaignSpecialist')
    or (auth_division() = 'CreatorManagement' and is_lead()),
  false)
$$;

comment on function is_campaign_owner() is
  'Wewenang PENUH Campaign MEA GO (buat campaign, ubah budget & stage): OD, Director, BizDev, CampaignSpecialist, dan CreatorManagement rank lead (SPV) — koreksi PRD 0358, tidak ada karyawan berdivisi CampaignSpecialist; Campaign Specialist bekerja di bawah SPV Creator Management. CM rank staff TIDAK termasuk. Selalu boolean (coalesce false) supaya pola `if not (...)` di trigger tidak bocor untuk sesi non-karyawan.';

create or replace function is_campaign_staff() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(is_campaign_owner() or auth_division() = 'Account', false)
$$;

comment on function is_campaign_staff() is
  'Tim operasional Campaign MEA GO (lihat, kurasi pendaftar, batch, ingest export TikTok, validasi bukti): is_campaign_owner() + Account (AM). Pembatasan per-baris untuk Account (operational_owner_id) TIDAK ada di sini — itu tetap ditulis eksplisit di policy yang membutuhkannya.';

-- ---- 2. brand_deals: SPV CM boleh menulis, HANYA baris campaign ------------
-- Merchant Deals biasa (campaign_enabled=false) tetap persis seperti 0348:
-- insert BizDev/CampaignSpecialist/mgmt (+ CM untuk deal sourced_by_role='cm'),
-- update director-only. Yang bertambah hanya jalur campaign untuk SPV CM.
--
-- CATATAN: di sini SENGAJA tidak memakai is_campaign_owner() polos — helper itu
-- tidak tahu soal `campaign_enabled`, dan memakainya akan diam-diam membuka
-- Merchant Deals untuk SPV CM. Kondisi CM ditulis eksplisit.
drop policy if exists brand_deals_insert on brand_deals;
create policy brand_deals_insert on brand_deals for insert to authenticated
  with check (
    is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist')
    or (auth_division() = 'CreatorManagement' and sourced_by_role = 'cm')
    or (auth_division() = 'CreatorManagement' and is_lead() and campaign_enabled)
  );

comment on policy brand_deals_insert on brand_deals is
  'BizDev/CampaignSpecialist/mgmt bebas; CreatorManagement untuk deal yang di-sourcing CM sendiri (sourced_by_role=''cm''); SPV CreatorManagement (rank lead) untuk baris campaign (campaign_enabled) — 0358.';

drop policy if exists brand_deals_update on brand_deals;
create policy brand_deals_update on brand_deals for update to authenticated
  using (
    is_od() or is_director()
    or (campaign_enabled and auth_division() in ('BizDev','CampaignSpecialist'))
    or (campaign_enabled and auth_division() = 'CreatorManagement' and is_lead())
    or (campaign_enabled and auth_division() = 'Account' and operational_owner_id = auth_emp_id())
  );

comment on policy brand_deals_update on brand_deals is
  'Merchant Deals biasa (campaign_enabled=false): director-only (PR #27, dipertahankan 0348). Campaign (campaign_enabled=true): BizDev/CampaignSpecialist dan SPV CreatorManagement (rank lead, ditambah 0358) bebas; Account terbatas ke campaign miliknya (operational_owner_id). DELETE tidak disentuh — tetap director-only.';

-- brand_deals_select sengaja TIDAK diubah: seluruh CreatorManagement sudah
-- punya SELECT sejak 0342 §7.

-- ---- 3. Tabel campaign G.1: budget log & ads spend -------------------------
drop policy if exists campaign_budget_log_select on campaign_budget_log;
create policy campaign_budget_log_select on campaign_budget_log for select to authenticated
  using (is_campaign_staff());

drop policy if exists campaign_ads_spend_select on campaign_ads_spend;
create policy campaign_ads_spend_select on campaign_ads_spend for select to authenticated
  using (is_campaign_staff());

drop policy if exists campaign_ads_spend_manage on campaign_ads_spend;
create policy campaign_ads_spend_manage on campaign_ads_spend for all to authenticated
  using (
    is_campaign_owner()
    or (auth_division() = 'Account' and exists (
          select 1 from brand_deals d
          where d.id = campaign_ads_spend.deal_id and d.operational_owner_id = auth_emp_id()
        ))
  )
  with check (
    is_campaign_owner()
    or (auth_division() = 'Account' and exists (
          select 1 from brand_deals d
          where d.id = campaign_ads_spend.deal_id and d.operational_owner_id = auth_emp_id()
        ))
  );

-- ---- 4. G.2 pendaftaran & kurasi -------------------------------------------
drop policy if exists campaign_participants_select on campaign_participants;
create policy campaign_participants_select on campaign_participants for select to authenticated
  using (is_campaign_staff() or mcn_creator_id = auth_creator_id());

drop policy if exists campaign_participants_update on campaign_participants;
create policy campaign_participants_update on campaign_participants for update to authenticated
  using (is_campaign_staff() or mcn_creator_id = auth_creator_id());

-- campaign_participants_insert tidak disentuh: hanya kreator mendaftarkan diri
-- sendiri (keputusan #10).

create or replace function campaign_participants_curation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quota    integer;
  v_approved integer;
begin
  if new.status is distinct from old.status then
    if new.status in ('approved','rejected') then
      if not is_campaign_staff() then
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
      if not (old.mcn_creator_id = auth_creator_id() or is_campaign_staff()) then
        raise exception '[tidak berwenang membatalkan pendaftaran ini]'
          using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;
  return new;
end $$;

comment on function campaign_participants_curation_guard() is
  'BEFORE UPDATE campaign_participants: approve/reject hanya is_campaign_staff(); approve dibatasi creator_quota (keputusan #6). withdrawn boleh kreator sendiri atau staff. Menstempel reviewed_by/at pada approve/reject. 0358: daftar divisi diganti is_campaign_staff() — sekaligus menutup bypass NULL yang membuat kreator bisa meng-approve dirinya sendiri.';

revoke execute on function campaign_participants_curation_guard() from public, anon, authenticated;

-- ---- 5. G.3 bukti deliverable ----------------------------------------------
drop policy if exists campaign_video_submissions_select on campaign_video_submissions;
create policy campaign_video_submissions_select on campaign_video_submissions for select to authenticated
  using (
    is_campaign_staff()
    or exists (
      select 1 from campaign_participants p
      where p.id = campaign_video_submissions.participant_id and p.mcn_creator_id = auth_creator_id()
    )
  );

drop policy if exists campaign_live_submissions_select on campaign_live_submissions;
create policy campaign_live_submissions_select on campaign_live_submissions for select to authenticated
  using (
    is_campaign_staff()
    or exists (
      select 1 from campaign_participants p
      where p.id = campaign_live_submissions.participant_id and p.mcn_creator_id = auth_creator_id()
    )
  );

-- _manage tidak disentuh: bukti hanya ditulis kreator pemiliknya (keputusan #10).

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
  if v_deadline is not null and now() > v_deadline and not is_campaign_staff() then
    raise exception '[deadline submit bukti sudah lewat — bukti terkunci]' using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  new.updated_at := now();
  return new;
end $$;

comment on function campaign_submission_guard() is
  'BEFORE INSERT/UPDATE/DELETE campaign_video_submissions & campaign_live_submissions: participant harus approved (insert/update), dan sebelum submission_deadline untuk tulis MAUPUN hapus (kecuali is_campaign_staff() — override manual, keputusan #14 mencakup delete supaya bukti tak bisa ditarik setelah deadline). 0358: is_campaign_staff() menggantikan daftar divisi — sekaligus membuat kunci deadline benar-benar mengunci kreator (sebelumnya bypass NULL).';

revoke execute on function campaign_submission_guard() from public, anon, authenticated;

-- ---- 6. G.4 batch kurasi & payout ------------------------------------------
drop policy if exists campaign_curation_batches_select on campaign_curation_batches;
create policy campaign_curation_batches_select on campaign_curation_batches for select to authenticated
  using (is_campaign_staff() or auth_division() = 'Finance');

drop policy if exists campaign_curation_batches_insert on campaign_curation_batches;
create policy campaign_curation_batches_insert on campaign_curation_batches for insert to authenticated
  with check (is_campaign_staff());

drop policy if exists campaign_payouts_select on campaign_payouts;
create policy campaign_payouts_select on campaign_payouts for select to authenticated
  using (
    is_campaign_staff() or auth_division() = 'Finance'
    or mcn_creator_id = auth_creator_id()
  );

-- campaign_payouts_update tidak disentuh: status payout tetap wewenang
-- Finance/mgmt (cermin pyo_update 0103) — tim campaign tidak menulisnya.

-- close_curation_batch(): hanya baris otorisasi yang berubah. Sisa badan fungsi
-- disalin PERSIS dari 0345_go_campaign_payouts.sql — jangan diubah di sini,
-- ini logika uang (unit test: scripts/test_campaign_completion.mjs).
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

  if not is_campaign_staff() then
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
  'RPC tutup periode kurasi (keputusan #13). Idempoten: batch closed dipanggil ulang mengembalikan angka lama tanpa menulis apa pun. "Completed" = participant approved + punya bukti valid sesuai campaign_track + belum pernah dibayar (unique campaign_payouts.participant_id). Payout flat base_fee per kreator (keputusan #6/#8). Cermin TS: lib/campaign-completion.ts (preview UI) — WAJIB disinkronkan manual bila logika ini berubah. 0358: otorisasi memakai is_campaign_staff(); badan fungsi TIDAK berubah sedikit pun. Sebelumnya kreator Portal Kreator bisa memanggil RPC ini (grant ke authenticated) dan lolos gerbang karena bypass NULL.';

revoke execute on function close_curation_batch(uuid) from public, anon;
grant execute on function close_curation_batch(uuid) to authenticated;

-- ---- 7. G.5 ingest export TikTok & validasi bukti --------------------------
drop policy if exists tiktok_post_index_select on tiktok_post_index;
create policy tiktok_post_index_select on tiktok_post_index for select to authenticated
  using (is_campaign_staff());

drop policy if exists tiktok_post_index_upsert on tiktok_post_index;
create policy tiktok_post_index_upsert on tiktok_post_index for insert to authenticated
  with check (is_campaign_staff());

drop policy if exists tiktok_post_index_update on tiktok_post_index;
create policy tiktok_post_index_update on tiktok_post_index for update to authenticated
  using (is_campaign_staff());

-- validate_campaign_posts(): hanya baris otorisasi yang berubah. Urutan verdict
-- disalin PERSIS dari 0346_go_campaign_ingest.sql — TETAP, jangan diubah.
create or replace function validate_campaign_posts(p_deal_id uuid)
returns table(verdict text, cnt integer)
language plpgsql security definer set search_path = public as $$
declare
  v_deal brand_deals%rowtype;
  r      record;
  v_verdict text;
begin
  select * into v_deal from brand_deals where id = p_deal_id and campaign_enabled;
  if v_deal.id is null then
    raise exception '[campaign tidak ditemukan]' using errcode = 'check_violation';
  end if;
  if not is_campaign_staff() then
    raise exception '[tidak berwenang menjalankan validasi bukti]' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select s.id as submission_id, s.post_id, s.is_duplicate,
           lower(c.username) as creator_username,
           t.location_id, t.post_date, t.status as tiktok_status,
           lower(t.creator_username) as tiktok_creator_username
    from campaign_video_submissions s
    join campaign_participants p on p.id = s.participant_id
    join mcn_creators c on c.id = p.mcn_creator_id
    left join tiktok_post_index t on t.post_id = s.post_id
    where p.deal_id = p_deal_id
  loop
    if r.post_id is null or r.location_id is null then
      -- Belum ada di export TikTok manapun yang sudah di-ingest.
      v_verdict := 'tidak_ditemukan';
    elsif (v_deal.post_window_start is not null and r.post_date < v_deal.post_window_start)
       or (v_deal.post_window_end   is not null and r.post_date > v_deal.post_window_end) then
      v_verdict := 'di_luar_periode';
    elsif v_deal.target_location_id is not null and r.location_id <> v_deal.target_location_id then
      v_verdict := 'merchant_tidak_sesuai';
    elsif r.creator_username is distinct from r.tiktok_creator_username then
      v_verdict := 'bukan_milik_kreator';
    elsif r.tiktok_status = 'invalid' then
      v_verdict := 'ditolak_tiktok';
    elsif r.is_duplicate then
      v_verdict := 'duplikat';
    else
      v_verdict := 'valid';
    end if;

    update campaign_video_submissions
      set tiktok_verdict = v_verdict, tiktok_verdict_at = now()
      where id = r.submission_id;
  end loop;

  return query
    select s.tiktok_verdict, count(*)::integer
    from campaign_video_submissions s
    join campaign_participants p on p.id = s.participant_id
    where p.deal_id = p_deal_id
    group by s.tiktok_verdict;
end $$;

comment on function validate_campaign_posts(uuid) is
  'RPC "Validasi Bukti" per campaign. Urutan verdict TETAP (lihat komentar kolom tiktok_verdict). Boleh dijalankan berkali-kali (idempoten per submission — verdict lama ditimpa verdict terbaru berdasarkan tiktok_post_index saat ini). 0358: otorisasi memakai is_campaign_staff(); badan fungsi TIDAK berubah sedikit pun. Sebelumnya kreator bisa memanggil RPC ini karena bypass NULL.';

revoke execute on function validate_campaign_posts(uuid) from public, anon;
grant execute on function validate_campaign_posts(uuid) to authenticated;
