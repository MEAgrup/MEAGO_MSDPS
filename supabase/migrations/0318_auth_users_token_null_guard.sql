-- =============================================================================
-- MSDPS · Migration 0318 — Guard kolom token auth.users yang NULL
-- =============================================================================
-- Gejala: login gagal dengan HTTP 500 `unexpected_failure` dan pesan di auth log
--
--   error finding user: sql: Scan error on column index 3, name
--   "confirmation_token": converting NULL to string is unsupported
--
-- Sebab: GoTrue memetakan confirmation_token / recovery_token /
-- email_change_token_new / email_change / phone_change / phone_change_token /
-- email_change_token_current / reauthentication_token ke `string` Go yang tidak
-- nullable. Empat kolom pertama TIDAK punya DEFAULT di auth.users, jadi baris
-- yang dibuat lewat jalur selain Admin API (INSERT SQL langsung ke auth.users)
-- meninggalkannya NULL. Sejak itu SETIAP login akun tersebut gagal 500 — akunnya
-- ada, password-nya benar, tapi GoTrue tidak pernah sampai ke tahap verifikasi.
-- Di sisi browser supabase-js hanya menerima badan error kosong, sehingga user
-- melihat pesan gagal tanpa keterangan.
--
-- Migrasi ini menutup dua sisi:
--   1. Backfill baris lama yang sudah terlanjur NULL.
--   2. Trigger BEFORE INSERT/UPDATE yang memaksa NULL → '' , sehingga jalur
--      pembuatan user apa pun (Admin API, dashboard, INSERT SQL manual, skrip
--      seed) tidak bisa lagi melahirkan akun yang tidak bisa login.
-- Kolomnya sengaja dibiarkan nullable: menambah NOT NULL di skema `auth` bisa
-- bentrok dengan migrasi internal Supabase saat GoTrue di-upgrade.
-- =============================================================================

-- ---- 1. Backfill ------------------------------------------------------------
update auth.users set
  confirmation_token         = coalesce(confirmation_token, ''),
  recovery_token             = coalesce(recovery_token, ''),
  email_change_token_new     = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  email_change               = coalesce(email_change, ''),
  phone_change               = coalesce(phone_change, ''),
  phone_change_token         = coalesce(phone_change_token, ''),
  reauthentication_token     = coalesce(reauthentication_token, '')
where confirmation_token is null
   or recovery_token is null
   or email_change_token_new is null
   or email_change_token_current is null
   or email_change is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;

-- ---- 2. Guard ---------------------------------------------------------------
-- Trigger di auth.users mengikuti pola yang sama dengan handle_new_user() di
-- dokumentasi Supabase: fungsi tinggal di `public`, trigger-nya menempel di
-- `auth.users`. Hanya menyentuh NEW, jadi tidak perlu SECURITY DEFINER.
create or replace function public.auth_users_token_defaults()
  returns trigger language plpgsql set search_path = '' as $$
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

comment on function public.auth_users_token_defaults() is
  'Memaksa kolom token auth.users NULL → '''' . GoTrue memindainya sebagai string non-nullable; NULL membuat login akun tsb gagal 500 unexpected_failure. Lihat migrasi 0318.';

-- GoTrue menulis auth.users sebagai supabase_auth_admin; hak EXECUTE dicek saat
-- trigger dibuat, tapi grant ini menjaga trigger tetap valid setelah restore.
grant execute on function public.auth_users_token_defaults()
  to postgres, service_role, supabase_auth_admin;

drop trigger if exists auth_users_token_defaults on auth.users;
create trigger auth_users_token_defaults
  before insert or update on auth.users
  for each row execute function public.auth_users_token_defaults();
