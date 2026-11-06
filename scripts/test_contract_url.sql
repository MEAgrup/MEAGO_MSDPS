-- =============================================================================
-- Uji link kontrak SPK/MoU di verifikasi pembayaran (migrasi 0378)
-- =============================================================================
-- Membuktikan di DB sungguhan:
--   1. Verifikasi PERTAMA tanpa link kontrak DITOLAK
--      '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'.
--   2. URL tidak valid DITOLAK '[link kontrak tidak valid]' (verify_payment,
--      set_transaction_contract_url, dan UPDATE langsung lewat CHECK).
--   3. Verifikasi pertama dengan link valid DITERIMA, link tersimpan.
--   4. Cicilan kedua TANPA link DITERIMA bila link sudah tersimpan, link lama
--      tetap.
--   5. Finance bisa mengganti link; non-Finance tidak.
--
-- Cara pakai:
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -f scripts/test_contract_url.sql
-- Tanpa migrasi 0378 skrip ini GAGAL. Seluruh isinya satu transaksi, di-ROLLBACK.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---- Fixture -----------------------------------------------------------------
create temporary table t_actor (label text primary key, uid uuid) on commit drop;
insert into t_actor (label, uid) values
  ('finance', 'f1111111-1111-4111-8111-111111111111'),
  ('bd',      'f2222222-2222-4222-8222-222222222222');
insert into auth.users (id, email) select uid, label || '@uji.local' from t_actor;
insert into employees (id, full_name, division, rank, is_director) values
  ('f1111111-1111-4111-8111-111111111111', 'Finance uji', 'Finance', 'staff', false),
  ('f2222222-2222-4222-8222-222222222222', 'BD uji',      'BizDev',  'staff', false);

insert into merchants (id, nama_toko, kota, link_toko, kategori, gmv_baseline, target_gmv, payment_intent)
  values ('f7777777-7777-4777-8777-777777777777', 'UJI Merchant Kontrak', 'Bandung', '-', 'Dining', 0, 0, 'Termin');
insert into transactions (id, merchant_id, payment_intent, total_agreed_value) values
  ('f9999999-9999-4999-8999-999999999999', 'f7777777-7777-4777-8777-777777777777', 'Termin', 10000000);

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

-- ---- 1. Verifikasi pertama tanpa link ditolak --------------------------------
select pg_temp.check(e like '%data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!%',
  'verifikasi PERTAMA tanpa link kontrak DITOLAK [data tidak lengkap…]', e)
from (select pg_temp.err_of('finance',
  $$select verify_payment('f9999999-9999-4999-8999-999999999999', 3000000, 'BKT-1')$$) e) x;

select pg_temp.check(e like '%data tidak lengkap%',
  'verifikasi PERTAMA dengan link kosong/spasi DITOLAK', e)
from (select pg_temp.err_of('finance',
  $$select verify_payment('f9999999-9999-4999-8999-999999999999', 3000000, null, '   ')$$) e) x;

select pg_temp.check(amount_verified = 0 and contract_url is null,
  'penolakan tidak mengubah transaksi (amount_verified tetap 0)')
from transactions where id = 'f9999999-9999-4999-8999-999999999999';

-- ---- 2. URL tidak valid ditolak ----------------------------------------------
select pg_temp.check(e like '%link kontrak tidak valid%',
  'URL tidak valid ' || quote_literal(u) || ' DITOLAK [link kontrak tidak valid]', e)
from (select u, pg_temp.err_of('finance', format(
        $$select verify_payment('f9999999-9999-4999-8999-999999999999', 3000000, null, %L)$$, u)) e
      from unnest(array['drive.google.com/spk', 'ftp://files.mea.id/spk.pdf',
                        'javascript:alert(1)', 'https://', 'https://docs google.com/x',
                        'https://localhost']) u) x;

-- ---- 3. Verifikasi pertama dengan link valid diterima ------------------------
select pg_temp.check(e is null, 'verifikasi PERTAMA dengan link valid DITERIMA', e)
from (select pg_temp.err_of('finance',
  $$select verify_payment('f9999999-9999-4999-8999-999999999999', 3000000, 'BKT-1',
                          '  https://drive.google.com/file/d/SPK-UJI/view?usp=sharing  ')$$) e) x;

select pg_temp.check(amount_verified = 3000000
                     and contract_url = 'https://drive.google.com/file/d/SPK-UJI/view?usp=sharing'
                     and status = '[Terverifikasi - Sebagian]',
  'link tersimpan (di-trim), status [Terverifikasi - Sebagian]', contract_url)
from transactions where id = 'f9999999-9999-4999-8999-999999999999';

-- ---- 4. Cicilan kedua tanpa link diterima bila link sudah ada ---------------
select pg_temp.check(e is null, 'cicilan KEDUA tanpa link DITERIMA (link sudah tersimpan)', e)
from (select pg_temp.err_of('finance',
  $$select verify_payment('f9999999-9999-4999-8999-999999999999', 3000000, 'BKT-2')$$) e) x;

select pg_temp.check(amount_verified = 6000000
                     and contract_url = 'https://drive.google.com/file/d/SPK-UJI/view?usp=sharing',
  'cicilan kedua: amount_verified 6jt, link lama tetap', contract_url)
from transactions where id = 'f9999999-9999-4999-8999-999999999999';

select pg_temp.check(e like '%link kontrak tidak valid%',
  'cicilan dengan link tidak valid tetap DITOLAK', e)
from (select pg_temp.err_of('finance',
  $$select verify_payment('f9999999-9999-4999-8999-999999999999', 1000000, null, 'bukan url')$$) e) x;

-- ---- 5. Ganti link -----------------------------------------------------------
select pg_temp.check(e is null, 'Finance mengganti link kontrak DITERIMA', e)
from (select pg_temp.err_of('finance',
  $$select set_transaction_contract_url('f9999999-9999-4999-8999-999999999999',
                                        'https://mea.id/kontrak/MoU-UJI-rev2.pdf')$$) e) x;

select pg_temp.check(contract_url = 'https://mea.id/kontrak/MoU-UJI-rev2.pdf',
  'link kontrak berganti', contract_url)
from transactions where id = 'f9999999-9999-4999-8999-999999999999';

select pg_temp.check(e like '%link kontrak tidak valid%', 'ganti link ke URL tidak valid DITOLAK', e)
from (select pg_temp.err_of('finance',
  $$select set_transaction_contract_url('f9999999-9999-4999-8999-999999999999', 'mea.id/x')$$) e) x;

select pg_temp.check(e like '%data tidak lengkap%', 'ganti link ke kosong DITOLAK', e)
from (select pg_temp.err_of('finance',
  $$select set_transaction_contract_url('f9999999-9999-4999-8999-999999999999', '')$$) e) x;

select pg_temp.check(e like '%hanya Finance%', 'BizDev mengganti link DITOLAK', e)
from (select pg_temp.err_of('bd',
  $$select set_transaction_contract_url('f9999999-9999-4999-8999-999999999999', 'https://mea.id/x')$$) e) x;

select pg_temp.check(e is not null, 'UPDATE langsung ke URL tidak valid DITOLAK (CHECK)', e)
from (select pg_temp.err_of('finance',
  $$update transactions set contract_url = 'javascript:alert(1)'
     where id = 'f9999999-9999-4999-8999-999999999999'$$) e) x;

select pg_temp.check(not exists (select 1 from pg_proc where proname = 'verify_payment' and pronargs = 3),
  'verify_payment 3-argumen lama sudah tidak ada (tidak ada jalan pintas)');

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
