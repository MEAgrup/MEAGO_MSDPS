-- =============================================================================
-- MSDPS · MCN · Migration 0317 — GMV Video Weekly Tracking
-- =============================================================================
-- Pelacakan mingguan kinerja video per kreator dari export TikTok Creator
-- Analytics. Menyimpan metrik per-video (views, GMV, orders, engagement) dengan
-- window W1-W5 mingguan sama seperti creator_period_summary. Data stroom dari
-- ingest video → parser (strict header validation) → server action (resolve
-- creator, insert aggregates) → storage arsip JSON drop-raw.
-- =============================================================================

-- ---- Tabel: creator_video_gmv -----------------------------------------------
-- Agregat mingguan per video per kreator. Pola drop-raw: raw rows tidak
-- disimpan, hanya agregat mingguan.
create table if not exists creator_video_gmv (
  id                    bigserial primary key,
  creator_id            uuid not null references mcn_creators (id) on delete cascade,
  batch_id              text not null references upload_batches (batch_id) on delete cascade,

  -- Video identifiers
  video_id              text not null, -- TikTok video ID unik
  video_title           text,           -- Judul/deskripsi singkat video

  -- Period (sama W1-W5 seperti creator_period_summary)
  period_start          date not null,  -- Tanggal mulai minggu (Senin)
  period_end            date not null,  -- Tanggal akhir minggu (Minggu)

  -- Engagement metrics
  views                 bigint default 0,      -- Jumlah views video
  likes                 bigint default 0,      -- Jumlah likes
  comments              bigint default 0,      -- Jumlah komentar
  shares                bigint default 0,      -- Jumlah shares

  -- Commerce metrics
  sales_value           decimal(15, 2) default 0, -- GMV dalam IDR
  orders                integer default 0,         -- Jumlah order
  conversion_rate       decimal(5, 2) default 0,   -- Conversion % (0-100)

  -- Metadata
  created_at            timestamptz default now(),
  updated_at            timestamptz default now(),

  -- Constraint: satu video per minggu per batch
  unique (creator_id, video_id, period_start, batch_id)
);

comment on table creator_video_gmv is
  'Agregat mingguan metrik video per kreator dari export TikTok Creator Analytics.';
comment on column creator_video_gmv.video_id is
  'ID video TikTok unik dari export.';
comment on column creator_video_gmv.period_start is
  'Awal minggu W1-W5 (Senin). Validation lewat validateW1W5Period.';
comment on column creator_video_gmv.sales_value is
  'Gross Merchandise Value total minggu, dalam IDR.';
comment on column creator_video_gmv.conversion_rate is
  'Persentase konversi view → order (0-100).';

-- Index untuk query umum
create index creator_video_gmv_creator_id_period_idx
  on creator_video_gmv (creator_id, period_start desc);
create index creator_video_gmv_batch_id_idx
  on creator_video_gmv (batch_id);
create index creator_video_gmv_video_id_period_idx
  on creator_video_gmv (video_id, period_start desc);

-- ---- RLS Policies ----------------------------------------------------------
alter table creator_video_gmv enable row level security;

-- Policy: select — tim MCN bisa baca data sesama tim (via mcn_creators.owner_cpm_id)
create policy "select_own_team_video_gmv" on creator_video_gmv
  for select using (
    auth.uid() is not null and
    exists (
      select 1 from mcn_creators mc
      where mc.id = creator_video_gmv.creator_id
        and exists (
          select 1 from employees e
          where e.id = auth.uid()
            and e.id = mc.owner_cpm_id
        )
    )
  );

-- Policy: insert — service role (server action ingest)
create policy "insert_video_gmv_service" on creator_video_gmv
  for insert with check (auth.role() = 'service_role');

-- Policy: update — updated_at trigger saja
create policy "update_video_gmv_system" on creator_video_gmv
  for update using (false) with check (false); -- Tidak ada update manual

-- ---- Trigger: updated_at timestamp ------------------------------------------
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

-- ---- Cleanup retensi (extend dari 0315) -----
-- creator_video_gmv ditambahkan ke fungsi purge yang sudah ada.
-- (Fungsi sudah di-create di 0315, di-extend di sini via create or replace.)
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
