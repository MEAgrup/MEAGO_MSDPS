-- =============================================================================
-- MSDPS · MCN · Migration 0318 — creator_video_gmv: per KREATOR per minggu
-- =============================================================================
-- 0317 dirancang dengan asumsi export TikTok berisi baris per-VIDEO (video_id,
-- video_title). Setelah file export asli diperiksa ("Creator Analysis — PostOnly /
-- Managed Creators"), asumsi itu SALAH: satu baris = satu KREATOR untuk satu minggu,
-- tanpa kolom Video ID sama sekali. Metrik post sudah diagregasi oleh platform
-- (New posts, Posts with views, Video views, CTR, CVR, Avg. per post).
--
-- Karena itu tabel dibentuk ulang mengikuti data nyata. Tabel 0317 masih KOSONG di
-- semua environment saat migrasi ini dibuat, jadi drop-and-recreate aman dan tidak
-- ada data yang hilang. Riwayat migrasi dibiarkan forward-only (0317 tidak diedit)
-- supaya DB yang sudah menjalankan 0317 tetap konsisten dengan berkas migrasi.
--
-- Catatan angka: "Sales value" pada file PostOnly = GMV dari video/post (bukan live) —
-- inilah sumber "GMV Video Mingguan". CTR/CVR disimpan sebagai FRAKSI apa adanya dari
-- file (0.0427… = 4,27%); konversi ke persen hanya di lapisan tampilan.
-- =============================================================================

drop table if exists creator_video_gmv cascade;

create table creator_video_gmv (
  id                        bigserial primary key,
  creator_id                uuid not null references mcn_creators (id) on delete cascade,
  batch_id                  text not null references upload_batches (batch_id) on delete cascade,

  period_start              date not null,
  period_end                date not null,

  -- Metrik komersial (kolom "Sales value" dst pada sheet Data)
  sales_value               numeric,  -- GMV video/post minggu ini (IDR)
  orders                    integer,
  aov                       numeric,
  redemption_amount         numeric,
  redeemed_orders           integer,

  -- Metrik konten/post
  new_posts                 integer,
  posts_with_views          integer,
  posts_with_sales          integer,
  video_views               bigint,
  ctr                       numeric,  -- fraksi 0..1
  cvr                       numeric,  -- fraksi 0..1
  avg_views_per_post        numeric,
  avg_sales_value_per_post  numeric,

  -- Snapshot identitas saat minggu itu (informasi, master tetap di mcn_creators)
  binding_status            text,
  creator_level             text,
  city                      text,

  created_at                timestamptz default now(),
  updated_at                timestamptz default now(),

  -- Satu baris per (kreator, minggu). batch_id SENGAJA tidak masuk key: ingest memakai
  -- delete-then-insert per (kreator, period_start), jadi tanpa ini satu kreator bisa
  -- tersimpan dua kali untuk minggu yang sama lewat dua batch berbeda.
  unique (creator_id, period_start)
);

comment on table creator_video_gmv is
  'GMV & metrik post mingguan per kreator dari export TikTok Creator Analysis PostOnly (slice video/post, tanpa live). Satu baris = satu kreator per minggu.';
comment on column creator_video_gmv.sales_value is
  'Kolom "Sales value" file PostOnly = GMV dari video/post pada minggu tsb (IDR).';
comment on column creator_video_gmv.ctr is
  'Click-through rate sebagai FRAKSI (0.0427 = 4,27%), apa adanya dari file.';
comment on column creator_video_gmv.cvr is
  'Conversion rate sebagai FRAKSI (0.0143 = 1,43%), apa adanya dari file.';
comment on column creator_video_gmv.period_start is
  'Awal window W1-W5 (tidak lintas bulan). Divalidasi validateW1W5Period saat ingest.';

create index creator_video_gmv_creator_id_period_idx
  on creator_video_gmv (creator_id, period_start desc);
create index creator_video_gmv_period_start_idx
  on creator_video_gmv (period_start desc);
create index creator_video_gmv_batch_id_idx
  on creator_video_gmv (batch_id);

-- ---- RLS: pola tabel agregat mingguan lain (0303 cps_*/cssg_*/ctp_*) ---------
-- Ingest dijalankan sebagai user terautentikasi (BUKAN service-role), jadi policy
-- harus mengizinkan CreatorManagement + management. INSERT dan DELETE dua-duanya
-- wajib karena ingest memakai delete-then-insert saat memproses ulang periode sama.
alter table creator_video_gmv enable row level security;

create policy cvg_select on creator_video_gmv for select to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev','Acquisition'));
create policy cvg_insert on creator_video_gmv for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');
create policy cvg_delete on creator_video_gmv for delete to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement');
-- Sengaja TIDAK ada policy UPDATE: baris agregat hanya ditulis ulang lewat
-- delete-then-insert, tidak pernah di-patch di tempat.

drop trigger if exists creator_video_gmv_update_ts_trigger on creator_video_gmv;
create trigger creator_video_gmv_update_ts_trigger
  before update on creator_video_gmv
  for each row
  execute function creator_video_gmv_update_ts();

-- Fungsi purge sudah memangkas creator_video_gmv sejak 0317 (kolom period_start tetap
-- ada dengan nama & tipe yang sama), jadi tidak perlu diubah di sini.
