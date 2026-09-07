-- =============================================================================
-- Uji matriks wewenang Campaign MEA GO (migrasi 0358)
-- =============================================================================
-- Kenapa ada: perubahan peran campaign menyentuh 7 tabel + 4 fungsi. Membaca
-- policy satu per satu tidak membuktikan apa pun — yang membuktikan adalah
-- mencoba menulis sebagai tiap peran dan melihat DB menerima/menolak.
--
-- Skrip ini juga mengunci REGRESI bypass NULL yang ditutup 0358: pola lama
-- `if not (is_od() or ... auth_division() in (...))` mengembalikan NULL untuk
-- sesi kreator (bukan karyawan), sehingga cabang penolakan tidak pernah jalan.
--
-- Cara pakai (butuh database hasil scripts/pg_test_reset.sh):
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -f scripts/test_campaign_access.sql
--
-- Seluruh isinya berjalan dalam satu transaksi dan di-ROLLBACK di akhir —
-- database uji tidak berubah, aman dijalankan berulang.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- Supabase memberi role `authenticated` hak tabel lewat default privileges;
-- stub pg_test_reset.sh tidak, jadi tanpa baris ini SEMUA percobaan tulis gagal
-- dengan "permission denied" dan uji negatif lolos karena alasan yang salah.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- Idem untuk fungsi helper yang di-revoke dari PUBLIC (0311:48) tapi tetap
-- dipegang `authenticated` di Supabase lewat default privileges.
grant execute on function auth_creator_id() to authenticated;

-- ---- Fixture: satu akun per peran ------------------------------------------
create temporary table t_actor (label text primary key, uid uuid) on commit drop;

insert into t_actor (label, uid) values
  ('spv_cm',     '11111111-1111-4111-8111-111111111111'),
  ('staff_cm',   '22222222-2222-4222-8222-222222222222'),
  ('staff_bd',   '33333333-3333-4333-8333-333333333333'),
  ('am_account', '44444444-4444-4444-8444-444444444444'),
  ('director',   '55555555-5555-4555-8555-555555555555'),
  ('kreator',    '66666666-6666-4666-8666-666666666666');

insert into auth.users (id, email)
  select uid, label || '@uji.local' from t_actor;

insert into employees (id, full_name, division, rank, is_director) values
  ('11111111-1111-4111-8111-111111111111','SPV CM uji',  'CreatorManagement','lead',  false),
  ('22222222-2222-4222-8222-222222222222','Staff CM uji','CreatorManagement','staff', false),
  ('33333333-3333-4333-8333-333333333333','BizDev uji',  'BizDev',           'staff', false),
  ('44444444-4444-4444-8444-444444444444','AM uji',      'Account',          'staff', false),
  ('55555555-5555-4555-8555-555555555555','Director uji','Account',          'lead',  true);

-- Kreator Portal Kreator: role `authenticated` yang sama, TAPI tidak ada di
-- employees — inilah sesi yang membocorkan gerbang wewenang sebelum 0358.
insert into mcn_creators (id, name, auth_user_id)
  values ('77777777-7777-4777-8777-777777777777','Kreator uji',
          '66666666-6666-4666-8666-666666666666');

-- Dua baris pembanding: satu campaign, satu Merchant Deals biasa.
insert into brand_deals (id, brand_name, campaign_enabled, base_fee, campaign_stage,
                         campaign_track, creator_quota) values
  ('88888888-8888-4888-8888-888888888888','UJI campaign',      true,  100000, 'active', 'video', 5),
  ('99999999-9999-4999-8999-999999999999','UJI merchant deal', false, null,   'draft',  null,    null);

-- Campaign kedua: deadline sudah LEWAT, dipakai uji kunci bukti (keputusan #14).
insert into brand_deals (id, brand_name, campaign_enabled, base_fee, campaign_stage,
                         campaign_track, creator_quota, submission_deadline)
  values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','UJI deadline lewat', true, 100000,
          'active', 'video', 5, now() - interval '1 day');

-- Pendaftaran kreator: satu di campaign biasa (uji approve/withdraw), satu di
-- campaign yang deadline-nya sudah lewat (uji kunci bukti).
insert into campaign_participants (id, deal_id, mcn_creator_id) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','88888888-8888-4888-8888-888888888888',
   '77777777-7777-4777-8777-777777777777'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
   '77777777-7777-4777-8777-777777777777');

insert into campaign_curation_batches (id, deal_id, period_start, period_end)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '88888888-8888-4888-8888-888888888888', date '2026-09-01', date '2026-09-30');

