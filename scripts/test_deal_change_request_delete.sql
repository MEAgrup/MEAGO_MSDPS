-- =============================================================================
-- WAJIB TEST — accept "Ajukan Hapus" transaksi deal (deal_change_requests, 0349/0378)
-- =============================================================================
-- Kenapa ada: laporan BD Lead 2 Nov 2026 — Director meng-accept pengajuan hapus
-- dan gagal dengan `violates check constraint "deal_change_requests_review_shape"`.
-- approveDealChangeRequest() (lib/actions/deals.ts) sengaja menghapus brand_deals
-- DULU lalu baru menandai permintaan 'approved'. FK deal_id ON DELETE SET NULL
-- mengosongkan deal_id saat baris permintaan masih 'pending', dan check 0349
-- mewajibkan deal_id terisi untuk 'pending' → seluruh DELETE dibatalkan.
--
-- File ini memutar ulang urutan statement PERSIS seperti server action
-- (sesi Director ber-RLS, role `authenticated`):
--   1. Satu pengajuan hapus → accept → deal terhapus, request approved.
--   2. Pengajuan hapus massal ("Ajukan Hapus N Terpilih" = N baris dalam satu
--      insert) → Director accept satu per satu.
--   3. Director menghapus langsung (single & massal, deleteDealTransaction[sBulk])
--      deal yang masih punya permintaan menggantung → permintaannya tetap
--      'pending' dengan deal_id NULL dan bisa ditolak.
-- Tanpa migrasi 0378 skrip ini berhenti dengan ERROR check constraint di atas.
--
-- Pakai:
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -f scripts/test_deal_change_request_delete.sql
-- Seluruh isinya satu transaksi, di-ROLLBACK di akhir. Jangan dijalankan
-- terhadap production/staging.
-- =============================================================================
\set ON_ERROR_STOP on
begin;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- ---- Fixture -----------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'bd@uji.local'),
  ('44444444-4444-4444-8444-444444444444', 'director@uji.local');

insert into employees (id, full_name, division, rank, is_director) values
  ('11111111-1111-4111-8111-111111111111', 'BD uji',       'BizDev',  'staff', false),
  ('44444444-4444-4444-8444-444444444444', 'Director uji', 'Account', 'lead',  true);

insert into brand_deals (id, brand_name) values
  ('a0000000-0000-4000-8000-000000000001', 'UJI Hapus Single'),
  ('a0000000-0000-4000-8000-000000000002', 'UJI Hapus Massal 1'),
  ('a0000000-0000-4000-8000-000000000003', 'UJI Hapus Massal 2'),
  ('a0000000-0000-4000-8000-000000000004', 'UJI Hapus Massal 3'),
  ('a0000000-0000-4000-8000-000000000005', 'UJI Director langsung'),
  ('a0000000-0000-4000-8000-000000000006', 'UJI Director massal 1'),
  ('a0000000-0000-4000-8000-000000000007', 'UJI Director massal 2');

-- ---- BD mengajukan (deleteDealTransaction / deleteDealTransactionsBulk) -------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

insert into deal_change_requests (id, deal_id, deal_code, deal_brand_name, action, requested_by) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'D-1', 'UJI Hapus Single', 'delete', auth_emp_id());

-- "Ajukan Hapus 3 Terpilih" — satu insert berisi N baris.
insert into deal_change_requests (id, deal_id, deal_code, deal_brand_name, action, requested_by) values
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'D-2', 'UJI Hapus Massal 1', 'delete', auth_emp_id()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', 'D-3', 'UJI Hapus Massal 2', 'delete', auth_emp_id()),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000004', 'D-4', 'UJI Hapus Massal 3', 'delete', auth_emp_id());

-- Permintaan menggantung untuk deal yang nanti dihapus LANGSUNG oleh Director.
insert into deal_change_requests (id, deal_id, deal_code, deal_brand_name, action, payload, requested_by) values
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', 'D-5', 'UJI Director langsung', 'update', '{}'::jsonb, auth_emp_id()),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006', 'D-6', 'UJI Director massal 1', 'delete', null, auth_emp_id()),
  ('b0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000007', 'D-7', 'UJI Director massal 2', 'delete', null, auth_emp_id());

