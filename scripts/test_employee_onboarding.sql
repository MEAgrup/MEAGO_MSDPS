-- =============================================================================
-- Uji jendela onboarding SPV/Lead (migrasi 0365)
-- =============================================================================
-- Kenapa ada: migrasi ini MELONGGARKAN satu-satunya gerbang penambahan akun di
-- MSDPS. Membaca policy-nya tidak membuktikan apa pun — yang membuktikan adalah
-- mencoba menulis sebagai tiap peran dan melihat DB menerima/menolak, lalu
-- memajukan waktu tutup jendela dan melihat izin yang sama HILANG tanpa ada
-- yang mencabutnya.
--
-- Yang dikunci di sini:
--   · lead hanya boleh staff, hanya divisinya, nol flag, wajib password sementara;
--   · lead tidak punya UPDATE/DELETE (ditolak DIAM-DIAM oleh RLS — dicek ROW_COUNT);
--   · jendela tertutup / kedaluwarsa / divisi tak termasuk = izin lenyap;
--   · OD/Director tidak terpengaruh sama sekali;
--   · mark_password_changed() hanya menyentuh baris pemanggil.
--
-- Cara pakai (butuh database hasil scripts/pg_test_reset.sh):
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -f scripts/test_employee_onboarding.sql
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
grant execute on function mark_password_changed() to authenticated;

-- ---- Fixture: satu akun per peran ------------------------------------------
create temporary table t_actor (label text primary key, uid uuid) on commit drop;

insert into t_actor (label, uid) values
  ('spv_cm',   '11111111-1111-4111-8111-111111111111'),
  ('staff_cm', '22222222-2222-4222-8222-222222222222'),
  ('spv_bd',   '33333333-3333-4333-8333-333333333333'),
  ('od',       '44444444-4444-4444-8444-444444444444'),
  ('director', '55555555-5555-4555-8555-555555555555');

insert into auth.users (id, email)
  select uid, label || '@uji.local' from t_actor;

insert into employees (id, full_name, division, rank, is_od, is_director) values
  ('11111111-1111-4111-8111-111111111111','SPV CM uji',  'CreatorManagement','lead', false,false),
  ('22222222-2222-4222-8222-222222222222','Staff CM uji','CreatorManagement','staff',false,false),
  ('33333333-3333-4333-8333-333333333333','SPV BD uji',  'BizDev',           'lead', false,false),
  ('44444444-4444-4444-8444-444444444444','OD uji',      'Marketing',        'staff',true, false),
  ('55555555-5555-4555-8555-555555555555','Director uji','Account',          'lead', false,true);

-- Kandidat akun baru. auth.users-nya dibuat lebih dulu, persis seperti alur
-- aplikasi (service-role membuat login, sesi penambah menulis baris employees).
create temporary table t_cand (label text primary key, uid uuid) on commit drop;
insert into t_cand (label, uid) values
  ('c1','aaaaaaa1-0000-4000-8000-000000000001'),
  ('c2','aaaaaaa1-0000-4000-8000-000000000002'),
  ('c3','aaaaaaa1-0000-4000-8000-000000000003'),
  ('c4','aaaaaaa1-0000-4000-8000-000000000004'),
  ('c5','aaaaaaa1-0000-4000-8000-000000000005'),
  ('c6','aaaaaaa1-0000-4000-8000-000000000006'),
  ('c7','aaaaaaa1-0000-4000-8000-000000000007'),
  ('c8','aaaaaaa1-0000-4000-8000-000000000008'),
  ('c9','aaaaaaa1-0000-4000-8000-000000000009'),
  ('c10','aaaaaaa1-0000-4000-8000-000000000010'),
  ('c11','aaaaaaa1-0000-4000-8000-000000000011'),
  ('c12','aaaaaaa1-0000-4000-8000-000000000012');
insert into auth.users (id, email) select uid, label || '@kandidat.local' from t_cand;

-- ---- Mesin assertion --------------------------------------------------------
create temporary table t_result (ok boolean, label text) on commit drop;

-- Jalankan `p_sql` sebagai `p_actor` di bawah role `authenticated` (RLS aktif;
-- sebagai postgres/superuser RLS dilewati dan uji ini jadi tidak berarti).
-- p_need_rows untuk UPDATE/DELETE: RLS menolaknya DIAM-DIAM — 0 baris, tanpa
-- error. Tanpa cek ROW_COUNT, "tidak boleh menyentuh baris ini" terbaca sukses.
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

create function pg_temp.expect_bool(p_label text, p_actual boolean, p_expected boolean)
returns void language sql as $fn$
  insert into t_result (ok, label)
  values (p_actual is not distinct from p_expected,
          p_label || case when p_actual is not distinct from p_expected then ''
                          else '  → dapat ' || coalesce(p_actual::text,'NULL') end)
$fn$;

