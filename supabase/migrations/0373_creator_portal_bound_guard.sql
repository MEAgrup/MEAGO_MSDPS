-- =============================================================================
-- MSDPS · Creator Portal · Migration 0373 — Akses portal hanya untuk kreator Bound
-- =============================================================================
-- Kenapa ada: Creator Portal kini dibuka untuk kreator yang CLOSING lewat
-- MEAGO! = sudah binding agency TikTok GO (binding_status = 'Bound creators').
-- Bila binding lepas, akses harus tertolak di request berikutnya — tanpa
-- menunggu ada yang mencabut akun secara manual (default keputusan #6).
--
-- Satu titik: auth_creator_id() (0311) dipakai SEMUA policy & view portal
-- (creator_reports, creator_complaints, creator_requests, creator_period_summary,
-- special_project*, campaign_participants, campaign_*_submissions,
-- campaign_payouts, v_portal_*). Menambah syarat Bound di sini otomatis menutup
-- semuanya. Baris mcn_creators milik sendiri (policy mcn_creators_select_creator_self)
-- sengaja tetap terbaca supaya aplikasi bisa menampilkan "akses nonaktif" alih-alih
-- error; aplikasi juga mengecek Bound di layout portal (lib/supabase/server.ts).
--
-- Dampak: akun kreator non-Bound yang dibuat CM lewat createCreatorAccount ikut
-- tertolak (per 2026-10-19: 0 akun kreator tertaut di production) — disetujui
-- Yohan 2026-10-19.
-- Idempoten.
-- =============================================================================

create or replace function auth_creator_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select id from mcn_creators
   where auth_user_id = auth.uid()
     and binding_status = 'Bound creators'
$$;

comment on function auth_creator_id() is
  'id mcn_creators milik auth.uid() — HANYA bila binding_status = Bound creators (0373). NULL = tidak punya akses Creator Portal.';

revoke execute on function auth_creator_id() from public, anon;
grant execute on function auth_creator_id() to authenticated;