-- ---- Mesin assertion --------------------------------------------------------
create temporary table t_result (ok boolean, label text) on commit drop;

-- Jalankan `p_sql` sebagai `p_actor` di bawah role `authenticated` (RLS aktif;
-- sebagai postgres/superuser RLS dilewati dan uji ini jadi tidak berarti).
-- p_expect true = harus berhasil, false = harus ditolak.
--
-- p_need_rows untuk UPDATE: RLS menolak UPDATE dengan diam — 0 baris, tanpa
-- error. Tanpa cek ROW_COUNT, "tidak boleh menyentuh baris ini" akan terbaca
-- sebagai sukses dan uji jadi tidak berarti.
create function pg_temp.expect(p_actor text, p_expect boolean, p_label text, p_sql text,
                               p_need_rows boolean default false)
returns void language plpgsql as $fn$
declare
  v_uid    uuid;
  v_ok     boolean;
  v_rows   bigint := 0;
  v_detail text := '';
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  set local role authenticated;
  begin
    execute p_sql;
    get diagnostics v_rows = ROW_COUNT;
    if p_need_rows and v_rows = 0 then
      v_ok := false;
      v_detail := '0 baris terpengaruh — ditolak diam-diam oleh RLS';
    else
      v_ok := true;
    end if;
  exception when others then
    v_ok := false;
    v_detail := sqlerrm;
  end;
  reset role;
  insert into t_result (ok, label)
    values (v_ok = p_expect,
            p_actor || ' · ' || p_label ||
            case when v_ok = p_expect then '' else '  → ' || coalesce(nullif(v_detail,''),'(diterima, seharusnya ditolak)') end);
end $fn$;

-- Nilai helper wewenang untuk satu aktor (dibaca sebagai aktor itu sendiri).
create function pg_temp.owner_of(p_actor text) returns boolean language plpgsql as $fn$
declare v_uid uuid; v_val boolean;
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  set local role authenticated;
  select is_campaign_owner() into v_val;
  reset role;
  return v_val;
end $fn$;

create function pg_temp.staff_of(p_actor text) returns boolean language plpgsql as $fn$
declare v_uid uuid; v_val boolean;
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  set local role authenticated;
  select is_campaign_staff() into v_val;
  reset role;
  return v_val;
end $fn$;

-- ---- 1. Helper tidak pernah NULL (inti perbaikan bypass) -------------------
insert into t_result (ok, label)
select pg_temp.owner_of('kreator') = false,
       'kreator · is_campaign_owner() = false (bukan NULL)';
insert into t_result (ok, label)
select pg_temp.staff_of('kreator') = false,
       'kreator · is_campaign_staff() = false (bukan NULL)';

insert into t_result (ok, label) select pg_temp.owner_of('spv_cm'),     'spv_cm · is_campaign_owner()';
insert into t_result (ok, label) select pg_temp.owner_of('staff_bd'),   'staff_bd · is_campaign_owner()';
insert into t_result (ok, label) select pg_temp.owner_of('director'),   'director · is_campaign_owner()';
insert into t_result (ok, label) select not pg_temp.owner_of('staff_cm'),   'staff_cm · BUKAN is_campaign_owner()';
insert into t_result (ok, label) select not pg_temp.owner_of('am_account'), 'am_account · BUKAN is_campaign_owner()';
insert into t_result (ok, label) select pg_temp.staff_of('am_account'), 'am_account · is_campaign_staff()';
insert into t_result (ok, label) select not pg_temp.staff_of('staff_cm'),   'staff_cm · BUKAN is_campaign_staff()';

-- ---- 2. brand_deals: SPV CM boleh campaign, TIDAK boleh Merchant Deals -----
select pg_temp.expect('spv_cm', true, 'INSERT campaign',
  $$insert into brand_deals (brand_name, campaign_enabled) values ('UJI oleh SPV CM', true)$$);

select pg_temp.expect('spv_cm', false, 'INSERT Merchant Deals biasa DITOLAK',
  $$insert into brand_deals (brand_name, campaign_enabled) values ('UJI merchant oleh SPV CM', false)$$);

select pg_temp.expect('staff_cm', false, 'INSERT campaign DITOLAK',
  $$insert into brand_deals (brand_name, campaign_enabled) values ('UJI oleh staff CM', true)$$);

select pg_temp.expect('spv_cm', true, 'UPDATE budget campaign',
  $$update brand_deals set creator_budget = 500000 where id = '88888888-8888-4888-8888-888888888888'$$,
  true);

