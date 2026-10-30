-- =============================================================================
-- Uji log pemakaian per karyawan (migrasi 0376)
-- =============================================================================
-- Yang dikunci di sini:
--   (a) usage_page_views append-only: UPDATE/DELETE ditolak — baik lewat hak
--       tabel (authenticated) maupun trigger (pemilik tabel); jalur hapus hanya
--       usage_purge_expired();
--   (b) insert dengan employee_id orang lain / karyawan nonaktif / bukan
--       karyawan ditolak; authenticated tidak bisa SELECT baris mentah;
--   (c) sessionization: jeda 10 menit = sesi sama, 45 menit = sesi baru;
--   (d) lead hanya divisinya, OD/Director semua divisi, staff ditolak;
--   (e) >1000 baris tetap teragregasi lengkap (tidak terpotong).
--
-- Cara pakai — lokal (butuh database hasil scripts/pg_test_reset.sh):
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -v ON_ERROR_STOP=1 \
--     -f scripts/test_usage_page_views.sql
-- Staging: jalankan isi file apa adanya (tanpa meta-command psql) lewat SQL
-- Editor / MCP execute_sql pada vgjzvdpxrdoefoncuazw. JANGAN di production.
--
-- Data uji memakai rentang 2020 supaya tidak bercampur dengan data nyata, dan
-- seluruh isinya di-ROLLBACK di akhir — aman dijalankan berulang.
-- =============================================================================
begin;

-- Hak yang di Supabase datang dari default privileges. SENGAJA tidak ada grant
-- atas usage_page_views: yang diuji justru hak yang ditinggalkan migrasi 0376.
grant usage on schema public to authenticated;
grant select on employees to authenticated;
grant execute on function is_employee() to authenticated;   -- policy SELECT employees

-- ---- Fixture ----------------------------------------------------------------
create temporary table t_actor (label text primary key, uid uuid) on commit drop;
insert into t_actor (label, uid) values
  ('od',        'b0000000-0000-4000-8000-000000000001'),
  ('director',  'b0000000-0000-4000-8000-000000000002'),
  ('lead_cm',   'b0000000-0000-4000-8000-000000000003'),
  ('staff_cm',  'b0000000-0000-4000-8000-000000000004'),
  ('staff_bd',  'b0000000-0000-4000-8000-000000000005'),
  ('nonaktif',  'b0000000-0000-4000-8000-000000000006'),
  ('kreator',   'b0000000-0000-4000-8000-000000000007');

insert into auth.users (id, email) select uid, label || '@uji-usage.local' from t_actor;

insert into employees (id, full_name, division, rank, is_od, is_director, active) values
  ('b0000000-0000-4000-8000-000000000001','Uji OD',       'Marketing',        'staff',true, false,true),
  ('b0000000-0000-4000-8000-000000000002','Uji Director', 'Account',          'lead', false,true, true),
  ('b0000000-0000-4000-8000-000000000003','Uji Lead CM',  'CreatorManagement','lead', false,false,true),
  ('b0000000-0000-4000-8000-000000000004','Uji Staff CM', 'CreatorManagement','staff',false,false,true),
  ('b0000000-0000-4000-8000-000000000005','Uji Staff BD', 'BizDev',           'staff',false,false,true),
  ('b0000000-0000-4000-8000-000000000006','Uji Nonaktif', 'BizDev',           'staff',false,false,false);
-- 'kreator' sengaja tidak punya baris employees.

-- ---- Mesin assertion (pola scripts/test_employee_onboarding.sql) -------------
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
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
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

create function pg_temp.expect_bool(p_label text, p_actual boolean, p_expected boolean)
returns void language sql as $fn$
  insert into t_result (ok, label)
  values (p_actual is not distinct from p_expected,
          p_label || case when p_actual is not distinct from p_expected then ''
                          else '  → dapat ' || coalesce(p_actual::text,'NULL') end)
$fn$;

-- Hasil usage_summary sebagai aktor tertentu (Maret 2020, per bulan).
create temporary table t_sum (
  actor text, period_start date, employee_id uuid, full_name text, division text,
  hours numeric, sessions integer, page_views integer, last_active timestamptz
) on commit drop;
grant insert on t_sum to authenticated;

