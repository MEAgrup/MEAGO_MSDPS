-- =============================================================================
-- MSDPS · Merchant Deals · Migration 0341 — edit/hapus dibatasi Director
-- =============================================================================
-- Fitur hapus & edit transaksi deal (tab Merchant Deals) dibatasi ke role
-- "leader dan atasnya" — konsep "leader" lintas divisi belum ada di skema
-- (employees.rank cuma 'staff'/'lead' per-divisi), jadi untuk saat ini dipakai
-- is_director() saja, sesuai instruksi. "Daftarkan Transaksi" (insert) TIDAK
-- berubah — tetap terbuka utk BizDev/CreatorManagement seperti semula.
-- =============================================================================

drop policy if exists brand_deals_update on brand_deals;
create policy brand_deals_update on brand_deals for update to authenticated
  using (is_director());

drop policy if exists brand_deals_delete on brand_deals;
create policy brand_deals_delete on brand_deals for delete to authenticated
  using (is_director());
