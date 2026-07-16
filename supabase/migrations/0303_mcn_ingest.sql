-- =============================================================================
-- MSDPS · MCN · Migration 0303 — Ingest Data Mingguan (drop-raw, 3 agregat)
-- =============================================================================
-- Upload data performa TikTok diproses saat ingest (process-on-ingest): baris
-- mentah TIDAK PERNAH masuk DB — hanya 3 tabel agregat. batch_id idempoten
-- 'ingest:<periodStart>:<hash8>'. Replace scoped per (creator × minggu) via
-- delete-then-insert dari server action. Audit dilakukan 1x per run di level
-- action (entity 'ingest', entity_id = upload_batches.id) — TANPA audit per baris.
-- =============================================================================

-- ---- Batch header -----------------------------------------------------------
create table upload_batches (
  id             uuid primary key default gen_random_uuid(),
  batch_id       text unique not null,                            -- ingest:<start>:<hash8>
  source_type    text not null default 'tiktok',
  uploaded_by    uuid default auth.uid(),
  uploaded_at    timestamptz not null default now(),
  row_count_raw  int,
  creators_count int,
  period_start   date,
  period_end     date,
  file_hash      text,
  status         text not null default 'staging' check (status in ('staging','processed','failed')),
  processed_at   timestamptz,
  error          text
);

create index upload_batches_period_idx on upload_batches (period_start, status);

-- Audit run ingest: 1x per event batch (INSERT staging + UPDATE processed/failed),
-- entity 'ingest', entity_id = upload_batches.id. audit_log hanya bisa ditulis via
-- trigger SECURITY DEFINER — action tidak boleh insert audit_log langsung.
create trigger trg_upload_batches_audit after insert or update on upload_batches
  for each row execute function capture_audit('ingest');

-- ---- Ringkasan performa per kreator × minggu --------------------------------
create table creator_period_summary (
  id                  uuid primary key default gen_random_uuid(),
  mcn_creator_id      uuid not null references mcn_creators(id) on delete cascade,
  period_start        date not null,
  period_end          date,
  upload_batch        text not null,
  gmv_total           numeric,
  affiliate_gmv       numeric,
  affiliate_live_gmv  numeric,
  affiliate_video_gmv numeric,
  live_orders         int,
  video_orders        int,
  orders              int,
  items_sold          int,
  refund_gmv          numeric,
  ctr                 numeric,
  ctor                numeric,
  live_pct            numeric,
  created_at          timestamptz not null default now(),
  unique (mcn_creator_id, period_start, upload_batch)
);

create index creator_period_summary_creator_idx on creator_period_summary (mcn_creator_id, period_start);

-- ---- GMV per subkategori (level-2) × segmen harga ---------------------------
create table creator_subcat_segment_gmv (
  id             uuid primary key default gen_random_uuid(),
  mcn_creator_id uuid not null references mcn_creators(id) on delete cascade,
  period_start   date not null,
  upload_batch   text not null,
  category_l2    text,
  price_segment  text,
  gmv            numeric,
  items_sold     int
);

create index creator_subcat_segment_idx on creator_subcat_segment_gmv (mcn_creator_id, period_start);

-- ---- Top-N produk (N dari app_config mcn.top_n_products) ---------------------
create table creator_top_products (
  id             uuid primary key default gen_random_uuid(),
  mcn_creator_id uuid not null references mcn_creators(id) on delete cascade,
  period_start   date not null,
  upload_batch   text not null,
  product_id     text,
  product_name   text,
  shop_id        text,
  shop_name      text,
  gmv            numeric,
  items_sold     int,
  rank           int
);

create index creator_top_products_creator_idx on creator_top_products (mcn_creator_id, period_start);

-- ---- RLS --------------------------------------------------------------------
-- Baca lebar (CM/BizDev/Acquisition + mgmt); tulis (insert/delete pipeline) CM + mgmt.
alter table upload_batches enable row level security;
create policy upload_batches_select on upload_batches for select to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev','Acquisition'));
create policy upload_batches_insert on upload_batches for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');
create policy upload_batches_update on upload_batches for update to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement');

alter table creator_period_summary enable row level security;
create policy cps_select on creator_period_summary for select to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev','Acquisition'));
create policy cps_insert on creator_period_summary for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');
create policy cps_delete on creator_period_summary for delete to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement');

alter table creator_subcat_segment_gmv enable row level security;
create policy cssg_select on creator_subcat_segment_gmv for select to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev','Acquisition'));
create policy cssg_insert on creator_subcat_segment_gmv for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');
create policy cssg_delete on creator_subcat_segment_gmv for delete to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement');

alter table creator_top_products enable row level security;
create policy ctp_select on creator_top_products for select to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev','Acquisition'));
create policy ctp_insert on creator_top_products for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');
create policy ctp_delete on creator_top_products for delete to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement');