-- Setel jendela onboarding. Ditulis sebagai postgres (bukan lewat RLS) — yang
-- diuji di sini efek konfigurasinya, bukan siapa yang boleh mengubahnya.
create function pg_temp.set_window(p_value jsonb) returns void language sql as $fn$
  insert into app_config (key, value) values ('employees.lead_onboarding', p_value)
  on conflict (key) do update set value = excluded.value
$fn$;

create function pg_temp.add_sql(p_cand text, p_division text, p_rank text,
                                p_is_od boolean default false, p_is_director boolean default false,
                                p_must_change boolean default true,
                                p_created_by uuid default null,
                                p_created_via text default 'lead_window',
                                p_active boolean default true)
returns text language sql as $fn$
  select format(
    $q$insert into employees (id, full_name, division, rank, is_od, is_director, active,
                              created_by, created_via, must_change_password)
       values (%L, %L, %L, %L, %L, %L, %L, %s, %L, %L)$q$,
    (select uid from t_cand where label = p_cand), 'Kandidat ' || p_cand,
    p_division, p_rank, p_is_od, p_is_director, p_active,
    case when p_created_by is null then 'auth.uid()' else quote_literal(p_created_by) end,
    p_created_via, p_must_change)
$fn$;

-- =============================================================================
-- 1. Jendela TERBUKA untuk semua divisi
-- =============================================================================
select pg_temp.set_window(jsonb_build_object(
  'enabled', true, 'opens_at', null,
  'closes_at', to_char((now() + interval '7 days') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'divisions', null, 'note', 'uji'));

select pg_temp.expect_bool('lead_onboarding_open() = true saat jendela berlaku',
  lead_onboarding_open(), true);

select pg_temp.expect('spv_cm', true, 'menambah STAFF divisinya sendiri DITERIMA',
  pg_temp.add_sql('c1','CreatorManagement','staff'));

select pg_temp.expect('spv_cm', false, 'menambah staff DIVISI LAIN ditolak',
  pg_temp.add_sql('c2','BizDev','staff'));

select pg_temp.expect('spv_cm', false, 'mengangkat LEAD baru ditolak',
  pg_temp.add_sql('c3','CreatorManagement','lead'));

select pg_temp.expect('spv_cm', false, 'memberi flag OD ditolak',
  pg_temp.add_sql('c4','CreatorManagement','staff', true, false));

select pg_temp.expect('spv_cm', false, 'memberi flag DIRECTOR ditolak',
  pg_temp.add_sql('c5','CreatorManagement','staff', false, true));

select pg_temp.expect('spv_cm', false, 'password PERMANEN (must_change_password=false) ditolak',
  pg_temp.add_sql('c6','CreatorManagement','staff', false, false, false));

select pg_temp.expect('spv_cm', false, 'created_by orang lain ditolak',
  pg_temp.add_sql('c7','CreatorManagement','staff', false, false, true,
                  '33333333-3333-4333-8333-333333333333'));

select pg_temp.expect('spv_cm', false, 'created_via menyamar "od" ditolak',
  pg_temp.add_sql('c8','CreatorManagement','staff', false, false, true, null, 'od'));

select pg_temp.expect('staff_cm', false, 'STAFF (bukan lead) menambah karyawan ditolak',
  pg_temp.add_sql('c9','CreatorManagement','staff'));

-- Lead tetap tanpa wewenang koreksi: itu yang membuat pelonggaran ini sempit.
select pg_temp.expect('spv_cm', false, 'mengubah data karyawan lain ditolak (0 baris)',
  $$update employees set full_name = 'diubah lead' where id = '22222222-2222-4222-8222-222222222222'$$,
  true);

select pg_temp.expect('spv_cm', false, 'menaikkan dirinya jadi OD ditolak (0 baris)',
  $$update employees set is_od = true where id = '11111111-1111-4111-8111-111111111111'$$,
  true);

select pg_temp.expect('spv_cm', false, 'menghapus karyawan ditolak (0 baris)',
  $$delete from employees where id = '22222222-2222-4222-8222-222222222222'$$,
  true);

-- OD/Director: jalur lama tidak boleh berubah sedikit pun oleh migrasi ini.
select pg_temp.expect('od', true, 'OD menambah LEAD divisi mana pun DITERIMA',
  pg_temp.add_sql('c10','BizDev','lead', false, false, true,
                  '44444444-4444-4444-8444-444444444444', 'od'));

select pg_temp.expect('director', true, 'Director menambah OD baru DITERIMA',
  pg_temp.add_sql('c11','Finance','staff', true, false, false,
                  '55555555-5555-4555-8555-555555555555', 'od'));

-- =============================================================================
-- 2. Pencabutan — tiga jalannya, semuanya harus mematikan izin yang sama
-- =============================================================================

-- (a) OD menutup manual.
select pg_temp.set_window(jsonb_build_object(
  'enabled', false, 'opens_at', null, 'closes_at', null, 'divisions', null, 'note', null));
select pg_temp.expect_bool('lead_onboarding_open() = false saat ditutup OD',
  lead_onboarding_open(), false);
select pg_temp.expect('spv_cm', false, 'jendela DITUTUP: menambah staff ditolak',
  pg_temp.add_sql('c12','CreatorManagement','staff'));

-- (b) Tanggal tutup lewat — tanpa ada yang mencabut apa pun.
select pg_temp.set_window(jsonb_build_object(
  'enabled', true, 'opens_at', null,
  'closes_at', to_char((now() - interval '1 hour') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'divisions', null, 'note', null));
select pg_temp.expect_bool('lead_onboarding_open() = false sesudah closes_at lewat',
  lead_onboarding_open(), false);
select pg_temp.expect('spv_cm', false, 'jendela KEDALUWARSA: menambah staff ditolak',
  pg_temp.add_sql('c12','CreatorManagement','staff'));

-- (c) Belum waktunya buka.
select pg_temp.set_window(jsonb_build_object(
  'enabled', true,
  'opens_at', to_char((now() + interval '1 day') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'closes_at', to_char((now() + interval '7 days') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'divisions', null, 'note', null));
select pg_temp.expect_bool('lead_onboarding_open() = false sebelum opens_at',
  lead_onboarding_open(), false);
select pg_temp.expect('spv_cm', false, 'jendela BELUM BUKA: menambah staff ditolak',
  pg_temp.add_sql('c12','CreatorManagement','staff'));

-- OD tetap bisa menambah meski jendela mati — ini inti "akses kembali ke OD/HR".
select pg_temp.expect('od', true, 'OD tetap menambah karyawan saat jendela mati',
  pg_temp.add_sql('c12','Marketing','staff', false, false, true,
                  '44444444-4444-4444-8444-444444444444', 'od'));

-- =============================================================================
-- 3. Daftar divisi
-- =============================================================================
select pg_temp.set_window(jsonb_build_object(
  'enabled', true, 'opens_at', null,
  'closes_at', to_char((now() + interval '7 days') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'divisions', jsonb_build_array('BizDev'), 'note', null));

select pg_temp.expect_bool('divisi BizDev termasuk daftar',
  lead_onboarding_allows_division('BizDev'), true);
select pg_temp.expect_bool('divisi CreatorManagement di luar daftar',
  lead_onboarding_allows_division('CreatorManagement'), false);

select pg_temp.expect('spv_bd', true, 'SPV BizDev (divisi terdaftar) DITERIMA',
  pg_temp.add_sql('c2','BizDev','staff'));
select pg_temp.expect('spv_cm', false, 'SPV CM (divisi tak terdaftar) ditolak',
  pg_temp.add_sql('c3','CreatorManagement','staff'));

-- =============================================================================
-- 4. Password sementara
-- =============================================================================
-- Baris c1 dibuat spv_cm di §1 dengan must_change_password = true.
select pg_temp.expect_bool('akun buatan lead bertanda password sementara',
  (select must_change_password from employees where id = 'aaaaaaa1-0000-4000-8000-000000000001'),
  true);
select pg_temp.expect_bool('akun buatan lead mencatat created_via lead_window',
  (select created_via = 'lead_window' from employees where id = 'aaaaaaa1-0000-4000-8000-000000000001'),
  true);
select pg_temp.expect_bool('akun buatan lead mencatat siapa penambahnya',
  (select created_by = '11111111-1111-4111-8111-111111111111' from employees
    where id = 'aaaaaaa1-0000-4000-8000-000000000001'),
  true);

-- Pemilik akun menutup flag-nya sendiri, tanpa punya UPDATE atas employees.
do $$
begin
  perform set_config('request.jwt.claim.sub', 'aaaaaaa1-0000-4000-8000-000000000001', true);
  set local role authenticated;
  perform mark_password_changed();
  reset role;
end $$;

select pg_temp.expect_bool('mark_password_changed() menutup flag pemanggil',
  (select must_change_password from employees where id = 'aaaaaaa1-0000-4000-8000-000000000001'),
  false);
select pg_temp.expect_bool('mark_password_changed() menstempel waktu',
  (select password_changed_at is not null from employees
    where id = 'aaaaaaa1-0000-4000-8000-000000000001'),
  true);
select pg_temp.expect_bool('mark_password_changed() TIDAK menyentuh baris lain',
  (select must_change_password from employees where id = 'aaaaaaa1-0000-4000-8000-000000000010'),
  true);

-- Penambahan oleh lead tetap masuk audit_log (trigger 0009 tidak dilewati).
select pg_temp.expect_bool('penambahan oleh lead tercatat di audit_log',
  (select count(*) > 0 from audit_log
    where entity = 'employee' and entity_id = 'aaaaaaa1-0000-4000-8000-000000000001'),
  true);

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
