-- =============================================================================
-- Uji gerbang & wewenang Bridge MSDPS→CDPS Fase 1 (migrasi 0360)
-- =============================================================================
-- Kenapa ada: deal_bridge_lines_gate() menegakkan D4+D13 (deal free/barter DAN
-- pembayaran belum terverifikasi keduanya harus ditolak) lewat trigger, bukan
-- cuma TS. Membaca triggernya tidak membuktikan apa pun — yang membuktikan
-- adalah mencoba INSERT sebagai tiap kondisi dan melihat DB menerima/menolak.
--
-- Skrip ini juga mengunci kelas bypass NULL yang ditutup 0358: can_manage_bridge()
-- WAJIB coalesce(...,false) supaya sesi kreator (bukan karyawan) tidak lolos
-- diam-diam lewat `if not (...)`.
--
-- Cara pakai (butuh database hasil scripts/pg_test_reset.sh):
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -f scripts/test_bridge_gates.sql
--
-- Seluruh isinya berjalan dalam satu transaksi dan di-ROLLBACK di akhir.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- Supabase memberi role `authenticated` hak tabel lewat default privileges;
-- stub pg_test_reset.sh tidak, jadi tanpa baris ini SEMUA percobaan tulis gagal
-- dengan "permission denied" dan uji negatif lolos karena alasan yang salah.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
-- can_manage_bridge() revoked from public/anon (migrasi 0360) — di Supabase
-- sungguhan `authenticated` tetap dapat EXECUTE lewat default privileges;
-- stub pg_test_reset.sh tidak, jadi butuh grant eksplisit di sini juga (pola
-- test_campaign_access.sql:30 utk auth_creator_id()).
grant execute on function can_manage_bridge() to authenticated;

-- ---- Fixture: satu akun per peran ------------------------------------------
create temporary table t_actor (label text primary key, uid uuid) on commit drop;

insert into t_actor (label, uid) values
  ('bd',       '11111111-1111-4111-8111-111111111111'),
  ('cm_staff', '22222222-2222-4222-8222-222222222222'),
  ('account',  '33333333-3333-4333-8333-333333333333'),
  ('director', '44444444-4444-4444-8444-444444444444'),
  ('kreator',  '55555555-5555-4555-8555-555555555555');

insert into auth.users (id, email)
  select uid, label || '@uji.local' from t_actor;

insert into employees (id, full_name, division, rank, is_director) values
  ('11111111-1111-4111-8111-111111111111','BD uji',       'BizDev',           'staff', false),
  ('22222222-2222-4222-8222-222222222222','CM Staff uji', 'CreatorManagement','staff', false),
  ('33333333-3333-4333-8333-333333333333','Account uji',  'Account',          'staff', false),
  ('44444444-4444-4444-8444-444444444444','Director uji', 'Account',          'lead',  true);

-- Sesi kreator Portal: role `authenticated` yang sama, TAPI tidak ada di
-- employees — kelas sesi yang membocorkan gerbang sebelum coalesce (0358).
insert into mcn_creators (id, name, auth_user_id)
  values ('66666666-6666-4666-8666-666666666666','Kreator uji',
          '55555555-5555-4555-8555-555555555555');

-- ---- Fixture: merchant + transaksi (verified / unverified) -----------------
insert into merchants (id, nama_toko, kota, link_toko, kategori, gmv_baseline, target_gmv, payment_intent)
  values ('77777777-7777-4777-8777-777777777777','UJI Merchant Bridge','Bandung','-','Dining',0,0,'Lunas');

insert into transactions (id, merchant_id, payment_intent, total_agreed_value, released_to_account_at)
  values ('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777',
          'Lunas', 15000000, now());

insert into transactions (id, merchant_id, payment_intent, total_agreed_value, released_to_account_at)
  values ('99999999-9999-4999-8999-999999999999','77777777-7777-4777-8777-777777777777',
          'Lunas', 15000000, null);

-- ---- Fixture: lima deal, satu per kondisi gerbang ---------------------------
-- kategori_poi SENGAJA NULL di sini — memicu blok validasi POI penuh
-- (pic_name/benefit/visit/dst) tidak relevan untuk MENGUJI deal_bridge_lines_gate,
-- yang hanya membaca bentuk_kerjasama/transaction_id/transactions.released_to_account_at.
-- Kelengkapan payload (kategori_poi dst) sudah diuji terpisah di
-- scripts/qc_bridge_payload.mjs (B2).
insert into brand_deals (id, brand_name, bentuk_kerjasama, transaction_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','UJI Berbayar+Terverifikasi','Berbayar','88888888-8888-4888-8888-888888888888'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','UJI Berbayar+BelumTerverifikasi','Berbayar','99999999-9999-4999-8999-999999999999'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','UJI Berbayar+TanpaTransaksi','Berbayar', null),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','UJI FreeBarter','Free/Barter', null),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','UJI BentukNull', null, null);

-- ---- Mesin assertion (pola scripts/test_campaign_access.sql) ---------------
create temporary table t_result (ok boolean, label text) on commit drop;

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
      v_detail := '0 baris terpengaruh — ditolak diam-diam oleh RLS/tanpa policy';
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

create function pg_temp.can_manage(p_actor text) returns boolean language plpgsql as $fn$
declare v_uid uuid; v_val boolean;
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  set local role authenticated;
  select can_manage_bridge() into v_val;
  reset role;
  return v_val;