select pg_temp.expect('spv_cm', false, 'UPDATE Merchant Deals biasa DITOLAK',
  $$update brand_deals set nominal_harga = 1 where id = '99999999-9999-4999-8999-999999999999'$$,
  true);

select pg_temp.expect('staff_cm', false, 'UPDATE campaign DITOLAK',
  $$update brand_deals set creator_budget = 1 where id = '88888888-8888-4888-8888-888888888888'$$,
  true);

-- ---- 3. Tabel campaign hilir: SPV CM masuk, staff CM tidak -----------------
select pg_temp.expect('spv_cm', true, 'INSERT campaign_ads_spend',
  $$insert into campaign_ads_spend (deal_id, spend_date, amount)
    values ('88888888-8888-4888-8888-888888888888', current_date, 1000)$$);

select pg_temp.expect('staff_cm', false, 'INSERT campaign_ads_spend DITOLAK',
  $$insert into campaign_ads_spend (deal_id, spend_date, amount)
    values ('88888888-8888-4888-8888-888888888888', current_date, 1000)$$);

select pg_temp.expect('spv_cm', true, 'INSERT tiktok_post_index (ingest)',
  $$insert into tiktok_post_index (post_id, location_id, post_date, creator_username)
    values ('uji-post-1', '123', current_date, 'kreatoruji')$$);

select pg_temp.expect('staff_cm', false, 'INSERT tiktok_post_index DITOLAK',
  $$insert into tiktok_post_index (post_id, location_id, post_date, creator_username)
    values ('uji-post-2', '123', current_date, 'kreatoruji')$$);

select pg_temp.expect('spv_cm', true, 'INSERT campaign_curation_batches',
  $$insert into campaign_curation_batches (deal_id, period_start, period_end)
    values ('88888888-8888-4888-8888-888888888888', date '2026-10-01', date '2026-10-31')$$);

select pg_temp.expect('staff_cm', false, 'INSERT campaign_curation_batches DITOLAK',
  $$insert into campaign_curation_batches (deal_id, period_start, period_end)
    values ('88888888-8888-4888-8888-888888888888', date '2026-11-01', date '2026-11-30')$$);

-- ---- 4. Regresi bypass NULL: kreator ditolak RPC uang & validasi -----------
-- Kurasi: kreator boleh UPDATE barisnya sendiri (untuk withdraw), jadi satu-
-- satunya yang menahan "approve diri sendiri" adalah
-- campaign_participants_curation_guard(). Sebelum 0358 gerbang itu tidak
-- pernah jalan untuk kreator.
select pg_temp.expect('kreator', false, 'approve pendaftaran SENDIRI DITOLAK (regresi 0358)',
  $$update campaign_participants set status = 'approved'
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, true);

select pg_temp.expect('kreator', true, 'withdraw pendaftaran sendiri tetap boleh',
  $$update campaign_participants set status = 'withdrawn'
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, true);

select pg_temp.expect('spv_cm', true, 'approve pendaftar',
  $$update campaign_participants set status = 'approved'
    where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$, true);

-- Keputusan #14: bukti terkunci otomatis sesudah submission_deadline. Sebelum
-- 0358 kunci ini tidak berlaku untuk kreator sama sekali (bypass NULL, dan di
-- jalur ini tidak ada FK yang kebetulan menahannya).
select pg_temp.expect('kreator', false, 'submit bukti SESUDAH deadline DITOLAK (regresi 0358)',
  $$insert into campaign_video_submissions (participant_id, post_url)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'https://www.tiktok.com/@kuji/video/7300000000000000000')$$);

select pg_temp.expect('kreator', false, 'close_curation_batch() DITOLAK (regresi 0358)',
  $$select close_curation_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$);

select pg_temp.expect('kreator', false, 'validate_campaign_posts() DITOLAK (regresi 0358)',
  $$select validate_campaign_posts('88888888-8888-4888-8888-888888888888')$$);

select pg_temp.expect('spv_cm', true, 'close_curation_batch() diterima',
  $$select close_curation_batch('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$);

select pg_temp.expect('spv_cm', true, 'validate_campaign_posts() diterima',
  $$select validate_campaign_posts('88888888-8888-4888-8888-888888888888')$$);

-- ---- Laporan ----------------------------------------------------------------
select case when ok then '  ok  ' else ' GAGAL' end as hasil, label from t_result order by ctid;

do $$
declare v_fail integer; v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_result;
  if v_fail > 0 then
    raise exception '% dari % assertion GAGAL', v_fail, v_total;
  end if;
  raise notice '% assertion lolos, 0 gagal.', v_total;
end $$;

rollback;
