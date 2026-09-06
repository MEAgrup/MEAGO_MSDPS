-- =============================================================================
-- 0353 — Resmikan `auth_users_token_defaults` ke repo (objek live tanpa file migrasi)
-- =============================================================================
-- KENAPA ADA FILE INI
--
-- Fungsi `public.auth_users_token_defaults()` dan trigger
-- `auth.users.auth_users_token_defaults` sudah HIDUP di production dan staging,
-- tetapi filenya tidak pernah ada di repo. Riwayat migrasi kedua environment
-- mencatatnya sebagai `0318_auth_users_token_null_guard`; `git log --all` untuk
-- `supabase/migrations/0318*` kosong, dan `grep -rn auth_users_token_defaults`
-- di seluruh repo nol hasil sebelum commit ini (temuan 2026-09-05, lihat
-- docs/STATUS_2026-09-05.md §3c).
--
-- Akibatnya `supabase db reset` dan provisioning environment baru menghasilkan
-- database TANPA trigger ini — dan itu tidak kelihatan sampai ada yang mencoba
-- membuat user.
--
-- APA YANG DILAKUKAN TRIGGERNYA
--
-- GoTrue (Supabase Auth) membaca delapan kolom token di `auth.users` sebagai
-- string Go, bukan pointer. Kalau salah satunya NULL — yang terjadi saat baris
-- user dibuat lewat SQL atau Admin API, bukan lewat signup normal — GoTrue gagal
-- dengan `converting NULL to string is unsupported`. Trigger ini memaksa
-- kedelapannya jadi string kosong sebelum baris ditulis.
--
-- Jalur yang terdampak di aplikasi ini: `createCreatorAccount`
-- (`lib/actions/portal.ts`) membuat akun Portal Kreator lewat Admin API. Tanpa
-- trigger ini, pembuatan akun di environment baru bisa gagal dengan error yang
-- sama sekali tidak menunjuk penyebabnya.
--
-- IDEMPOTEN & NO-OP DI PRODUCTION/STAGING
--
-- Badan fungsi di bawah disalin PERSIS dari `pg_get_functiondef` production,
-- termasuk spasi perataannya, supaya hash sidik jari tidak berubah sedikit pun
-- sesudah migrasi ini diterapkan. Jangan menyisipkan komentar `--` ke dalam
-- badan fungsi: itu mengubah hash mentah dan memunculkan "drift" palsu — kelas
-- alarm palsu yang sempat melahirkan kesimpulan keliru di item 3b.
--
-- Fungsi ini SECURITY INVOKER (bukan definer), jadi ia berjalan sebagai peran
-- yang menulis ke `auth.users` — yaitu `supabase_auth_admin`. Peran itu WAJIB
-- punya EXECUTE, kalau tidak insert GoTrue justru gagal karena permission dan
-- keadaannya lebih buruk daripada bug yang mau ditambal. Grant-nya dijaga
-- pemeriksaan keberadaan peran supaya `scripts/pg_test_reset.sh` (Postgres polos
-- tanpa peran Supabase) tetap lolos.
-- =============================================================================

create or replace function public.auth_users_token_defaults()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.confirmation_token         := coalesce(new.confirmation_token, '');
  new.recovery_token             := coalesce(new.recovery_token, '');
  new.email_change_token_new     := coalesce(new.email_change_token_new, '');
  new.email_change_token_current := coalesce(new.email_change_token_current, '');
  new.email_change               := coalesce(new.email_change, '');
  new.phone_change               := coalesce(new.phone_change, '');
  new.phone_change_token         := coalesce(new.phone_change_token, '');
  new.reauthentication_token     := coalesce(new.reauthentication_token, '');
  return new;
end;
$$;

-- `create trigger` tidak punya `if not exists`; `create or replace trigger` baru
-- ada di PG14+ tapi tetap menulis ulang objeknya. Pakai penjagaan eksplisit
-- supaya benar-benar no-op di environment yang sudah punya triggernya.
do $$
begin
  if not exists (
    select 1
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'auth'
       and c.relname = 'users'
       and t.tgname  = 'auth_users_token_defaults'
       and not t.tgisinternal
  ) then
    create trigger auth_users_token_defaults
      before insert or update on auth.users
      for each row execute function public.auth_users_token_defaults();
  end if;
end $$;

-- Peran yang benar-benar menulis ke auth.users. Dijaga keberadaan perannya
-- supaya migrasi tetap jalan di Postgres polos (pg_test_reset.sh).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.auth_users_token_defaults() to supabase_auth_admin;
  end if;
end $$;
