-- =============================================================================
-- MSDPS · Admin Ops CRM · Migration 0323 — hardening: cabut EXECUTE fungsi
-- SECURITY DEFINER milik 0321
-- =============================================================================
-- Migrasi 0321 membuat fungsi trigger `crm_leads_validate()` dan
-- `crm_transaksi_validate()` sebagai SECURITY DEFINER (wajib: hanya konteks owner
-- yang boleh memanggil `next_code()`), tapi LUPA mencabut EXECUTE dari
-- public/anon/authenticated. Akibatnya keduanya terdaftar di PostgREST sebagai
-- `/rest/v1/rpc/crm_leads_validate` dan muncul di Supabase advisor
-- (`anon_security_definer_function_executable` +
-- `authenticated_security_definer_function_executable`).
--
-- Dampak praktisnya kecil — fungsi trigger yang dipanggil langsung akan gagal
-- ("trigger functions can only be called as triggers") karena `NEW`/`TG_OP` tidak
-- ada di luar konteks trigger — tapi tetap menyimpang dari konvensi repo:
-- SEMUA fungsi trigger definer lain sudah dicabut di 0008 dan 0105, sehingga
-- grant-nya hanya `postgres` + `service_role`.
--
-- Mencabut EXECUTE TIDAK mempengaruhi jalannya trigger: PostgreSQL memeriksa hak
-- EXECUTE saat trigger DIBUAT, bukan saat trigger berjalan.
--
-- `normalize_phone_62()` sengaja TIDAK dicabut dari authenticated: fungsi ini
-- SECURITY INVOKER + IMMUTABLE (bukan definer), sejajar dengan
-- `normalize_phone_id()` yang juga tetap bisa dipakai lewat query biasa.
-- =============================================================================

revoke execute on function crm_leads_validate()     from public, anon, authenticated;
revoke execute on function crm_transaksi_validate() from public, anon, authenticated;
