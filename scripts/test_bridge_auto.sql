-- =============================================================================
-- Uji Bridge MSDPS→CDPS OTOMATIS (migrasi 0377)
-- =============================================================================
-- Membuktikan di DB sungguhan:
--   1. deal_cdps_plans: bentuk (tidak_perlu ⇔ lines kosong), deal Free/Barter
--      hanya boleh "Tidak perlu CDPS", RLS = can_manage_bridge().
--   2. enqueue_bridge_order(): service-role only; SEBELUM pembayaran
--      terverifikasi ditolak gerbang 0360 dan tidak meninggalkan baris apa pun
--      (atomik); SESUDAH terverifikasi (DP pun cukup — released_to_account_at
--      terisi) membuat deal_bridge_lines + cdps_outbox sekaligus, created_by =
--      pembuat rencana; panggilan kedua mundur dengan tenang (false).
--   3. Rencana terkunci begitu diantre; last_error tetap boleh ditulis.
--   4. create_poi_finance(): CreatorManagement kini lolos gerbang akses
--      (transaksi Finance dibuat otomatis saat deal didaftarkan).
--   5. platform_alerts menerima alert_type 'cdps_bridge_incomplete'.
--
-- Cara pakai:
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -f scripts/test_bridge_auto.sql
-- Seluruh isinya satu transaksi, di-ROLLBACK di akhir.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- Di Supabase sungguhan service_role ber-BYPASSRLS; stub pg_test_reset.sh tidak.
alter role service_role bypassrls;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
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

-- ---- Mesin assertion -------------------------------------------------------
create temporary table t_result (ok boolean, label text) on commit drop;

-- p_role: 'authenticated' (sesi karyawan, JWT sub = aktor) atau 'service_role'.
create function pg_temp.expect(p_actor text, p_expect boolean, p_label text, p_sql text,
                               p_role text default 'authenticated', p_need_rows boolean default false)
returns void language plpgsql as $fn$
declare
  v_uid    uuid;
  v_ok     boolean;
  v_rows   bigint := 0;
  v_detail text := '';
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', coalesce(v_uid::text, ''), true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    get diagnostics v_rows = ROW_COUNT;
    if p_need_rows and v_rows = 0 then
      v_ok := false;
      v_detail := '0 baris terpengaruh';
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

-- Pesan error yang dilempar sebuah statement (NULL bila sukses).
create function pg_temp.err_of(p_actor text, p_sql text) returns text language plpgsql as $fn$
declare v_uid uuid; v_err text;
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  set local role authenticated;
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
  end;
  reset role;
  return v_err;
end $fn$;

-- ---- 1. deal_cdps_plans: bentuk + Free/Barter + RLS -------------------------
select pg_temp.expect('bd', true, 'rencana layanan untuk deal Berbayar BELUM terverifikasi DITERIMA (draf boleh sebelum bayar)',
  $$insert into deal_cdps_plans (deal_id, lines) values
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
     '[{"jenis":"Account","qty":1,"catatan":"paket 3 bulan"},{"jenis":"Live Stream","qty":2,"nilai_cross_charge":"500000"}]'::jsonb)$$);

select pg_temp.expect('bd', false, 'rencana dengan lines KOSONG & tidak_perlu=false DITOLAK',
  $$insert into deal_cdps_plans (deal_id, lines) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '[]'::jsonb)$$);

select pg_temp.expect('bd', false, 'tidak_perlu=true TAPI ada lines DITOLAK',
  $$insert into deal_cdps_plans (deal_id, tidak_perlu, lines) values
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true, '[{"jenis":"Ads"}]'::jsonb)$$);

select pg_temp.expect('cm_staff', true, '"Tidak perlu CDPS" untuk deal Berbayar DITERIMA (CM termasuk can_manage_bridge)',
  $$insert into deal_cdps_plans (deal_id, tidak_perlu) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', true)$$);

select pg_temp.expect('bd', false, 'layanan CDPS untuk deal Free/Barter DITOLAK',
  $$insert into deal_cdps_plans (deal_id, lines) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '[{"jenis":"Ads"}]'::jsonb)$$);

select pg_temp.expect('bd', false, 'layanan CDPS untuk deal bentuk_kerjasama NULL DITOLAK (IS DISTINCT FROM)',
  $$insert into deal_cdps_plans (deal_id, lines) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '[{"jenis":"Ads"}]'::jsonb)$$);

select pg_temp.expect('account', false, 'INSERT rencana DITOLAK (Account bukan can_manage_bridge)',
  $$insert into deal_cdps_plans (deal_id, lines) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"jenis":"Ads"}]'::jsonb)$$);

select pg_temp.expect('kreator', false, 'INSERT rencana DITOLAK (sesi kreator)',
  $$insert into deal_cdps_plans (deal_id, lines) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '[{"jenis":"Ads"}]'::jsonb)$$);

select pg_temp.expect('account', true, 'SELECT rencana diterima (Account audiens baca)',
  $$select 1 from deal_cdps_plans$$);

select pg_temp.expect('bd', true, 'BD boleh mengubah rencana selama belum diantre',
  $$update deal_cdps_plans set lines = '[{"jenis":"Account","qty":1,"catatan":"paket 3 bulan"},{"jenis":"Live Stream","qty":2,"nilai_cross_charge":"500000"}]'::jsonb
    where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'authenticated', true);