create function pg_temp.summary_as(p_actor text, p_division text default null,
                                   p_grain text default 'month', p_tag text default null)
returns void language plpgsql as $fn$
declare v_uid uuid;
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into t_sum
    select coalesce(p_tag, p_actor), s.*
      from usage_summary('2020-03-01 00:00+07', '2020-04-01 00:00+07', p_division, p_grain) s;
  reset role;
end $fn$;

-- ---- (b) Insert: hanya baris sendiri, hanya karyawan aktif ------------------
select pg_temp.expect('staff_cm', true,  'insert page view sendiri',
  $$insert into usage_page_views (employee_id, path) values ('b0000000-0000-4000-8000-000000000004', '/dashboard')$$);
select pg_temp.expect('staff_cm', false, 'insert atas nama karyawan lain ditolak',
  $$insert into usage_page_views (employee_id, path) values ('b0000000-0000-4000-8000-000000000005', '/dashboard')$$);
select pg_temp.expect('staff_cm', false, 'insert dengan occurred_at karangan ditolak',
  $$insert into usage_page_views (employee_id, path, occurred_at) values ('b0000000-0000-4000-8000-000000000004', '/x', '2020-01-01')$$);
select pg_temp.expect('nonaktif', false, 'karyawan nonaktif tidak tercatat',
  $$insert into usage_page_views (employee_id, path) values ('b0000000-0000-4000-8000-000000000006', '/dashboard')$$);
select pg_temp.expect('kreator', false, 'kreator (bukan karyawan) tidak tercatat',
  $$insert into usage_page_views (employee_id, path) values ('b0000000-0000-4000-8000-000000000007', '/dashboard')$$);
select pg_temp.expect('staff_cm', false, 'path tanpa awalan / ditolak',
  $$insert into usage_page_views (employee_id, path) values ('b0000000-0000-4000-8000-000000000004', 'https://x')$$);
select pg_temp.expect('od', false, 'OD pun tidak bisa SELECT baris mentah',
  $$select count(*) from usage_page_views$$);

-- ---- (a) Append-only ------------------------------------------------------------
select pg_temp.expect('staff_cm', false, 'UPDATE oleh authenticated ditolak',
  $$update usage_page_views set path = '/ubah' where employee_id = 'b0000000-0000-4000-8000-000000000004'$$, true);
select pg_temp.expect('od', false, 'DELETE oleh authenticated ditolak',
  $$delete from usage_page_views where employee_id = 'b0000000-0000-4000-8000-000000000004'$$, true);

do $$
declare v_rows bigint;
begin
  -- Baris milik pemilik tabel sendiri, supaya trigger baris benar-benar terpicu.
  insert into usage_page_views (employee_id, path, occurred_at)
    values ('b0000000-0000-4000-8000-000000000005', '/uji-append-only', '2020-02-01 10:00+07');
  begin
    update usage_page_views set path = '/ubah' where path = '/uji-append-only';
    insert into t_result values (false, 'pemilik · UPDATE lolos trigger (seharusnya ditolak)');
  exception when others then
    insert into t_result values (sqlerrm like '%append-only%', 'pemilik · UPDATE ditolak trigger append-only');
  end;
  begin
    truncate usage_page_views;
    insert into t_result values (false, 'pemilik · TRUNCATE lolos trigger (seharusnya ditolak)');
  exception when others then
    insert into t_result values (sqlerrm like '%append-only%', 'pemilik · TRUNCATE ditolak trigger append-only');
  end;
  begin
    delete from usage_page_views where path = '/uji-append-only';
    insert into t_result values (false, 'pemilik · DELETE lolos trigger (seharusnya ditolak)');
  exception when others then
    insert into t_result values (sqlerrm like '%append-only%', 'pemilik · DELETE ditolak trigger append-only');
  end;
end $$;

