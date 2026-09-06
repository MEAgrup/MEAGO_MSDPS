-- =============================================================================
-- MSDPS · Migration 0340 — v_portal_deals: saring deal yang belum lengkap
-- =============================================================================
-- MASALAH (audit 2026-09-02)
--
-- `v_portal_deals` (0312) menampilkan SEMUA `brand_deals` berstatus 'running' ke
-- setiap kreator yang login Portal Kreator, di menu "Merchant Deals":
--
--     where status = 'running' and auth_creator_id() is not null
--
-- Di live, 70 dari 77 baris running adalah hasil Import Master Deal yang BELUM
-- DILENGKAPI. Nama brand-nya nyata ("Staycationku Premium Villa", "Harris Hotel &
-- Conventions Gubeng", "Luminor Jember"), tetapi `kategori_poi` masih NULL — dan
-- bersamanya PIC, benefit, tanggal visit, lead_id, bd_id, ops_name juga kosong,
-- karena seluruh blok wajib di brand_deals_validate() memang baru menyala setelah
-- kategori_poi terisi.
--
-- Jadi yang dilihat kreator bukan sampah yang jelas-jelas sampah, melainkan 70
-- tawaran yang tampak sah tapi tidak punya kategori, brief, maupun jadwal visit —
-- justru lebih menyesatkan. Hanya 7 dari 77 yang benar-benar siap ditawarkan.
--
-- PERBAIKAN: hanya deal yang sudah dilengkapi yang boleh tampil. `kategori_poi`
-- adalah penanda kelengkapan yang sudah dipakai konsisten di seluruh sistem —
-- brand_deals_validate() (0333) baru menegakkan blok wajib POI begitu kolom ini
-- terisi, dan kedua tracker SOP (0336/0337) juga memfilter dengannya.
--
-- Kolom yang dikembalikan TIDAK diubah — tetap kolom aman yang sama seperti 0312
-- (tanpa komisi MEA / gmv_tap / service_fee). Ini murni penyempitan baris.
--
-- Aman diulang: `create or replace view` dengan daftar kolom identik.
-- =============================================================================

create or replace view v_portal_deals as
  select id, code, brand_name, niche, campaign_type, komisi_kreator_pct,
         kreators_needed, videos_needed, poi_location, deal_end, created_at
  from brand_deals
  where status = 'running'
    and kategori_poi is not null   -- baris Import Master Deal belum lengkap: sembunyikan
    and auth_creator_id() is not null;

comment on view v_portal_deals is
  'Merchant Deals portal kreator. Kolom terbatas (tanpa komisi MEA/gmv/fee). Hanya deal running YANG SUDAH DILENGKAPI (kategori_poi terisi) — stub Import Master Deal tidak ikut tampil. Hanya terbaca oleh sesi kreator.';

revoke all on v_portal_deals from public, anon;
grant select on v_portal_deals to authenticated;
