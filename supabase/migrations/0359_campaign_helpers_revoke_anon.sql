-- =============================================================================
-- MSDPS · Migration 0359 — cabut EXECUTE anon/PUBLIC dari helper campaign 0358
-- =============================================================================
-- Ditemukan lewat Supabase advisor (lint 0028 anon_security_definer_function_
-- executable) tepat sesudah 0358 diterapkan:
--
--   is_campaign_owner() / is_campaign_staff()
--     proacl {=X/postgres, anon=X, authenticated=X, service_role=X}  ← PUBLIC + anon
--   is_od() / is_lead() / auth_division() / auth_creator_id()  (pola rumah)
--     proacl {postgres=X, authenticated=X, service_role=X}           ← tanpa anon
--
-- Postgres memberi EXECUTE ke PUBLIC secara default untuk setiap fungsi baru,
-- dan Supabase mengekspos schema `public` sebagai RPC — jadi tanpa revoke,
-- kedua helper baru bisa dipanggil TANPA login lewat
-- /rest/v1/rpc/is_campaign_owner. Dampak kebocorannya nihil (tanpa auth.uid()
-- keduanya mengembalikan false), tapi ini menyimpang dari pola rumah dan
-- menambah permukaan RPC yang tidak dipakai siapa pun.
--
-- `authenticated` TIDAK ikut dicabut — RLS mengevaluasi ekspresi policy sebagai
-- pemanggil, jadi mencabutnya akan mematikan seluruh policy campaign. Pola
-- persis mengikuti 0311:48 (auth_creator_id) yang sudah terbukti jalan:
-- revoke dari public+anon, grant eksplisit ke authenticated.
--
-- Idempoten dan aman dijalankan berulang.
-- =============================================================================

revoke execute on function is_campaign_owner() from public, anon;
revoke execute on function is_campaign_staff() from public, anon;
grant  execute on function is_campaign_owner() to authenticated;
grant  execute on function is_campaign_staff() to authenticated;
