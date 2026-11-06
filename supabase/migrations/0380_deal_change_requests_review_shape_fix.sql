-- =============================================================================
-- MSDPS · Merchant Deals · Migration 0380 — fix accept "Ajukan Hapus" (0349)
-- =============================================================================
-- Bug (laporan BD Lead 2026-11-02): Director meng-accept pengajuan hapus
-- transaksi deal → gagal dengan
--   new row for relation "deal_change_requests" violates check constraint
--   "deal_change_requests_review_shape"
--
-- Sebab: approveDealChangeRequest() (lib/actions/deals.ts) sengaja menghapus
-- brand_deals DULU, baru menandai permintaan 'approved' (supaya kalau
-- penerapannya gagal, permintaan tetap pending — bukan hilang). Saat DELETE,
-- FK deal_id ON DELETE SET NULL (0349) mengosongkan deal_id pada baris
-- permintaan yang MASIH 'pending'; check review_shape 0349 mewajibkan
-- `deal_id is not null` untuk 'pending' → seluruh DELETE dibatalkan. Hal yang
-- sama terjadi bila Director menghapus langsung (single/massal) deal yang masih
-- punya permintaan menggantung.
--
-- Perbaikan: syarat `deal_id is not null` dibuang dari cabang 'pending'.
-- Itu memang bertentangan dengan ON DELETE SET NULL yang dipilih 0349 sendiri
-- (jejak permintaan harus selamat setelah deal hilang). Kode sudah menangani
-- permintaan pending yatim ("Deal terkait sudah tidak ada." → Director tolak).
-- Syarat lain review_shape (pending ⇒ belum ditinjau; non-pending ⇒
-- reviewed_at terisi) tidak berubah. RLS & alur approval tidak disentuh.
--
-- Uji: scripts/test_deal_change_request_delete.sql
-- =============================================================================

alter table deal_change_requests
  drop constraint if exists deal_change_requests_review_shape;

alter table deal_change_requests
  add constraint deal_change_requests_review_shape check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or (status <> 'pending' and reviewed_at is not null)
  );
