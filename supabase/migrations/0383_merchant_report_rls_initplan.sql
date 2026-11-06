-- =============================================================================
-- MSDPS · Laporan Performa Merchant · Migration 0383 — RLS 0381 sekali per query
-- =============================================================================
-- Kenapa ada: /meago/laporan-merchant/[lead_id] di production gagal render
-- (2026-11-06, Vercel log: "canceling statement due to statement timeout").
-- Policy 0381 memakai `using (is_merchant_report_staff())` — fungsi security
-- definer itu (→ is_campaign_staff → auth_division/is_lead → employees)
-- dievaluasi PER BARIS. Dengan 8.874 snapshot Sushi Yay Agu–Sep, COUNT saja
-- butuh ~2 dtk dan halaman laporan (beberapa halaman 1.000 baris paralel)
-- melewati statement_timeout 8 dtk.
--
-- Perbaikan = pola resmi Supabase: bungkus jadi `(select is_merchant_report_staff())`
-- sehingga Postgres menghitungnya SEKALI per query (initPlan). Hasil uji di
-- production dalam transaksi ber-rollback: COUNT 1.958 ms → 238 ms.
-- Arti policy TIDAK berubah (fungsi tidak bergantung pada baris).
-- Idempoten.
-- =============================================================================

do $$
declare t text;
begin
  foreach t in array array['merchant_locations','tiktok_post_snapshots','merchant_report_params','merchant_report_notes'] loop
    execute format('drop policy if exists %1$s_select on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select to authenticated using ((select is_merchant_report_staff()))', t);
    execute format('drop policy if exists %1$s_insert on %1$s', t);
    execute format('create policy %1$s_insert on %1$s for insert to authenticated with check ((select is_merchant_report_staff()))', t);
    execute format('drop policy if exists %1$s_update on %1$s', t);
    execute format('create policy %1$s_update on %1$s for update to authenticated using ((select is_merchant_report_staff())) with check ((select is_merchant_report_staff()))', t);
    execute format('drop policy if exists %1$s_delete on %1$s', t);
    execute format('create policy %1$s_delete on %1$s for delete to authenticated using ((select is_merchant_report_staff()))', t);
  end loop;
end $$;