end $fn$;

-- ---- 1. can_manage_bridge() tidak pernah NULL (inti perbaikan bypass 0358) --
insert into t_result (ok, label) select pg_temp.can_manage('kreator') = false, 'kreator · can_manage_bridge() = false (bukan NULL)';
insert into t_result (ok, label) select pg_temp.can_manage('bd'),       'bd · can_manage_bridge()';
insert into t_result (ok, label) select pg_temp.can_manage('cm_staff'), 'cm_staff · can_manage_bridge()';
insert into t_result (ok, label) select pg_temp.can_manage('director'), 'director · can_manage_bridge()';
insert into t_result (ok, label) select not pg_temp.can_manage('account'), 'account · BUKAN can_manage_bridge()';

-- ---- 2. Gerbang pembayaran (D4+D13) — deal_bridge_lines_gate() -------------
select pg_temp.expect('bd', true, 'INSERT Berbayar+terverifikasi diterima',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Account')$$);

select pg_temp.expect('bd', false, 'INSERT Berbayar+BELUM terverifikasi DITOLAK',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Account')$$);

select pg_temp.expect('bd', false, 'INSERT Berbayar TANPA transaksi DITOLAK',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Account')$$);

select pg_temp.expect('bd', false, 'INSERT deal Free/Barter DITOLAK',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Account')$$);

select pg_temp.expect('bd', false, 'INSERT deal bentuk_kerjasama NULL DITOLAK (IS DISTINCT FROM, bukan <>)',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Account')$$);

-- ---- 3. jenis: closed set + KOL-Non-Roster wajib alasan --------------------
select pg_temp.expect('bd', false, '''Live Stream'' BUKAN jenis sah DITOLAK',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Live Stream')$$);

select pg_temp.expect('bd', false, 'KOL-Non-Roster TANPA alasan_non_roster DITOLAK',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','KOL-Non-Roster')$$);

select pg_temp.expect('bd', true, 'KOL-Non-Roster DENGAN alasan_non_roster diterima',
  $$insert into deal_bridge_lines (deal_id, jenis, alasan_non_roster) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','KOL-Non-Roster','creator lokal di luar roster MCN MEA')$$);

-- ---- 4. RLS per peran: siapa boleh INSERT/SELECT deal_bridge_lines ---------
select pg_temp.expect('cm_staff', true, 'INSERT diterima (CreatorManagement termasuk can_manage_bridge)',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ads')$$);

select pg_temp.expect('director', true, 'INSERT diterima (Director)',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Creative')$$);

select pg_temp.expect('account', false, 'INSERT DITOLAK (Account bukan can_manage_bridge, walau boleh SELECT)',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ads')$$);

select pg_temp.expect('account', true, 'SELECT diterima (Account termasuk audiens baca)',
  $$select 1 from deal_bridge_lines where deal_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$);

select pg_temp.expect('kreator', false, 'INSERT DITOLAK (sesi kreator, regresi kelas bypass NULL 0358)',
  $$insert into deal_bridge_lines (deal_id, jenis) values
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Ads')$$);

-- ---- 5. Immutabilitas: baris ber-ord_code tidak bisa diubah ----------------
select pg_temp.expect('director', true, 'set ord_code (simulasi delivery job via service-role — di sini lewat authenticated utk uji trigger saja)',
  $$update deal_bridge_lines set ord_code = 'ORD-202609-0001'
    where deal_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and jenis = 'Account'$$, true);

select pg_temp.expect('director', false, 'UPDATE baris ber-ord_code DITOLAK (immutable setelah terkirim)',
  $$update deal_bridge_lines set catatan = 'ubah setelah kirim'
    where deal_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and jenis = 'Account'$$, true);

-- ---- 6. cdps_outbox: insert oleh can_manage_bridge, TANPA update/delete ----
select pg_temp.expect('bd', true, 'INSERT cdps_outbox diterima',
  $$insert into cdps_outbox (deal_id, payload, idempotency_key)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"deal_code":"UJI"}'::jsonb, 'UJI-DEAL:1')$$);

select pg_temp.expect('bd', false, 'INSERT KEDUA untuk deal yang sama DITOLAK (cdps_outbox_deal_id_uniq)',
  $$insert into cdps_outbox (deal_id, payload, idempotency_key)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"deal_code":"UJI"}'::jsonb, 'UJI-DEAL:1-lagi')$$);

select pg_temp.expect('director', false, 'UPDATE cdps_outbox DITOLAK (nol policy UPDATE utk authenticated)',
  $$update cdps_outbox set status = 'sent' where deal_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$, true);

select pg_temp.expect('account', false, 'INSERT cdps_outbox DITOLAK (Account bukan can_manage_bridge)',
  $$insert into cdps_outbox (deal_id, payload, idempotency_key)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}'::jsonb, 'UJI-DEAL-2:1')$$);

-- ---- 7. platform_alerts: alert_type kelima (dead-letter) -------------------
select pg_temp.expect('director', true, 'INSERT platform_alerts alert_type=cdps_bridge_dead diterima',
  $$insert into platform_alerts (alert_type, detail) values ('cdps_bridge_dead', '{"uji":true}'::jsonb)$$);

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