-- ---- (c) Sessionization ---------------------------------------------------------
-- Staff CM, 10 Maret 2020 (WIB): 09:00, 09:10 (jeda 10') | 09:55 (jeda 45'), 10:05 (jeda 10')
-- → 2 sesi × 10 menit = 0,33 jam, 4 page view, terakhir 10:05.
insert into usage_page_views (employee_id, path, occurred_at) values
  ('b0000000-0000-4000-8000-000000000004', '/dashboard',       '2020-03-10 09:00+07'),
  ('b0000000-0000-4000-8000-000000000004', '/meago/creators',  '2020-03-10 09:10+07'),
  ('b0000000-0000-4000-8000-000000000004', '/meago/workspace', '2020-03-10 09:55+07'),
  ('b0000000-0000-4000-8000-000000000004', '/dashboard',       '2020-03-10 10:05+07');
-- Staff BD: satu page view → 1 sesi, 0 jam.
insert into usage_page_views (employee_id, path, occurred_at) values
  ('b0000000-0000-4000-8000-000000000005', '/leads', '2020-03-11 13:00+07');

-- ---- (e) >1000 baris --------------------------------------------------------------
-- Lead CM: 1500 page view tiap 1 menit mulai 1 Maret 2020 08:00 → satu sesi
-- sepanjang 1499 menit = 24,98 jam.
insert into usage_page_views (employee_id, path, occurred_at)
  select 'b0000000-0000-4000-8000-000000000003', '/meago/workspace',
         '2020-03-01 08:00+07'::timestamptz + make_interval(mins => g)
    from generate_series(0, 1499) g;

-- ---- (d) Gerbang wewenang -----------------------------------------------------
select pg_temp.expect('staff_cm', false, 'staff ditolak usage_summary',
  $$select * from usage_summary('2020-03-01', '2020-04-01')$$);
select pg_temp.expect('kreator', false, 'kreator ditolak usage_summary',
  $$select * from usage_summary('2020-03-01', '2020-04-01')$$);
select pg_temp.expect('nonaktif', false, 'karyawan nonaktif ditolak usage_summary',
  $$select * from usage_summary('2020-03-01', '2020-04-01')$$);
select pg_temp.expect('staff_cm', true, 'staff: usage_recorded_since() tidak membocorkan apa pun',
  $q$do $d$ begin if usage_recorded_since() is not null then raise exception 'bocor'; end if; end $d$$q$);

select pg_temp.summary_as('od');
select pg_temp.summary_as('director');
select pg_temp.summary_as('lead_cm');
select pg_temp.summary_as('lead_cm', 'BizDev', 'month', 'lead_cm_bd');   -- coba minta divisi lain
select pg_temp.summary_as('od', 'BizDev', 'month', 'od_bd');

select pg_temp.expect_bool('(c) staff CM: 2 sesi',
  (select sessions = 2 from t_sum where actor = 'od' and employee_id = 'b0000000-0000-4000-8000-000000000004'), true);
select pg_temp.expect_bool('(c) staff CM: 0,33 jam (2 × 10 menit)',
  (select hours = 0.33 from t_sum where actor = 'od' and employee_id = 'b0000000-0000-4000-8000-000000000004'), true);
select pg_temp.expect_bool('(c) staff CM: 4 page view',
  (select page_views = 4 from t_sum where actor = 'od' and employee_id = 'b0000000-0000-4000-8000-000000000004'), true);
select pg_temp.expect_bool('(c) staff CM: terakhir aktif 10:05 WIB',
  (select last_active = '2020-03-10 10:05+07' from t_sum where actor = 'od' and employee_id = 'b0000000-0000-4000-8000-000000000004'), true);
select pg_temp.expect_bool('(c) periode = bulan Maret 2020',
  (select period_start = '2020-03-01' from t_sum where actor = 'od' and employee_id = 'b0000000-0000-4000-8000-000000000004'), true);
select pg_temp.expect_bool('(c) staff BD: 1 sesi, 0 jam, 1 page view',
  (select sessions = 1 and hours = 0 and page_views = 1 from t_sum where actor = 'od' and employee_id = 'b0000000-0000-4000-8000-000000000005'), true);

select pg_temp.expect_bool('(e) 1500 page view teragregasi utuh',
  (select page_views = 1500 from t_sum where actor = 'od' and employee_id = 'b0000000-0000-4000-8000-000000000003'), true);
select pg_temp.expect_bool('(e) 1500 page view = 1 sesi, 24,98 jam',
  (select sessions = 1 and hours = 24.98 from t_sum where actor = 'od' and employee_id = 'b0000000-0000-4000-8000-000000000003'), true);

select pg_temp.expect_bool('(d) OD melihat lintas divisi (CM & BizDev)',
  (select count(distinct division) >= 2 from t_sum where actor = 'od'
     and employee_id in (select uid from t_actor)), true);
select pg_temp.expect_bool('(d) Director melihat lintas divisi',
  (select count(distinct division) >= 2 from t_sum where actor = 'director'
     and employee_id in (select uid from t_actor)), true);
select pg_temp.expect_bool('(d) OD dengan filter BizDev hanya BizDev',
  (select bool_and(division = 'BizDev') from t_sum where actor = 'od_bd'), true);
select pg_temp.expect_bool('(d) lead CM hanya melihat CreatorManagement',
  (select bool_and(division = 'CreatorManagement') from t_sum where actor = 'lead_cm'), true);
select pg_temp.expect_bool('(d) lead CM yang meminta BizDev tetap hanya dapat CreatorManagement',
  (select bool_and(division = 'CreatorManagement') from t_sum where actor = 'lead_cm_bd'), true);
select pg_temp.expect_bool('(d) lead CM melihat staff CM-nya',
  (select sessions = 2 from t_sum where actor = 'lead_cm'
     and employee_id = 'b0000000-0000-4000-8000-000000000004'), true);
select pg_temp.expect_bool('karyawan aktif tanpa aktivitas tetap tampil dengan 0',
  (select sessions = 0 and page_views = 0 and last_active is null from t_sum
    where actor = 'od' and employee_id = 'b0000000-0000-4000-8000-000000000001'), true);
select pg_temp.expect_bool('karyawan nonaktif tanpa data tidak tampil',
  (select count(*) = 0 from t_sum where employee_id = 'b0000000-0000-4000-8000-000000000006'), true);

-- Per minggu (grain week): data staff CM jatuh di minggu Senin 9 Maret 2020.
select pg_temp.summary_as('od', null, 'week', 'od_week');
select pg_temp.expect_bool('grain week: minggu Senin 9 Maret 2020, 2 sesi',
  (select sessions = 2 from t_sum where actor = 'od_week' and period_start = '2020-03-09'
      and employee_id = 'b0000000-0000-4000-8000-000000000004'), true);
select pg_temp.expect_bool('grain week: minggu lain staff CM = 0 sesi',
  (select bool_and(sessions = 0) from t_sum where actor = 'od_week' and period_start <> '2020-03-09'
      and employee_id = 'b0000000-0000-4000-8000-000000000004'), true);

-- ---- Retensi 12 bulan -----------------------------------------------------------
select pg_temp.expect('od', false, 'authenticated tidak bisa memanggil usage_purge_expired()',
  $$select usage_purge_expired()$$);
select pg_temp.expect_bool('usage_purge_expired() menghapus data 2020 (>12 bulan)',
  (select usage_purge_expired() >= 1506), true);
select pg_temp.expect_bool('sesudah purge tidak ada baris uji lama tersisa',
  (select count(*) = 0 from usage_page_views where occurred_at < now() - interval '12 months'), true);
select pg_temp.expect_bool('page view baru (hari ini) tidak ikut terhapus',
  (select count(*) = 1 from usage_page_views where employee_id = 'b0000000-0000-4000-8000-000000000004'), true);
select pg_temp.expect_bool('flag purge tidak tertinggal aktif',
  (select coalesce(current_setting('msdps.usage_purge', true), 'off') <> 'on'), true);
select pg_temp.expect_bool('job pg_cron msdps_usage_retention_monthly terdaftar',
  (select count(*) = 1 from cron.job where jobname = 'msdps_usage_retention_monthly'), true);

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
