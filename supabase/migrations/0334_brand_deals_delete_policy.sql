-- =============================================================================
-- MSDPS · Merchant Deals · Migration 0334 — brand_deals: RLS delete policy
-- =============================================================================
-- 0305_deals.sql hanya membuat policy select/insert/update untuk brand_deals —
-- tidak ada policy delete, jadi delete lewat client (deleteDealTransaction /
-- deleteDealTransactionsBulk, lib/actions/deals.ts) senyap ditolak RLS: query
-- tidak error (baris cocok = 0), sehingga UI melapor "berhasil" padahal baris
-- tidak terhapus. Cakupan sama seperti brand_deals_update (mgmt + BizDev) plus
-- CreatorManagement, mengikuti canManageDeals() di lib/actions/deals.ts.
-- =============================================================================

do $$ begin
  create policy brand_deals_delete on brand_deals for delete to authenticated
    using (is_od() or is_director() or auth_division() in ('BizDev','CreatorManagement'));
exception when duplicate_object then null;
end $$;
