-- =============================================================================
-- Uji GMV per kategori (migrasi 0383) — creator_period_category_summary
-- =============================================================================
-- Membuktikan di DB sungguhan:
--   1. CM (CreatorManagement) bisa insert/select/delete baris kategori.
--   2. BizDev bisa SELECT tapi TIDAK bisa insert/delete (pola sama creator_period_summary).
--   3. KOL tidak melihat baris sama sekali.
--   4. Kategori di luar dining/accommodation/ttd/live DITOLAK (CHECK), juga 'all'.
--   5. upload_batches.category menerima kategori valid & NULL, menolak lainnya.
--   6. Baris kategori TIDAK muncul di creator_period_summary (angka All tidak tercampur).
--   7. mcn_purge_expired_weekly_data ikut membersihkan baris kategori kedaluwarsa.
--
-- Cara pakai:
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -f scripts/test_creator_category_summary.sql
-- Tanpa migrasi 0383 skrip ini GAGAL. Seluruh isinya satu transaksi, di-ROLLBACK.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---- Fixture -----------------------------------------------------------------
create temporary table t_actor (label text primary key, uid uuid) on commit drop;
insert into t_actor (label, uid) values
  ('cm',  'c1111111-1111-4111-8111-111111111111'),
  ('bd',  'c2222222-2222-4222-8222-222222222222'),
  ('kol', 'c3333333-3333-4333-8333-333333333333');
insert into auth.users (id, email) select uid, label || '@uji.local' from t_actor;
insert into employees (id, full_name, division, rank, is_director) values
  ('c1111111-1111-4111-8111-111111111111', 'CM uji',  'CreatorManagement', 'staff', false),
  ('c2222222-2222-4222-8222-222222222222', 'BD uji',  'BizDev',            'staff', false),
  ('c3333333-3333-4333-8333-333333333333', 'KOL uji', 'KOL',               'staff', false);
insert into mcn_creators (id, name, username) values
  ('c7777777-7777-4777-8777-777777777777', 'Kreator Uji Kategori', 'ujikategori');

-- ---- Mesin assertion -----------------------------------------------------------
create temporary table t_result (ok boolean, label text) on commit drop;

-- Pesan error statement p_sql sebagai aktor (NULL bila sukses).
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

create function pg_temp.check(p_ok boolean, p_label text, p_detail text default null)
returns void language sql as $fn$
  insert into t_result values (coalesce(p_ok, false),
    p_label || case when coalesce(p_ok, false) then '' else '  → ' || coalesce(p_detail, '(null)') end);
$fn$;

-- Jumlah baris yang terlihat aktor untuk query p_sql (count(*)).
create function pg_temp.count_as(p_actor text, p_sql text) returns bigint language plpgsql as $fn$
declare v_uid uuid; v_n bigint;
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  set local role authenticated;
  execute p_sql into v_n;
  reset role;
  return v_n;
end $fn$;

-- ---- 1. CM insert ------------------------------------------------------------
select pg_temp.check(e is null, 'CM insert baris Dining DITERIMA', e)
from (select pg_temp.err_of('cm',
  $$insert into creator_period_category_summary
      (mcn_creator_id, category, period_start, period_end, upload_batch, affiliate_gmv, orders)
    values ('c7777777-7777-4777-8777-777777777777', 'dining', '2026-10-01', '2026-10-07', 'ingest:2026-10-01:uji1', 700, 7)$$) e) x;
select pg_temp.check(e is null, 'CM insert baris LIVE DITERIMA', e)
from (select pg_temp.err_of('cm',
  $$insert into creator_period_category_summary
      (mcn_creator_id, category, period_start, upload_batch, affiliate_gmv)
    values ('c7777777-7777-4777-8777-777777777777', 'live', '2026-10-01', 'ingest:2026-10-01:uji2', 260)$$) e) x;
select pg_temp.check(pg_temp.count_as('cm', 'select count(*) from creator_period_category_summary') = 2,
  'CM melihat 2 baris kategori');

-- ---- 2-3. BizDev & KOL ---------------------------------------------------------
select pg_temp.check(pg_temp.count_as('bd', 'select count(*) from creator_period_category_summary') = 2,
  'BizDev bisa SELECT baris kategori');
select pg_temp.check(e is not null, 'BizDev insert DITOLAK (RLS)', e)
from (select pg_temp.err_of('bd',
  $$insert into creator_period_category_summary (mcn_creator_id, category, period_start, upload_batch)
    values ('c7777777-7777-4777-8777-777777777777', 'ttd', '2026-10-01', 'x')$$) e) x;
select pg_temp.check(pg_temp.count_as('bd',
  $$with d as (delete from creator_period_category_summary returning 1) select count(*) from d$$) = 0,
  'BizDev delete = 0 baris (RLS)');
select pg_temp.check(pg_temp.count_as('kol', 'select count(*) from creator_period_category_summary') = 0,
  'KOL tidak melihat baris kategori');

-- ---- 4. CHECK kategori ---------------------------------------------------------
select pg_temp.check(e is not null, 'kategori ''fashion'' DITOLAK', e)
from (select pg_temp.err_of('cm',
  $$insert into creator_period_category_summary (mcn_creator_id, category, period_start, upload_batch)
    values ('c7777777-7777-4777-8777-777777777777', 'fashion', '2026-10-01', 'x')$$) e) x;
select pg_temp.check(e is not null, 'kategori ''all'' DITOLAK (All tetap di creator_period_summary)', e)
from (select pg_temp.err_of('cm',
  $$insert into creator_period_category_summary (mcn_creator_id, category, period_start, upload_batch)
    values ('c7777777-7777-4777-8777-777777777777', 'all', '2026-10-01', 'x')$$) e) x;

-- ---- 5. upload_batches.category ------------------------------------------------
insert into upload_batches (batch_id, period_start, period_end, category)
  values ('ingest:2026-10-01:ujicat', '2026-10-01', '2026-10-07', 'accommodation');
insert into upload_batches (batch_id, period_start, period_end)
  values ('ingest:2026-10-01:ujiall', '2026-10-01', '2026-10-07');
select pg_temp.check((select category from upload_batches where batch_id = 'ingest:2026-10-01:ujiall') is null,
  'batch tanpa kategori = NULL (All / jalur lama)');
select pg_temp.check(e is not null, 'upload_batches.category ''fashion'' DITOLAK', e)
from (select pg_temp.err_of('cm',
  $$update upload_batches set category = 'fashion' where batch_id = 'ingest:2026-10-01:ujicat'$$) e) x;

-- ---- 6. Tidak bocor ke creator_period_summary ----------------------------------
select pg_temp.check(not exists (
  select 1 from creator_period_summary where mcn_creator_id = 'c7777777-7777-4777-8777-777777777777'),
  'baris kategori tidak muncul di creator_period_summary');

-- ---- 7. Retensi ------------------------------------------------------------------
insert into creator_period_category_summary (mcn_creator_id, category, period_start, upload_batch, affiliate_gmv)
  values ('c7777777-7777-4777-8777-777777777777', 'ttd', current_date - interval '3 years', 'ingest:lama', 1);
select mcn_purge_expired_weekly_data();
select pg_temp.check(not exists (
  select 1 from creator_period_category_summary where upload_batch = 'ingest:lama'),
  'purge retensi menghapus baris kategori kedaluwarsa');
select pg_temp.check((select count(*) from creator_period_category_summary
  where mcn_creator_id = 'c7777777-7777-4777-8777-777777777777') = 2,
  'purge retensi tidak menyentuh baris bulan berjalan');

-- ---- Laporan -------------------------------------------------------------------
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
