-- =============================================================================
-- MSDPS · MCN · Migration 0305 — Merchant Deals (`DEAL-…`) + produk + shop join
-- =============================================================================
-- brand_deals    : registrasi deal brand. code DEAL-YYYYMM-NNNN. shop_id UNIK
--                  bila terisi (partial unique index). merchant_id link OPSIONAL
--                  ke merchants M4 (brand luar cukup nama + shop id). deal_end
--                  di-set = exp_date oleh trigger. Lifecycle running/hold/done.
-- deal_products  : 1 deal → N produk (mewarisi niche/exp/komisi).
-- cooperating_shops: kunci join shop ber-deal. Disinkron OTOMATIS dari brand_deals
--                  (trigger AFTER INSERT/UPDATE): deal_end = exp_date,
--                  active_flag = exp_date >= today. Ditulis trigger SECURITY DEFINER.
-- + FK live_schedule_slots.deal_id → brand_deals(id).
-- =============================================================================

create table brand_deals (
  id                 uuid primary key default gen_random_uuid(),
  code               text unique,                                 -- DEAL-YYYYMM-NNNN
  brand_name         text not null,
  shop_id            text,                                        -- unik bila terisi (index bawah)
  merchant_id        uuid references merchants(id),               -- link opsional M4
  niche              text,
  brand_link         text,
  campaign_name      text,
  campaign_id        text,
  exp_date           date,
  deal_end           date,                                        -- = exp_date (trigger)
  komisi_kreator_raw text,
  komisi_kreator_pct numeric,
  komisi_mea_raw     text,
  komisi_mea_pct     numeric,
  pic_tap            uuid references employees(id),
  gmv_tap            numeric,
  avg_price          numeric,
  ads_budget         numeric,
  service_fee        numeric,
  campaign_type      text not null default 'paid'
                       check (campaign_type in ('paid','sample','extra_commission')),
  status             text not null default 'running'
                       check (status in ('running','hold','done')),
  priority           text,
  pipeline_stage     text not null default 'baru',
  review_flags       jsonb,
  sourced_by_role    text check (sourced_by_role in ('bd','cm')),
  notes              text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  status_changed_by  uuid,
  status_changed_at  timestamptz
);

-- shop_id UNIK hanya bila terisi (brand luar tanpa shop id boleh banyak null).
create unique index brand_deals_shop_uniq on brand_deals (shop_id) where shop_id is not null;
create index brand_deals_stage_idx on brand_deals (pipeline_stage);
create index brand_deals_merchant_idx on brand_deals (merchant_id);

create table deal_products (
  id                 uuid primary key default gen_random_uuid(),
  deal_id            uuid not null references brand_deals(id) on delete cascade,
  product_id         text,
  product_name       text not null,
  product_link       text,
  niche              text,
  exp_date           date,
  komisi_kreator_pct numeric,
  komisi_mea_pct     numeric,
  ads_budget         numeric,
  service_fee        numeric,
  status             text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now()
);

create index deal_products_deal_idx on deal_products (deal_id);

create table cooperating_shops (
  shop_id     text primary key,
  shop_name   text,
  deal_id     uuid references brand_deals(id) on delete set null,
  deal_start  date,
  deal_end    date,
  active_flag boolean not null default true
);

-- ---- brand_deals: validate + ID + deal_end sync -----------------------------
create or replace function brand_deals_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.brand_name is null or btrim(new.brand_name) = '' then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  -- deal_end mengikuti exp_date (single source of truth).
  new.deal_end := new.exp_date;
  if new.code is null then
    new.code := next_code('DEAL');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ---- Sinkron cooperating_shops (join shop ber-deal) -------------------------
create or replace function brand_deals_sync_shop()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.shop_id is not null and btrim(new.shop_id) <> '' then
    insert into cooperating_shops (shop_id, shop_name, deal_id, deal_start, deal_end, active_flag)
    values (
      new.shop_id, new.brand_name, new.id, new.created_at::date, new.exp_date,
      (new.exp_date is not null and new.exp_date >= current_date)
    )
    on conflict (shop_id) do update set
      shop_name   = excluded.shop_name,
      deal_id     = excluded.deal_id,
      deal_end    = excluded.deal_end,
      active_flag = excluded.active_flag;
  end if;
  return null;
end $$;

create trigger trg_brand_deals_validate before insert or update on brand_deals
  for each row execute function brand_deals_validate();
create trigger trg_brand_deals_status before update on brand_deals
  for each row execute function enforce_status_transition('brand_deal');
create trigger trg_brand_deals_audit after insert or update on brand_deals
  for each row execute function capture_audit('brand_deal');
create trigger trg_brand_deals_sync after insert or update on brand_deals
  for each row execute function brand_deals_sync_shop();

create trigger trg_deal_products_audit after insert or update on deal_products
  for each row execute function capture_audit('deal_product');
create trigger trg_cooperating_shops_audit after insert or update on cooperating_shops
  for each row execute function capture_audit('cooperating_shop');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('brand_deal','running','hold', null),
  ('brand_deal','hold','running', null),
  ('brand_deal','running','done', null),
  ('brand_deal','hold','done',    null);

-- ---- FK yang ditunda dari 0304 ----------------------------------------------
alter table live_schedule_slots
  add constraint live_schedule_slots_deal_fk
  foreign key (deal_id) references brand_deals(id) on delete set null;

-- ---- RLS --------------------------------------------------------------------
-- Baca: BizDev + CM + Account + mgmt. Tulis: BizDev + mgmt; CM boleh insert deal
-- self-sourced (sourced_by_role='cm').
alter table brand_deals enable row level security;
create policy brand_deals_select on brand_deals for select to authenticated
  using (is_od() or is_director()
         or auth_division() in ('BizDev','CreatorManagement','Account'));
create policy brand_deals_insert on brand_deals for insert to authenticated
  with check (
    is_od() or is_director() or auth_division() = 'BizDev'
    or (auth_division() = 'CreatorManagement' and sourced_by_role = 'cm')
  );
create policy brand_deals_update on brand_deals for update to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev');

alter table deal_products enable row level security;
create policy deal_products_select on deal_products for select to authenticated
  using (is_od() or is_director()
         or auth_division() in ('BizDev','CreatorManagement','Account'));
create policy deal_products_manage on deal_products for all to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','CreatorManagement'))
  with check (is_od() or is_director() or auth_division() in ('BizDev','CreatorManagement'));

alter table cooperating_shops enable row level security;
create policy cooperating_shops_select on cooperating_shops for select to authenticated
  using (is_od() or is_director()
         or auth_division() in ('BizDev','CreatorManagement','Account'));
-- Tulis via trigger SECURITY DEFINER; policy manage untuk koreksi manual BizDev/mgmt.
create policy cooperating_shops_manage on cooperating_shops for all to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev')
  with check (is_od() or is_director() or auth_division() = 'BizDev');

revoke execute on function brand_deals_validate()  from public, anon, authenticated;
revoke execute on function brand_deals_sync_shop() from public, anon, authenticated;
