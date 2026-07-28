-- =============================================================================
-- MSDPS · MCN · Migration 0320 — GMV Video Mingguan (creator_video_gmv)
-- =============================================================================
-- Menyimpan GMV & metrik post mingguan per kreator dari export TikTok
-- "Creator Analysis — PostOnly / Managed Creators" (slice video/post, TANPA live).
-- Satu baris = satu KREATOR untuk satu minggu; file export tidak punya kolom
-- Video ID — metrik post sudah diagregasi oleh platform (New posts, Posts with
-- views, Video views, CTR, CVR, Avg. per post).
--
-- Jalur ini TERPISAH dari "Upload Data Mingguan" (0303 creator_period_summary)
-- yang memakai export performa biasa (yang punya kolom Live streams). Keduanya
-- berbagi upload_batches, dibedakan lewat source_type ('tiktok_video' vs 'tiktok')
-- dan namespace batch_id ('video:…' vs 'ingest:…').
--
-- Pola drop-raw sama seperti 0303/0315: file mentah tidak pernah dipersist —
-- hanya agregat mingguan ini + arsip JSON hasil render di bucket weekly-archives.
--
-- Catatan angka:
--   • "Sales value" pada file PostOnly = GMV dari video/post → kolom sales_value.
--   • CTR/CVR disimpan sebagai FRAKSI apa adanya dari file (0.0427 = 4,27%);
--     konversi ke persen hanya di lapisan tampilan.
--   • Sel kosong di file tetap NULL (bukan 0) — "tidak ada data" berbeda dari nol.
--
-- `drop table if exists` di awal membuat migrasi ini idempoten dan aman dijalankan
-- pada database yang sudah memakai bentuk rancangan awal (per-video). Tabel ini
-- belum pernah menampung data di environment mana pun saat migrasi dibuat.
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

  -- Snapshot identitas pada minggu itu (informasi; master tetap di mcn_creators)
  binding_status            text,
  creator_level             text,
  city                      text,

  created_at                timestamptz default now(),
  updated_at                timestamptz default now(),

  -- Satu baris per (kreator, minggu). batch_id SENGAJA tidak masuk key: ingest
  -- memakai delete-then-insert per (kreator, period_start), jadi tanpa ini satu
  -- kreator bisa tersimpan dua kali untuk minggu sama lewat dua batch berbeda.
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

-- ---- Trigger updated_at ------------------------------------------------------
create or replace function creator_video_gmv_update_ts()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists creator_video_gmv_update_ts_trigger on creator_video_gmv;
create trigger creator_video_gmv_update_ts_trigger
  before update on creator_video_gmv
  for each row
  execute function creator_video_gmv_update_ts();

-- ---- Retensi: ikutkan tabel ini ke purge bulanan (0315) ----------------------
-- Body sama dengan 0315 ditambah satu delete. Objek Storage tidak disentuh di sini
-- (Postgres tak bisa menghapus objek fisik) — itu tugas sweep server action.
create or replace function mcn_purge_expired_weekly_data()
returns void language plpgsql security definer set search_path = public as $$
declare
  months int;
  cutoff date;
begin
  months := coalesce(
    (select value::text::int from app_config where key = 'mcn.retention_months'),
    6);
  cutoff := current_date - make_interval(months => months);

  delete from creator_period_summary     where period_start < cutoff;
  delete from creator_subcat_segment_gmv where period_start < cutoff;
  delete from creator_top_products        where period_start < cutoff;
  delete from creator_video_gmv           where period_start < cutoff;
end $$;
