-- =============================================================================
-- MSDPS · MCN · migrasi 0383 — GMV per kategori (Dining/Accommodation/TTD/LIVE)
-- =============================================================================
-- Permintaan Rizal (CM Lead), ACC Yohan 2026-11-06: CM Workspace bisa melihat GMV
-- kreator per kategori — All / Dining / Accommodation / TTD / LIVE.
--
-- Export Creator Analysis TikTok TIDAK membawa kolom kategori; CM mengunduh export
-- yang sudah difilter per kategori di dashboard TikTok, lalu memilih kategorinya di
-- form "Upload Data Mingguan" (lib/mcn/gmv-category.ts).
--
-- Kenapa tabel TERPISAH, bukan kolom `category` di creator_period_summary:
-- semua pembaca lama (Growth W1-W5, perf_drop, rata-rata GMV master, portal
-- /kreator/performa) dedupe per (kreator, period_start) dengan "created_at terbaru
-- menang". Kalau baris Dining ikut tersimpan di sana, upload Dining sesudah All akan
-- MENGGANTIKAN angka total minggu itu di semua pembaca tsb. "All" tetap di
-- creator_period_summary (nol perubahan); kategori lain di tabel ini.
--
-- Pola tabel & RLS identik creator_period_summary (0303): ingest berjalan sebagai
-- user (bukan service-role), delete-then-insert per (kreator, period_start,
-- kategori); tanpa policy UPDATE. Portal kreator TIDAK diberi akses (belum diminta).
-- upload_batches +category (nullable, NULL = All / jalur lama) untuk audit batch.
-- =============================================================================

create table if not exists creator_period_category_summary (
  id                  uuid primary key default gen_random_uuid(),
  mcn_creator_id      uuid not null references mcn_creators(id) on delete cascade,
  category            text not null check (category in ('dining','accommodation','ttd','live')),
  period_start        date not null,
  period_end          date,
  upload_batch        text not null,
  affiliate_gmv       numeric,
  orders              int,
  aov                 numeric,
  redemption_amount   numeric,
  redeemed_orders     int,
  new_posts           int,
  posts_with_sales    int,
  live_streams        int,
  valid_live_streams  int,
  created_at          timestamptz not null default now(),
  unique (mcn_creator_id, category, period_start, upload_batch)
);

comment on table creator_period_category_summary is
  'Ringkasan Creator Analysis per kreator × minggu × kategori (Dining/Accommodation/TTD/LIVE). All tetap di creator_period_summary. (0383)';

create index if not exists cpcs_creator_cat_period_idx
  on creator_period_category_summary (mcn_creator_id, category, period_start);
create index if not exists cpcs_period_idx
  on creator_period_category_summary (period_start);

alter table creator_period_category_summary enable row level security;
create policy cpcs_select on creator_period_category_summary for select to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev','Acquisition'));
create policy cpcs_insert on creator_period_category_summary for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');
create policy cpcs_delete on creator_period_category_summary for delete to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement');

alter table upload_batches
  add column if not exists category text
    check (category is null or category in ('dining','accommodation','ttd','live'));
comment on column upload_batches.category is
  'Kategori export Creator Analysis (0383). NULL = All / jalur lama.';

-- Retensi: ikut purge mingguan (badan fungsi = versi 0352 + satu baris tabel baru).
create or replace function mcn_purge_expired_weekly_data()
returns void language plpgsql security definer set search_path = public as $fn$
declare
  months int;
  cutoff date;
begin
  months := coalesce(
    (select value::text::int from app_config where key = 'mcn.retention_months'),
    6);
  cutoff := current_date - make_interval(months => months);

  delete from creator_period_summary          where period_start < cutoff;
  delete from creator_period_category_summary where period_start < cutoff;
  delete from creator_subcat_segment_gmv      where period_start < cutoff;
  delete from creator_top_products             where period_start < cutoff;
  delete from creator_video_gmv                where period_start < cutoff;
end $fn$;

-- create or replace mempertahankan privilege; dinyatakan ulang supaya eksplisit (0315).
revoke execute on function mcn_purge_expired_weekly_data() from public, anon, authenticated;