-- ---- Director meng-accept: urutan approveDealChangeRequest() ------------------
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';

-- (1) Single
delete from brand_deals where id = 'a0000000-0000-4000-8000-000000000001';
update deal_change_requests
   set status = 'approved', reviewed_by = auth_emp_id(), reviewed_at = now(), review_note = null
 where id = 'b0000000-0000-4000-8000-000000000001';

-- (2) Massal — tiap baris antrian di-accept bergantian.
delete from brand_deals where id = 'a0000000-0000-4000-8000-000000000002';
update deal_change_requests set status = 'approved', reviewed_by = auth_emp_id(), reviewed_at = now()
 where id = 'b0000000-0000-4000-8000-000000000002';
delete from brand_deals where id = 'a0000000-0000-4000-8000-000000000003';
update deal_change_requests set status = 'approved', reviewed_by = auth_emp_id(), reviewed_at = now()
 where id = 'b0000000-0000-4000-8000-000000000003';
delete from brand_deals where id = 'a0000000-0000-4000-8000-000000000004';
update deal_change_requests set status = 'approved', reviewed_by = auth_emp_id(), reviewed_at = now()
 where id = 'b0000000-0000-4000-8000-000000000004';

-- (3) Director hapus langsung (single & massal) deal yang punya permintaan pending.
delete from brand_deals where id = 'a0000000-0000-4000-8000-000000000005';
delete from brand_deals where id in ('a0000000-0000-4000-8000-000000000006',
                                     'a0000000-0000-4000-8000-000000000007');
-- Permintaan yatim itu tetap bisa ditolak (rejectDealChangeRequest).
update deal_change_requests
   set status = 'rejected', reviewed_by = auth_emp_id(), reviewed_at = now()
 where id = 'b0000000-0000-4000-8000-000000000005' and status = 'pending';

reset role;

-- ---- Asersi ------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from brand_deals where id::text like 'a0000000-%';
  if n <> 0 then raise exception 'GAGAL: % deal uji masih ada', n; end if;

  select count(*) into n from deal_change_requests
   where id in ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002',
                'b0000000-0000-4000-8000-000000000003','b0000000-0000-4000-8000-000000000004')
     and status = 'approved' and deal_id is null
     and reviewed_by = '44444444-4444-4444-8444-444444444444' and reviewed_at is not null
     and deal_code is not null and deal_brand_name like 'UJI Hapus%';
  if n <> 4 then raise exception 'GAGAL: hanya % dari 4 permintaan hapus tercatat approved utuh', n; end if;

  select count(*) into n from deal_change_requests
   where id = 'b0000000-0000-4000-8000-000000000005' and status = 'rejected' and deal_id is null;
  if n <> 1 then raise exception 'GAGAL: permintaan yatim tidak bisa ditolak'; end if;

  select count(*) into n from deal_change_requests
   where id in ('b0000000-0000-4000-8000-000000000006','b0000000-0000-4000-8000-000000000007')
     and status = 'pending' and deal_id is null and reviewed_at is null;
  if n <> 2 then raise exception 'GAGAL: hapus massal Director tidak menyisakan 2 permintaan pending yatim (dapat %)', n; end if;

  raise notice '✅ test_deal_change_request_delete: semua asersi lolos';
end $$;

-- Bentuk lain check review_shape tetap dijaga.
do $$
begin
  begin
    update deal_change_requests set reviewed_at = now()
     where id = 'b0000000-0000-4000-8000-000000000006';
    raise exception 'GAGAL: pending dengan reviewed_at terisi diterima';
  exception when check_violation then null;
  end;
  begin
    update deal_change_requests set status = 'approved', reviewed_at = null
     where id = 'b0000000-0000-4000-8000-000000000007';
    raise exception 'GAGAL: approved tanpa reviewed_at diterima';
  exception when check_violation then null;
  end;
  raise notice '✅ review_shape tetap menolak bentuk tidak sah';
end $$;

rollback;