-- ---- 2. enqueue_bridge_order(): wewenang + gerbang pembayaran + atomik -------
select pg_temp.expect('bd', false, 'enqueue_bridge_order() DITOLAK untuk sesi authenticated (service-role only)',
  $$select enqueue_bridge_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"deal_code":"UJI"}'::jsonb, 'UJI-B:1')$$);

select pg_temp.expect('bd', false, 'enqueue SEBELUM pembayaran terverifikasi DITOLAK (gerbang 0360 tetap berlaku)',
  $$select enqueue_bridge_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"deal_code":"UJI"}'::jsonb, 'UJI-B:1')$$,
  'service_role');

insert into t_result (ok, label)
  select count(*) = 0, 'atomik: enqueue yang ditolak tidak meninggalkan deal_bridge_lines/cdps_outbox'
  from (select id from deal_bridge_lines where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        union all select id from cdps_outbox where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') x;

select pg_temp.expect('bd', false, 'enqueue deal "Tidak perlu CDPS" DITOLAK',
  $$select enqueue_bridge_order('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '{}'::jsonb, 'UJI-C:1')$$, 'service_role');

-- Finance memverifikasi DP 30% (verify_payment mengisi released_to_account_at
-- pada pembayaran terverifikasi pertama — DP pun cukup).
update transactions set amount_verified = 4500000, status = '[Terverifikasi - Sebagian]',
                        released_to_account_at = now()
 where id = '99999999-9999-4999-8999-999999999999';

select pg_temp.expect('bd', true, 'enqueue SESUDAH DP terverifikasi DITERIMA',
  $$select enqueue_bridge_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{"deal_code":"UJI-B"}'::jsonb, 'UJI-B:1')$$,
  'service_role');

insert into t_result (ok, label)
  select count(*) = 2 and bool_and(created_by = '11111111-1111-4111-8111-111111111111'),
         'deal_bridge_lines tersalin 2 baris dari rencana, created_by = BD pembuat rencana'
  from deal_bridge_lines where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

insert into t_result (ok, label)
  select count(*) = 1 and bool_and(qty = 2 and nilai_cross_charge = 500000),
         'baris Live Stream: qty & nilai_cross_charge tersalin sebagai angka'
  from deal_bridge_lines where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and jenis = 'Live Stream';

insert into t_result (ok, label)
  select count(*) = 1 and bool_and(status = 'pending' and created_by = '11111111-1111-4111-8111-111111111111'
                                   and idempotency_key = 'UJI-B:1'),
         'cdps_outbox: satu baris pending, created_by = BD'
  from cdps_outbox where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

create temporary table t_second (v boolean) on commit drop;
grant insert, select on t_second to service_role;
select pg_temp.expect('bd', true, 'enqueue KEDUA tidak error',
  $$insert into t_second select enqueue_bridge_order('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}'::jsonb, 'UJI-B:1')$$,
  'service_role');
insert into t_result (ok, label)
  select (select v from t_second) = false
         and (select count(*) from deal_bridge_lines where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 2,
         'enqueue KEDUA mengembalikan false & tidak menggandakan baris (idempoten)';

-- ---- 3. Rencana terkunci sesudah diantre ------------------------------------
select pg_temp.expect('bd', false, 'ubah rencana SESUDAH diantre DITOLAK',
  $$update deal_cdps_plans set lines = '[{"jenis":"Ads"}]'::jsonb
    where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'authenticated', true);

select pg_temp.expect('bd', false, 'ganti ke "Tidak perlu CDPS" SESUDAH diantre DITOLAK',
  $$update deal_cdps_plans set tidak_perlu = true, lines = '[]'::jsonb
    where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'authenticated', true);

select pg_temp.expect('bd', true, 'last_error tetap boleh ditulis sesudah diantre (service-role sweep)',
  $$update deal_cdps_plans set last_error = 'uji' where deal_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$,
  'service_role', true);

-- ---- 4. create_poi_finance(): CM lolos gerbang akses -------------------------
-- Deal cccc tanpa kategori_poi: pemanggil yang LOLOS gerbang akses berhenti di
-- '[deal ini bukan deal POI]'; yang tidak lolos berhenti di '[akses ditolak]'.
insert into t_result (ok, label)
  select pg_temp.err_of('cm_staff', $$select create_poi_finance('cccccccc-cccc-4ccc-8ccc-cccccccccccc')$$)
         like '%bukan deal POI%',
         'cm_staff · create_poi_finance() lolos gerbang akses (dulu [akses ditolak])';
insert into t_result (ok, label)
  select pg_temp.err_of('bd', $$select create_poi_finance('cccccccc-cccc-4ccc-8ccc-cccccccccccc')$$)
         like '%bukan deal POI%',
         'bd · create_poi_finance() tetap lolos gerbang akses';
insert into t_result (ok, label)
  select pg_temp.err_of('account', $$select create_poi_finance('cccccccc-cccc-4ccc-8ccc-cccccccccccc')$$)
         like '%akses ditolak%',
         'account · create_poi_finance() tetap [akses ditolak]';
insert into t_result (ok, label)
  select pg_temp.err_of('kreator', $$select create_poi_finance('cccccccc-cccc-4ccc-8ccc-cccccccccccc')$$)
         like '%akses ditolak%',
         'kreator · create_poi_finance() [akses ditolak] (bukan NULL-bypass)';

-- ---- 5. platform_alerts: alert_type keenam ----------------------------------
select pg_temp.expect('director', true, 'INSERT platform_alerts alert_type=cdps_bridge_incomplete diterima',
  $$insert into platform_alerts (alert_type, detail) values ('cdps_bridge_incomplete', '{"uji":true}'::jsonb)$$);

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
