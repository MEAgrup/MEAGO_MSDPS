-- =============================================================================
-- Uji field binding akuisisi + PIC CM oleh Akuisisi (migrasi 0382)
-- =============================================================================
-- Membuktikan di DB sungguhan:
--   1. Akuisisi bisa insert binding dengan UID/WA/GMV Potential/Tgl Binding Akhir;
--      WA dinormalisasi ke 62xxxx oleh trigger.
--   2. UID non-angka, WA invalid, GMV negatif, binding akhir < binding DITOLAK.
--   3. Baris lama tanpa field baru tetap valid (kolom nullable).
--   4. Staf Akuisisi bisa menetapkan PIC CM (owner_cpm_id) + jenis kontrak di
--      master kreator (RLS 0302 tidak menghalangi).
--   5. Staf CM non-lead tidak bisa menulis acquisitions.
--
-- Cara pakai:
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -f scripts/test_acquisition_binding.sql
-- Tanpa migrasi 0382 skrip ini GAGAL. Seluruh isinya satu transaksi, di-ROLLBACK.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---- Fixture -----------------------------------------------------------------
create temporary table t_actor (label text primary key, uid uuid) on commit drop;
insert into t_actor (label, uid) values
  ('acq', 'a1111111-1111-4111-8111-111111111111'),
  ('cm',  'a2222222-2222-4222-8222-222222222222');
insert into auth.users (id, email) select uid, label || '@uji.local' from t_actor;
insert into employees (id, full_name, division, rank, is_director) values
  ('a1111111-1111-4111-8111-111111111111', 'Siti Akuisisi uji', 'Acquisition',       'staff', false),
  ('a2222222-2222-4222-8222-222222222222', 'CM uji',            'CreatorManagement', 'staff', false);
insert into mcn_creators (id, name, status) values
  ('a7777777-7777-4777-8777-777777777777', 'UJI Kreator Binding', 'prospek');
grant all on t_actor to authenticated;

-- ---- Mesin assertion -----------------------------------------------------------
create temporary table t_result (ok boolean, label text) on commit drop;

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

-- ---- 1. Insert lengkap oleh Akuisisi -----------------------------------------
select pg_temp.check(e is null, 'Akuisisi insert binding lengkap DITERIMA', e)
from (select pg_temp.err_of('acq', $$
  insert into acquisitions (mcn_creator_id, binding_date, lead_source, creator_uid, whatsapp, gmv_potential, binding_end_date)
  values ('a7777777-7777-4777-8777-777777777777', '2026-11-06', 'inbound', '7012345678901234567', '0812-3456-7890', 25000000, '2027-11-06')
$$) e) x;

select pg_temp.check(whatsapp = '6281234567890' and specialist_id = 'a1111111-1111-4111-8111-111111111111'
                     and gmv_potential = 25000000 and binding_end_date = '2027-11-06',
  'WA dinormalisasi 62xxxx; specialist = aktor; field tersimpan', whatsapp)
from acquisitions where mcn_creator_id = 'a7777777-7777-4777-8777-777777777777';

-- ---- 2. Validasi ---------------------------------------------------------------
select pg_temp.check(e like '%acquisitions_creator_uid_chk%', 'UID non-angka DITOLAK', e)
from (select pg_temp.err_of('acq', $$
  insert into acquisitions (mcn_creator_id, binding_date, creator_uid)
  values ('a7777777-7777-4777-8777-777777777777', '2026-11-06', '@kreator') $$) e) x;

select pg_temp.check(e like '%acquisitions_whatsapp_chk%', 'WA terlalu pendek DITOLAK', e)
from (select pg_temp.err_of('acq', $$
  insert into acquisitions (mcn_creator_id, binding_date, whatsapp)
  values ('a7777777-7777-4777-8777-777777777777', '2026-11-06', '0812') $$) e) x;

select pg_temp.check(e like '%acquisitions_gmv_potential_chk%', 'GMV Potential negatif DITOLAK', e)
from (select pg_temp.err_of('acq', $$
  insert into acquisitions (mcn_creator_id, binding_date, gmv_potential)
  values ('a7777777-7777-4777-8777-777777777777', '2026-11-06', -1) $$) e) x;

select pg_temp.check(e like '%acquisitions_binding_end_chk%', 'Tgl binding akhir < tgl binding DITOLAK', e)
from (select pg_temp.err_of('acq', $$
  insert into acquisitions (mcn_creator_id, binding_date, binding_end_date)
  values ('a7777777-7777-4777-8777-777777777777', '2026-11-06', '2026-11-05') $$) e) x;

-- ---- 3. Baris lama tanpa field baru tetap valid --------------------------------
select pg_temp.check(e is null, 'insert tanpa field 0382 (pola lama) tetap DITERIMA', e)
from (select pg_temp.err_of('acq', $$
  insert into acquisitions (mcn_creator_id, binding_date)
  values ('a7777777-7777-4777-8777-777777777777', '2026-11-07') $$) e) x;

-- ---- 4. Akuisisi menetapkan PIC CM + jenis kontrak -----------------------------
select pg_temp.check(e is null, 'Akuisisi set owner_cpm_id + status_kontrak + prospek→binding DITERIMA', e)
from (select pg_temp.err_of('acq', $$
  update mcn_creators set owner_cpm_id = 'a2222222-2222-4222-8222-222222222222',
                          status_kontrak = 'non kontrak', status = 'binding'
   where id = 'a7777777-7777-4777-8777-777777777777' $$) e) x;

select pg_temp.check(owner_cpm_id = 'a2222222-2222-4222-8222-222222222222'
                     and status_kontrak = 'non kontrak' and status = 'binding',
  'PIC CM, jenis kontrak & status tersimpan di master kreator', owner_cpm_id::text)
from mcn_creators where id = 'a7777777-7777-4777-8777-777777777777';

-- ---- 5. CM non-lead tidak bisa menulis acquisitions ----------------------------
select pg_temp.check(e like '%row-level security%', 'CM staff insert acquisitions DITOLAK (RLS)', e)
from (select pg_temp.err_of('cm', $$
  insert into acquisitions (mcn_creator_id, binding_date)
  values ('a7777777-7777-4777-8777-777777777777', '2026-11-06') $$) e) x;

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
