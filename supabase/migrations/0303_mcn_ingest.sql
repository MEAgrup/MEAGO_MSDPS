-- =============================================================================
-- MSDPS · MCN MEA Features · Migration 0303 — Ingest pipeline (upload batches & agregates)
-- =============================================================================
-- Process-on-ingest, drop-raw: only 3 aggregates stored, no raw rows in DB.
-- batch_id = "ingest:<periodStart>:<hash8>" for idempotent re-runs.
-- Unique per (creator, period_start, upload_batch) — batch can be re-run.
-- =============================================================================

create table upload_batches (
  id              uuid primary key default gen_random_uuid(),
  batch_id        text unique,                             -- "ingest:<start>:<hash8>"
  source_type     text not null default 'tiktok',
  uploaded_by     uuid references employees(id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  row_count_raw   integer,                                 -- rows in file (before filter)
  creators_count  integer,                                 -- unique creators in batch
  period_start    date,                                    -- W1 start date (1, 8, 15, 22, or 29)
  period_end      date,                                    -- W1 end date (7, 14, 21, 28, or last-of-month)
  file_hash       text,                                    -- sha256, 8-char prefix for batch_id
  status          text not null default 'staging' check (status in ('staging', 'processed', 'failed')),
  processed_at    timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);

comment on table upload_batches is 'Weekly data upload metadata. batch_id unique => idempotent.';

-- Weekly summary per creator (agregated from raw rows)
create table creator_period_summary (
  id                  uuid primary key default gen_random_uuid(),
  mcn_creator_id      uuid not null references mcn_creators(id) on delete cascade,
  period_start        date not null,                       -- W1-W5 start (1, 8, 15, 22, 29)
  period_end          date not null,
  upload_batch        text,                                -- references upload_batches.batch_id
  gmv_total           numeric,                             -- total GMV (all channels)
  affiliate_gmv       numeric,                             -- affiliate attribution GMV
  affiliate_live_gmv  numeric,                             -- live-only attribution GMV
  affiliate_video_gmv numeric,                             -- video-only attribution GMV
  live_orders         integer,
  video_orders        integer,
  orders              integer,                             -- total orders
  items_sold          integer,
  refund_gmv          numeric,
  ctr                 numeric,                             -- clickthrough rate (weighted by GMV)
  ctor                numeric,                             -- order rate (weighted by GMV)
  live_pct            numeric,                             -- % live vs total (null if div-0)
  created_at          timestamptz not null default now(),
  unique (mcn_creator_id, period_start, upload_batch)
);

comment on table creator_period_summary is 'Weekly agregated metrics per creator. drop-raw design.';

-- Breakdown by subcategory & price segment (for analysis)
create table creator_subcat_segment_gmv (
  id            uuid primary key default gen_random_uuid(),
  mcn_creator_id uuid not null references mcn_creators(id) on delete cascade,
  period_start  date not null,
  upload_batch  text,                                      -- references upload_batches.batch_id
  category_l2   text,                                      -- subcategory name
  price_segment text,                                      -- low, entry, sweet, high (null if no bound)
  gmv           numeric,
  items_sold    integer,
  created_at    timestamptz not null default now()
);

comment on table creator_subcat_segment_gmv is 'Ingest breakdown by category & price segment.';

-- Top N products (configurable, default 20)
create table creator_top_products (
  id            uuid primary key default gen_random_uuid(),
  mcn_creator_id uuid not null references mcn_creators(id) on delete cascade,
  period_start  date not null,
  upload_batch  text,                                      -- references upload_batches.batch_id
  product_id    text,
  product_name  text,
  shop_id       text,
  shop_name     text,
  gmv           numeric,
  items_sold    integer,
  rank          integer,                                   -- 1..N
  created_at    timestamptz not null default now()
);

comment on table creator_top_products is 'Top N products per creator-period. Rank deterministic.';

-- RLS: read for CM/BizDev/Acquisition/mgmt; write for CM/mgmt (pipeline delete+insert)
alter table upload_batches enable row level security;
alter table creator_period_summary enable row level security;
alter table creator_subcat_segment_gmv enable row level security;
alter table creator_top_products enable row level security;

create policy upload_batches_select on upload_batches
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition')
  );

create policy upload_batches_manage on upload_batches
  for all to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement')
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');

create policy summary_select on creator_period_summary
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition')
  );

create policy summary_manage on creator_period_summary
  for all to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement')
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');

create policy subcat_segment_select on creator_subcat_segment_gmv
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition')
  );

create policy subcat_segment_manage on creator_subcat_segment_gmv
  for all to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement')
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');

create policy top_products_select on creator_top_products
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('CreatorManagement', 'BizDev', 'Acquisition')
  );

create policy top_products_manage on creator_top_products
  for all to authenticated
  using (is_od() or is_director() or auth_division() = 'CreatorManagement')
  with check (is_od() or is_director() or auth_division() = 'CreatorManagement');

-- Audit logged at action level (upload_batches), not per row
create trigger trg_upload_batches_audit after insert or update on upload_batches
  for each row execute function capture_audit('ingest');
