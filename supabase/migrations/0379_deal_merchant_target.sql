-- =============================================================================
-- MSDPS · Merchant Deals · migrasi 0379 — Baseline & Target GMV diisi BD
-- =============================================================================
-- Email Tim OD 2026-10-30, ACC owner (Yohan) 2026-11-06: form "Daftarkan
-- Transaksi" (Merchant Deals) menambah empat isian —
--   GMV Baseline        (opsional)
--   Target GMV          (WAJIB untuk deal baru — ditegakkan di server action,
--                        bukan NOT NULL, karena deal lama tidak punya nilainya)
--   Link Akun Merchant  (opsional)
--   Kategori Merchant   (opsional, teks bebas — beda dengan kategori_poi)
-- Data ini nanti dibaca Head/AM di CDPS lewat Bridge (blok opsional
-- `merchant_target` di payload, lib/bridge/payload.ts).
--
-- Membalik keputusan Bridge D7 ("Baseline & Target diinput Head di CDPS saat
-- Bridge accept") — lihat docs/DECISIONS.md entri 2026-11-06.
--
-- Nama kolom sengaja ber-prefix `merchant_`: brand_deals SUDAH punya
-- `target_gmv` milik campaign MEA GO (0342, campaign_enabled=true) — makna
-- berbeda (target campaign kreator), jangan dicampur.
--
-- Murni penambahan kolom nullable: nol perubahan RLS (policy brand_deals
-- berlaku per baris, bukan per kolom), nol perubahan trigger validasi.
-- =============================================================================

alter table brand_deals
  add column merchant_gmv_baseline  numeric,
  add column merchant_target_gmv    numeric,
  add column link_akun_merchant     text,
  add column kategori_merchant      text;

alter table brand_deals
  add constraint brand_deals_merchant_gmv_baseline_check check (merchant_gmv_baseline is null or merchant_gmv_baseline >= 0),
  add constraint brand_deals_merchant_target_gmv_check check (merchant_target_gmv is null or merchant_target_gmv > 0),
  add constraint brand_deals_link_akun_merchant_check
    check (link_akun_merchant is null or link_akun_merchant ~* '^https?://\S+$'),
  add constraint brand_deals_kategori_merchant_check
    check (kategori_merchant is null or (btrim(kategori_merchant) <> '' and length(kategori_merchant) <= 100));

comment on column brand_deals.merchant_gmv_baseline is
  'GMV Baseline merchant saat deal (rupiah, opsional) — diisi BD di form Daftarkan Transaksi (0379, membalik Bridge D7). Diteruskan ke CDPS di payload bridge (merchant_target).';
comment on column brand_deals.merchant_target_gmv is
  'Target GMV merchant (rupiah) — wajib di form Daftarkan Transaksi sejak 0379; NULL hanya untuk deal sebelum 0379 / hasil Import Bulking.';
comment on column brand_deals.link_akun_merchant is
  'Link akun/toko merchant (http/https, opsional) — 0379.';
comment on column brand_deals.kategori_merchant is
  'Kategori bisnis merchant (teks bebas, opsional, mis. F&B / Fashion) — 0379. BUKAN kategori_poi (TTD/Accomodation/Dining).';
