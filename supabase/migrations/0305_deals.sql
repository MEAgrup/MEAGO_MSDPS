-- =============================================================================
-- MSDPS · MCN MEA Features · Migration 0305 — Deals & cooperating shops
-- =============================================================================
-- Brand deal master with optional M4 merchant link.
-- shop_id unique but nullable (for brands outside M4 scope).
-- Trigger syncs cooperating_shops for affiliation management.
-- =============================================================================

create table brand_deals (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,                        -- DEAL-YYYYMM-NNNN
  brand_name            text not null,
  shop_id               text unique,                        -- nullable; unique if present
  merchant_id           uuid references merchants(id) on delete set null,  -- optional M4 link
  niche                 text,
  brand_link            text,
  campaign_name         text,
  campaign_id           text,
  exp_date              date not null,
  deal_end              date,                               -- synced from exp_date via trigger
  komisi_kreator_raw    text,                               -- free format (e.g., "5-10%", "Rp50rb")
  komisi_kreator_pct    numeric,                            -- min % or single %, null if invalid
  komisi_mea_raw        text,
  komisi_mea_pct        numeric,
  pic_tap               uuid references employees(id) on delete set null,
  gmv_tap               numeric,
  avg_price             numeric,
  ads_budget            numeric,
  service_fee           numeric,
  campaign_type         text not null default 'paid' check (campaign_type in ('paid', 'sample', 'extra_commission')),
  status                text not null default 'running' check (status in ('running', 'hold', 'done')),
  priority              text,
  pipeline_stage        text default 'baru',
  review_flags          jsonb,                              -- import issues/warnings
  sourced_by_role       text check (sourced_by_role is null or sourced_by_role in ('bd', 'cm')),
  notes                 text,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  status_changed_by     uuid,
  status_changed_at     timestamptz
);

comment on table brand_deals is 'Merchant deal master. shop_id unique (nullable). Syncs cooperating_shops.';

create or replace function brand_deals_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.brand_name is null or btrim(new.brand_name) = '' then
    raise exception '[nama brand wajib diisi]' using errcode = 'check_violation';
  end if;

  if new.exp_date is null then
    raise exception '[tanggal expire wajib diisi]' using errcode = 'check_violation';
  end if;

  if new.code is null then
    new.code := next_code('DEAL');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  -- Auto-sync deal_end to exp_date
  new.deal_end := new.exp_date;

  return new;
end $$;

create trigger trg_brand_deals_validate before insert or update on brand_deals
  for each row execute function brand_deals_validate();
create trigger trg_brand_deals_status before update on brand_deals
  for each row execute function enforce_status_transition('brand_deal');
create trigger trg_brand_deals_audit after insert or update on brand_deals
  for each row execute function capture_audit('brand_deal');

-- Status transitions
insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('brand_deal', 'running', 'hold', null),
  ('brand_deal', 'hold', 'running', null),
  ('brand_deal', 'running', 'done', null),
  ('brand_deal', 'hold', 'done', null);

-- Deal products (1 deal → N products)
create table deal_products (
  id                  uuid primary key default gen_random_uuid(),
  deal_id             uuid not null references brand_deals(id) on delete cascade,
  product_id          text,
  product_name        text not null,
  product_link        text,
  niche               text,
  exp_date            date,
  komisi_kreator_pct  numeric,
  komisi_mea_pct      numeric,
  ads_budget          numeric,
  service_fee         numeric,
  status              text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now()
);

comment on table deal_products is 'Deal products (1:N). Inherit niche/exp/komisi from parent deal.';

create trigger trg_deal_products_audit after insert or update on deal_products
  for each row execute function capture_audit('deal_product');

-- Cooperating shops (sinkron dari brand_deals via trigger)
create table cooperating_shops (
  shop_id       text primary key,
  shop_name     text,
  deal_id       uuid references brand_deals(id) on delete set null,
  deal_start    date,
  deal_end      date,
  active_flag   boolean not null default true
);

comment on table cooperating_shops is 'Affiliate shop directory. Synced from brand_deals on insert/update.';

create or replace function brand_deals_sync_cooperating_shops()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.shop_id is not null then
    insert into cooperating_shops (shop_id, shop_name, deal_id, deal_start, deal_end, active_flag)
    values (new.shop_id, new.brand_name, new.id, current_date, new.deal_end, new.deal_end >= current_date)
    on conflict (shop_id) do update set
      deal_id = excluded.deal_id,
      deal_end = excluded.deal_end,
      active_flag = excluded.deal_end >= current_date;
  end if;
  return new;
end $$;

create trigger trg_brand_deals_sync_shops after insert or update on brand_deals
  for each row execute function brand_deals_sync_cooperating_shops();

-- Add FK from live_schedule_slots to brand_deals (backfill constraint)
alter table live_schedule_slots
  add constraint fk_live_schedule_deal_id
  foreign key (deal_id) references brand_deals(id) on delete set null;

-- RLS: select wide; write restricted
alter table brand_deals enable row level security;
alter table deal_products enable row level security;
alter table cooperating_shops enable row level security;

create policy brand_deals_select on brand_deals
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('BizDev', 'CreatorManagement', 'Account')
  );

create policy brand_deals_insert on brand_deals
  for insert to authenticated
  with check (
    is_od()
    or is_director()
    or auth_division() in ('BizDev', 'CreatorManagement')
  );

create policy brand_deals_update on brand_deals
  for update to authenticated
  using (
    is_od()
    or is_director()
    or (auth_division() = 'BizDev' and is_lead())
    or (auth_division() = 'CreatorManagement' and is_lead())
  )
  with check (
    is_od()
    or is_director()
    or (auth_division() = 'BizDev' and is_lead())
    or (auth_division() = 'CreatorManagement' and is_lead())
  );

create policy deal_products_select on deal_products
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('BizDev', 'CreatorManagement', 'Account')
  );

create policy deal_products_manage on deal_products
  for all to authenticated
  using (
    is_od()
    or is_director()
    or (auth_division() = 'BizDev' and is_lead())
    or (auth_division() = 'CreatorManagement' and is_lead())
  )
  with check (
    is_od()
    or is_director()
    or (auth_division() = 'BizDev' and is_lead())
    or (auth_division() = 'CreatorManagement' and is_lead())
  );

create policy cooperating_shops_select on cooperating_shops
  for select to authenticated using (
    is_od()
    or is_director()
    or auth_division() in ('BizDev', 'CreatorManagement', 'Account')
  );
