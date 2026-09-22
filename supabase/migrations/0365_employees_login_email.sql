-- =============================================================================
-- MSDPS · Migration 0365 — employees.email (kolom login) + sinkronisasi auth.users
-- =============================================================================
-- Tab "Kelola Karyawan" perlu menampilkan email/username login tiap karyawan.
-- employees.id 1:1 dengan auth.users.id (lihat 0002), tapi email hanya ada di
-- auth.users, yang tidak diekspos lewat PostgREST. Simpan salinannya di
-- employees.email supaya bisa di-SELECT biasa lewat RLS employees_select_all
-- yang sudah ada, dan disinkronkan otomatis kalau email berubah di auth.users.
-- =============================================================================

alter table employees add column email text;

update employees e
set email = u.email
from auth.users u
where u.id = e.id and e.email is null;

comment on column employees.email is
  'Salinan auth.users.email — dipakai untuk tampilan (login/username). Disinkronkan via trigger sync_employee_email.';

-- Jaga sinkron ke depan: perubahan email di auth.users (mis. lewat admin.updateUserById)
-- harus tercermin di employees.email tanpa perlu tulis manual dari app code.
create or replace function sync_employee_email() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update employees set email = new.email where id = new.id and email is distinct from new.email;
  return new;
end;
$$;

drop trigger if exists trg_sync_employee_email on auth.users;
create trigger trg_sync_employee_email
  after insert or update of email on auth.users
  for each row execute function sync_employee_email();

-- Trigger dieksekusi sebagai supabase_auth_admin (peran yang menulis auth.users
-- lewat GoTrue/Admin API). Tanpa EXECUTE eksplisit, insert/update auth.users
-- bisa gagal karena permission (lihat 0353 untuk kasus serupa).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function sync_employee_email() to supabase_auth_admin;
  end if;
end $$;
