-- =============================================================================
-- MSDPS · MCN · Migration 0309 — Creator Analysis (identitas username-first)
-- =============================================================================
-- Format export TikTok yang nyata = "Creator Analysis" (1 baris = 1 kreator per
-- minggu), BUKAN per-produk. Interview user: username jadi KUNCI IDENTITAS;
-- simpan sales value + redemption; kota/level/binding di-sync sebagai info; alert
-- baru 'binding_lost' saat kreator lepas binding.
--   · mcn_creators   : + username/city/creator_level/binding_status. Keunikan
--                      pindah ke (platform, lower(username)); nama tampilan kini
--                      di-update otomatis dari file & boleh duplikat -> index
--                      nama lama jadi NON-UNIQUE (tetap untuk pencarian).
--   · creator_period_summary : + aov, redemption_amount, redeemed_orders,
--                      new_posts, posts_with_sales, live_streams, valid_live_streams.
--   · platform_alerts: alert_type + 'binding_lost'.
-- DORMAN (menunggu export list konten video, fase berikutnya — JANGAN di-drop):
--   kolom mcn_creators.jenis_creator/gmv_live/gmv_video dan
--   creator_period_summary.ctr/ctor/live_pct, serta tabel
--   creator_subcat_segment_gmv & creator_top_products.
-- =============================================================================

-- ---- mcn_creators: identitas username-first ---------------------------------
alter table mcn_creators
  add column username       text,
  add column city           text,
  add column creator_level  text,
  add column binding_status text;

-- Keunikan identitas pindah ke username (per platform, case-insensitive).
create unique index mcn_creators_platform_username_uniq
  on mcn_creators (platform, lower(username)) where username is not null;

-- Nama tampilan kini auto-update dari file & boleh duplikat: turunkan index nama
-- lama dari unik -> non-unik (tetap dipakai untuk pencarian).
drop index mcn_creators_platform_name_uniq;
create index mcn_creators_platform_name_idx on mcn_creators (platform, lower(name));

-- ---- creator_period_summary: sales value + redemption + aktivitas ------------
alter table creator_period_summary
  add column aov                numeric,
  add column redemption_amount  numeric,
  add column redeemed_orders    int,
  add column new_posts          int,
  add column posts_with_sales   int,
  add column live_streams       int,
  add column valid_live_streams int;

-- ---- platform_alerts: alert_type + 'binding_lost' ---------------------------
alter table platform_alerts drop constraint platform_alerts_alert_type_check;
alter table platform_alerts add constraint platform_alerts_alert_type_check
  check (alert_type in ('perf_drop','link_bocor','deal_expiring','binding_lost'));
