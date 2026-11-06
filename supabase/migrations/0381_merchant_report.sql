-- =============================================================================
-- MSDPS · Laporan Performa Merchant · Migration 0381
-- =============================================================================
-- Kenapa ada: Yohan (2026-11-04) ingin laporan performa merchant TikTok Dining
-- model "Analisa Sushi Yay" dibuat OTOMATIS dari MSDPS, bulanan, periode dipilih
-- user, insight bisa diedit tim BD, logo merchant bisa di-upload. Rencana lengkap:
-- docs/HANDOFF_LAPORAN_MERCHANT.md. (Handoff menyebut nomor 0377 — 0377–0380 sudah
-- dipakai bridge CDPS, kontrak SPK, target GMV deal, dan fix review deal, jadi
-- migrasi ini 0381. Di staging sempat ter-apply dengan nama 0378_merchant_report.)
--
-- Sumber data satu-satunya: export TikTok GO "Content Analysis › Video List"
-- per bulan. Unit baris = post × outlet × bulan; baris pecahan dijumlahkan saat
-- ingest (lib/merchant-report/video-list.ts). tiktok_post_index (0346) TIDAK
-- diubah — tetap dipakai validasi bukti campaign.
--
-- Rumus metrik WAJIB sama dengan compute_metrics.py (sample yang disetujui).
-- Rumus utuh untuk periode bebas ada di lib/merchant-report/metrics.ts; view di
-- sini adalah versi PER BULAN dari rumus yang sama (dipakai portal merchant &
-- uji acceptance). Bila salah satu diubah, ubah keduanya.
--
-- Akses staf  : is_merchant_report_staff() = is_campaign_staff() (pola RLS
--               tiktok_post_index 0346/0358; sudah mencakup BizDev).
-- Akses merchant: hanya lewat RPC security definer merchant_portal_performance*
--               (pola whitelist 0374, filter auth_merchant_lead_ids()).
-- Idempoten.
-- =============================================================================

-- ---- 0. Helper wewenang ------------------------------------------------------
create or replace function is_merchant_report_staff() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(is_campaign_staff(), false)
$$;
comment on function is_merchant_report_staff() is
  'Wewenang Laporan Performa Merchant (upload export, generate, edit insight, logo): sama dengan is_campaign_staff() — OD, Director, BizDev, CampaignSpecialist, SPV Creator Management, Account. Cermin TS: lib/merchant-report/access.ts. Selalu boolean.';

-- ---- 1. Logo merchant --------------------------------------------------------
alter table leads add column if not exists logo_path text;
comment on column leads.logo_path is
  'Path objek logo merchant di bucket privat merchant-logos (PNG/JPG/SVG ≤1 MB). Ditampilkan lewat signed URL. Diisi lewat RPC merchant_report_set_logo (0381).';

insert into storage.buckets (id, name, public) values ('merchant-logos', 'merchant-logos', false)
on conflict (id) do nothing;
-- File export mentah di-upload browser langsung ke sini (signed upload URL) agar
-- tidak kena batas body server action/Vercel; server membaca lalu MENGHAPUSnya
-- setelah ingest (drop-raw). Tanpa policy storage.objects — pola 0312/0344.
insert into storage.buckets (id, name, public) values ('merchant-report-uploads', 'merchant-report-uploads', false)
on conflict (id) do nothing;

-- ---- 2. Outlet per lead ------------------------------------------------------
create table if not exists merchant_locations (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references leads(id) on delete cascade,
  location_id        text not null check (location_id ~ '^[0-9]+$'),
  location_name      text,
  location_name_norm text,
  city               text,
  region             text,
  first_seen         date,
  last_seen          date,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (lead_id, location_id)
);
comment on table merchant_locations is
  'Outlet (Location TikTok GO) milik satu lead/brand, disinkron otomatis tiap upload export Video List (0381). location_name_norm = nama tanpa awalan brand ("Sushi Yay! - Gatsu" -> "Gatsu").';

-- ---- 3. Snapshot post × outlet × bulan ---------------------------------------
create table if not exists tiktok_post_snapshots (
  post_id               text not null check (post_id ~ '^[0-9]+$'),
  location_id           text not null check (location_id ~ '^[0-9]+$'),
  period_start          date not null check (extract(day from period_start) = 1),
  period_end            date not null,
  lead_id               uuid not null references leads(id) on delete cascade,
  source_format         text not null check (source_format in ('video_list_v1','video_list_v2')),
  row_seq               integer not null,
  post_title            text,
  post_date             date,
  duration_sec          numeric,
  task_type             text,
  status_valid          boolean not null,
  location_name         text,
  location_name_display text,
  location_city         text,
  creator_username      text not null,
  creator_name          text,
  creator_level         text,
  creator_city          text,
  creator_link_status   text,
  sales_value           numeric not null default 0,
  orders                integer not null default 0,
  redemption_amount     numeric not null default 0,
  redeemed_orders       integer not null default 0,
  video_views           bigint  not null default 0,
  upload_batch          text,
  ingested_by           uuid default auth.uid(),
  ingested_at           timestamptz not null default now(),
  primary key (post_id, location_id, period_start),
  check (period_end = (period_start + interval '1 month' - interval '1 day')::date)
);
comment on table tiktok_post_snapshots is
  'Snapshot bulanan export "Content Analysis › Video List": 1 baris = post × outlet × bulan, baris pecahan sudah dijumlahkan. status_valid = Status "Valid posts" (hanya baris valid yang dihitung laporan). row_seq = urutan kemunculan pertama di file — dipakai agar "ambil baris pertama/terakhir" identik dengan compute_metrics.py. Ganti per (lead, bulan) atomik lewat merchant_report_replace_month. PK tanpa lead_id disengaja: data yang sama tidak bisa masuk ke dua lead (cegah double count lead ganda satu brand).';
create index if not exists tiktok_post_snapshots_lead_period_idx on tiktok_post_snapshots (lead_id, period_start, row_seq);
create index if not exists tiktok_post_snapshots_creator_idx on tiktok_post_snapshots (creator_username);

-- ---- 4. Parameter laporan per merchant ---------------------------------------
create table if not exists merchant_report_params (
  lead_id              uuid primary key references leads(id) on delete cascade,
  fx_by_month          jsonb not null default '{}'::jsonb,
  score_w_gmv          numeric not null default 0.4,
  score_w_red          numeric not null default 0.3,
  score_w_ord          numeric not null default 0.3,
  outlet_l1            numeric not null default 0.8,
  outlet_l2            numeric not null default 0.4,
  creator_l1           numeric not null default 0.9,
  creator_l2           numeric not null default 0.6,
  creator_l3_min_views integer not null default 1000,
  low_red              numeric not null default 0.6,
  dormant_days         integer not null default 60,
  bucket_edges         integer[] not null default '{5,10,20,50}',
  scenario             jsonb not null default '{"Konservatif":[0.85,0.95,1.0],"Moderat":[1.0,1.2,1.3],"Agresif":[1.15,1.5,1.7]}'::jsonb,
  kpi                  jsonb not null default '{"aov_min":60000,"red_min":0.9,"conv_min":0.45,"top2_max":0.4}'::jsonb,
  updated_by           uuid default auth.uid(),
  updated_at           timestamptz not null default now(),
  check (array_length(bucket_edges, 1) = 4
         and bucket_edges[1] > 0 and bucket_edges[1] < bucket_edges[2]
         and bucket_edges[2] < bucket_edges[3] and bucket_edges[3] < bucket_edges[4])
);
comment on table merchant_report_params is
  'Parameter laporan per lead (bobot skor, ambang layer, edges bucket order, pengali skenario, target KPI). Tanpa baris = default kolom (sama dengan sample). Skenario & KPI = asumsi staf, bukan data.';

-- ---- 5. Insight hasil edit tim BD --------------------------------------------
create table if not exists merchant_report_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  period_from date not null check (extract(day from period_from) = 1),
  period_to   date not null check (extract(day from period_to) = 1),
  section_key text not null check (section_key ~ '^ins[0-9]+$'),
  body        text not null check (length(body) <= 4000),
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  unique (lead_id, period_from, period_to, section_key),
  check (period_to >= period_from)
);
comment on table merchant_report_notes is
  'Teks insight yang diedit BD/CM per merchant + periode + blok (ins1..). TEKS POLOS (satu baris = satu poin) — sengaja bukan HTML supaya tidak ada jalur XSS staf→portal merchant. Tidak ada baris = teks otomatis. Ikut tampil di portal merchant.';

-- ---- 6. RLS ------------------------------------------------------------------
alter table merchant_locations enable row level security;
alter table tiktok_post_snapshots enable row level security;
alter table merchant_report_params enable row level security;
alter table merchant_report_notes enable row level security;

do $$
declare t text;
begin
  foreach t in array array['merchant_locations','tiktok_post_snapshots','merchant_report_params','merchant_report_notes'] loop
    execute format('drop policy if exists %1$s_select on %1$s', t);
    execute format('create policy %1$s_select on %1$s for select to authenticated using (is_merchant_report_staff())', t);
    execute format('drop policy if exists %1$s_insert on %1$s', t);
    execute format('create policy %1$s_insert on %1$s for insert to authenticated with check (is_merchant_report_staff())', t);
    execute format('drop policy if exists %1$s_update on %1$s', t);
    execute format('create policy %1$s_update on %1$s for update to authenticated using (is_merchant_report_staff()) with check (is_merchant_report_staff())', t);
    execute format('drop policy if exists %1$s_delete on %1$s', t);
    execute format('create policy %1$s_delete on %1$s for delete to authenticated using (is_merchant_report_staff())', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

-- ---- 7. Views per bulan (security_invoker) -----------------------------------
-- Semua dari baris status_valid. Rumus = compute_metrics.py untuk periode 1 bulan.
create or replace view v_merchant_outlet_monthly with (security_invoker = true) as
with s as (select * from tiktok_post_snapshots where status_valid),
o as (
  select s.lead_id, s.period_start, s.location_id,
         (array_agg(s.location_name_display order by s.row_seq)
            filter (where coalesce(s.location_name_display, '') <> ''))[1] as location_name,
         (array_agg(s.location_city order by s.row_seq)
            filter (where coalesce(s.location_city, '') <> ''))[1] as city,
         sum(s.sales_value) as gmv, sum(s.orders)::bigint as orders,
         sum(s.redemption_amount) as redemption, sum(s.video_views)::bigint as views,
         count(*) filter (where s.post_date between s.period_start and s.period_end) as new_posts
    from s group by 1, 2, 3)
select o.*,
       case when o.gmv > 0 then o.redemption / o.gmv else 0 end as red_rate,
       e.edges,
       case when o.orders = 0 then 0
            when o.orders <= e.edges[1] then 1 when o.orders <= e.edges[2] then 2
            when o.orders <= e.edges[3] then 3 when o.orders <= e.edges[4] then 4
            else 5 end as bucket
  from o
  cross join lateral (
    select coalesce((select p.bucket_edges from merchant_report_params p where p.lead_id = o.lead_id),
                    '{5,10,20,50}'::integer[]) as edges) e;
comment on view v_merchant_outlet_monthly is
  'Outlet × bulan: GMV/order/redemption/views/new post + bucket order (0 = 0 order, 1..4 = s/d edges[i], 5 = > edges[4]). Nama/kota = baris pertama (row_seq) yang tidak kosong. Rumus = compute_metrics.py.';

create or replace view v_merchant_monthly with (security_invoker = true) as
with s as (select * from tiktok_post_snapshots where status_valid),
m as (
  select lead_id, period_start, min(period_end) as period_end,
         sum(sales_value) as gmv, sum(orders)::bigint as orders,
         sum(video_views)::bigint as views, sum(redemption_amount) as redemption,
         count(distinct post_id) filter (where post_date between period_start and period_end) as new_posts,
         count(distinct post_id) as active_posts,
         count(distinct creator_username) as creators_active,
         count(distinct creator_username) filter (where sales_value > 0) as creators_gmv
    from s group by 1, 2),
ob as (
  select lead_id, period_start,
         count(*) as outlets_seen,
         count(*) filter (where orders > 0) as outlets_active,
         count(*) filter (where orders > edges[4]) as outlets_gt_top,
         count(*) filter (where bucket = 0) as b0, count(*) filter (where bucket = 1) as b1,
         count(*) filter (where bucket = 2) as b2, count(*) filter (where bucket = 3) as b3,
         count(*) filter (where bucket = 4) as b4, count(*) filter (where bucket = 5) as b5
    from v_merchant_outlet_monthly group by 1, 2)
select m.lead_id, m.period_start, m.period_end, m.gmv, m.orders, m.views, m.redemption,
       case when m.gmv > 0 then m.redemption / m.gmv else 0 end as red_rate,
       case when m.orders > 0 then m.gmv / m.orders else 0 end as aov,
       case when m.views > 0 then m.orders / (m.views / 1000.0) else 0 end as order_per_1k,
       m.new_posts, m.active_posts,
       case when m.active_posts > 0 then m.gmv / m.active_posts else 0 end as gmv_per_post,
       ob.outlets_seen, ob.outlets_active, m.creators_active, m.creators_gmv, ob.outlets_gt_top,
       ob.b0, ob.b1, ob.b2, ob.b3, ob.b4, ob.b5
  from m join ob using (lead_id, period_start);
comment on view v_merchant_monthly is
  'KPI bulanan per lead (baris valid saja): GMV, order, views, redemption, redemption rate, AOV, order/1.000 views, new post, post aktif, GMV/post, outlet terlihat/bertransaksi, creator aktif/ber-GMV, outlet > edges[4] (default >50), sebaran bucket b0..b5. Rumus = compute_metrics.py.';

create or replace view v_merchant_outlet_score with (security_invoker = true) as
with p as (
  select o.*,
         coalesce(pp.score_w_gmv, 0.4) wg, coalesce(pp.score_w_red, 0.3) wr, coalesce(pp.score_w_ord, 0.3) wo,
         coalesce(pp.outlet_l1, 0.8) l1, coalesce(pp.outlet_l2, 0.4) l2,
         count(*) over (partition by o.lead_id, o.period_start) n,
         percent_rank() over (partition by o.lead_id, o.period_start order by o.gmv) pr_gmv,
         percent_rank() over (partition by o.lead_id, o.period_start order by o.redemption) pr_red,
         percent_rank() over (partition by o.lead_id, o.period_start order by o.orders) pr_ord
    from v_merchant_outlet_monthly o
    left join merchant_report_params pp on pp.lead_id = o.lead_id),
sc as (
  -- percent_rank = (rank-1)/(n-1) = s.index(v)/(n-1) di compute_metrics.py; n=1 -> 1.0 di Python.
  select p.*, case when n > 1 then wg * pr_gmv + wr * pr_red + wo * pr_ord else wg + wr + wo end as score from p)
select lead_id, period_start, location_id, location_name, city, gmv, orders, redemption, views, red_rate,
       score, case when score >= l1 then 1 when score >= l2 then 2 else 3 end as layer
  from sc;
comment on view v_merchant_outlet_score is
  'Skor & layer outlet PER BULAN: 0,4·PR(GMV)+0,3·PR(redemption)+0,3·PR(order), PR = peringkat persentil (rank−1)/(n−1); Layer 1 ≥0,8, Layer 2 ≥0,4 (params). Untuk periode multi-bulan, skor dihitung ulang atas total periode di lib/merchant-report/metrics.ts.';

create or replace view v_merchant_city with (security_invoker = true) as
select lead_id, period_start, coalesce(nullif(city, ''), '(tanpa kota)') as city,
       sum(gmv) as gmv, sum(orders) as orders, sum(views) as views, count(*) as n_outlets,
       sum(gmv) / count(*) as gmv_per_outlet
  from v_merchant_outlet_monthly group by 1, 2, 3;
comment on view v_merchant_city is 'Kota × bulan: GMV, order, views, jumlah outlet, GMV per outlet.';

create or replace view v_merchant_creator with (security_invoker = true) as
select lead_id, period_start, creator_username,
       (array_agg(creator_name order by row_seq) filter (where coalesce(creator_name, '') <> ''))[1] as creator_name,
       sum(sales_value) as gmv, sum(orders)::bigint as orders, sum(redemption_amount) as redemption,
       sum(video_views)::bigint as views, count(distinct post_id) as posts,
       max(post_date) as last_post_date,
       bool_or(coalesce(creator_link_status, '') <> '') as bound
  from tiktok_post_snapshots where status_valid
 group by 1, 2, 3;
comment on view v_merchant_creator is
  'Creator × bulan: GMV, order, redemption, views, post unik, post terakhir, bound (Creator link status tidak kosong di bulan itu).';

create or replace view v_merchant_top_posts with (security_invoker = true) as
with r as (
  select s.*, row_number() over (partition by s.lead_id, s.period_start, s.post_id
                                  order by s.sales_value desc, s.row_seq) as rn_post
    from tiktok_post_snapshots s where s.status_valid),
t as (
  select r.*, row_number() over (partition by r.lead_id, r.period_start
                                 order by r.sales_value desc, r.row_seq) as rank
    from r where r.rn_post = 1)
select lead_id, period_start, rank, post_id, creator_username, location_name_display as outlet,
       left(post_title, 90) as title, video_views as views, sales_value as gmv, duration_sec
  from t where rank <= 6;
comment on view v_merchant_top_posts is 'Contoh post terbaik per bulan: 6 post unik (dedupe post_id) dengan GMV baris post×outlet tertinggi.';

revoke all on v_merchant_outlet_monthly, v_merchant_monthly, v_merchant_outlet_score, v_merchant_city,
  v_merchant_creator, v_merchant_top_posts from anon;

-- ---- 8. RPC staf -------------------------------------------------------------
-- Ganti isi satu (lead, bulan) secara atomik: hapus snapshot lama lalu sisipkan
-- baris baru + sinkron merchant_locations. SECURITY INVOKER: RLS tetap berlaku.
create or replace function merchant_report_replace_month(
  p_lead_id uuid, p_period_start date, p_source_format text, p_batch text, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare
  v_end date;
  v_n   integer;
begin
  if not is_merchant_report_staff() then
    raise exception '[tidak berwenang mengunggah data laporan merchant]' using errcode = '42501';
  end if;
  if p_period_start is null or extract(day from p_period_start) <> 1 then
    raise exception '[periode harus tanggal 1]' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception '[tidak ada baris untuk disimpan]' using errcode = 'check_violation';
  end if;
  v_end := (p_period_start + interval '1 month' - interval '1 day')::date;

  delete from tiktok_post_snapshots where lead_id = p_lead_id and period_start = p_period_start;

  begin
    insert into tiktok_post_snapshots (
      post_id, location_id, period_start, period_end, lead_id, source_format, row_seq,
      post_title, post_date, duration_sec, task_type, status_valid,
      location_name, location_name_display, location_city,
      creator_username, creator_name, creator_level, creator_city, creator_link_status,
      sales_value, orders, redemption_amount, redeemed_orders, video_views, upload_batch)
    select r.post_id, r.location_id, p_period_start, v_end, p_lead_id, p_source_format, r.row_seq,
           r.post_title, r.post_date, r.duration_sec, r.task_type, r.status_valid,
           r.location_name, r.location_name_display, r.location_city,
           lower(r.creator_username), r.creator_name, r.creator_level, r.creator_city, r.creator_link_status,
           coalesce(r.sales_value, 0), coalesce(r.orders, 0), coalesce(r.redemption_amount, 0),
           coalesce(r.redeemed_orders, 0), coalesce(r.video_views, 0), p_batch
      from jsonb_to_recordset(p_rows) as r(
        post_id text, location_id text, row_seq integer, post_title text, post_date date,
        duration_sec numeric, task_type text, status_valid boolean,
        location_name text, location_name_display text, location_city text,
        creator_username text, creator_name text, creator_level text, creator_city text,
        creator_link_status text, sales_value numeric, orders integer, redemption_amount numeric,
        redeemed_orders integer, video_views bigint);
  exception when unique_violation then
    raise exception '[sebagian post × outlet bulan % sudah tersimpan untuk lead lain — pastikan upload ke lead induk brand ini]',
      to_char(p_period_start, 'YYYY-MM') using errcode = 'unique_violation';
  end;
  get diagnostics v_n = row_count;

  insert into merchant_locations as ml (lead_id, location_id, location_name, location_name_norm, city, first_seen, last_seen)
  select p_lead_id, s.location_id,
         (array_agg(s.location_name order by s.row_seq) filter (where coalesce(s.location_name, '') <> ''))[1],
         (array_agg(s.location_name_display order by s.row_seq) filter (where coalesce(s.location_name_display, '') <> ''))[1],
         (array_agg(s.location_city order by s.row_seq) filter (where coalesce(s.location_city, '') <> ''))[1],
         p_period_start, v_end
    from tiktok_post_snapshots s
   where s.lead_id = p_lead_id and s.period_start = p_period_start
   group by s.location_id
  on conflict (lead_id, location_id) do update set
    location_name      = case when excluded.last_seen >= ml.last_seen then coalesce(excluded.location_name, ml.location_name) else ml.location_name end,
    location_name_norm = case when excluded.last_seen >= ml.last_seen then coalesce(excluded.location_name_norm, ml.location_name_norm) else ml.location_name_norm end,
    city               = case when excluded.last_seen >= ml.last_seen then coalesce(excluded.city, ml.city) else ml.city end,
    first_seen         = least(ml.first_seen, excluded.first_seen),
    last_seen          = greatest(ml.last_seen, excluded.last_seen),
    updated_at         = now();

  return v_n;
end $$;
comment on function merchant_report_replace_month(uuid, date, text, text, jsonb) is
  'Ganti snapshot satu (lead, bulan) atomik: delete + insert dari jsonb (baris sudah diagregasi post×outlet oleh lib/merchant-report/video-list.ts) + upsert merchant_locations. Security invoker — RLS staf berlaku. Bentrok PK dengan lead lain -> pesan "lead induk".';

-- Daftar lead untuk halaman laporan. leads RLS hanya BizDev/Marketing/mgmt,
-- sedangkan SPV CM & AM juga butuh nama brand -> definer, digerbang staf.
create or replace function merchant_report_leads(p_only_with_data boolean default true)
returns table (lead_id uuid, lead_code text, brand_name text, brand_category text, wilayah text,
               logo_path text, months text[], n_rows bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_merchant_report_staff() then
    raise exception '[tidak berwenang]' using errcode = '42501';
  end if;
  return query
  with d as (
    select s.lead_id, array_agg(distinct to_char(s.period_start, 'YYYY-MM')) as months, count(*) as n
      from tiktok_post_snapshots s group by s.lead_id)
  select l.id, l.code, coalesce(l.brand_name, l.lead_name), l.brand_category::text, l.wilayah,
         l.logo_path, coalesce(d.months, '{}'::text[]), coalesce(d.n, 0)
    from leads l left join d on d.lead_id = l.id
   where (not p_only_with_data) or d.lead_id is not null
   order by 3, 2;
end $$;

create or replace function merchant_report_set_logo(p_lead_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_merchant_report_staff() then
    raise exception '[tidak berwenang]' using errcode = '42501';
  end if;
  if p_path is not null and p_path !~ ('^' || p_lead_id::text || '/[A-Za-z0-9._-]+$') then
    raise exception '[path logo tidak valid]' using errcode = 'check_violation';
  end if;
  update leads set logo_path = p_path where id = p_lead_id;
  if not found then raise exception '[lead tidak ditemukan]' using errcode = 'no_data_found'; end if;
end $$;

revoke execute on function is_merchant_report_staff(), merchant_report_replace_month(uuid, date, text, text, jsonb),
  merchant_report_leads(boolean), merchant_report_set_logo(uuid, text) from public, anon;
grant execute on function is_merchant_report_staff(), merchant_report_replace_month(uuid, date, text, text, jsonb),
  merchant_report_leads(boolean), merchant_report_set_logo(uuid, text) to authenticated;

-- ---- 9. RPC portal merchant (whitelist, pola 0374) -----------------------------
-- Hanya angka performa agregat + insight yang SUDAH disimpan BD. Tidak pernah
-- keluar: data lead lain, nama/username kreator, judul post, catatan internal.
create or replace function merchant_portal_performance(p_from date, p_to date)
returns table (lead_id uuid, period text, gmv numeric, orders bigint, views bigint, redemption numeric,
               red_rate numeric, aov numeric, order_per_1k numeric, new_posts bigint, active_posts bigint,
               outlets_seen bigint, outlets_active bigint, creators_active bigint, creators_gmv bigint,
               outlets_gt_top bigint, b0 bigint, b1 bigint, b2 bigint, b3 bigint, b4 bigint, b5 bigint,
               bucket_edges integer[])
language sql stable security definer set search_path = public as $$
  select m.lead_id, to_char(m.period_start, 'YYYY-MM'), m.gmv, m.orders, m.views, m.redemption,
         m.red_rate, m.aov, m.order_per_1k, m.new_posts, m.active_posts, m.outlets_seen, m.outlets_active,
         m.creators_active, m.creators_gmv, m.outlets_gt_top, m.b0, m.b1, m.b2, m.b3, m.b4, m.b5,
         coalesce(p.bucket_edges, '{5,10,20,50}'::integer[])
    from v_merchant_monthly m
    left join merchant_report_params p on p.lead_id = m.lead_id
   where m.lead_id in (select auth_merchant_lead_ids())
     and m.period_start between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
   order by m.lead_id, m.period_start
$$;

create or replace function merchant_portal_top_outlets(p_from date, p_to date, p_limit integer default 10)
returns table (lead_id uuid, location_id text, outlet text, city text, gmv numeric, orders bigint,
               red_rate numeric)
language sql stable security definer set search_path = public as $$
  with o as (
    select lead_id, location_id,
           (array_agg(location_name order by period_start) filter (where location_name is not null))[1] as outlet,
           (array_agg(city order by period_start) filter (where city is not null))[1] as city,
           sum(gmv) as gmv, sum(orders)::bigint as orders, sum(redemption) as red
      from v_merchant_outlet_monthly
     where lead_id in (select auth_merchant_lead_ids())
       and period_start between date_trunc('month', p_from)::date and date_trunc('month', p_to)::date
     group by 1, 2)
  select lead_id, location_id, outlet, city, gmv, orders, case when gmv > 0 then red / gmv else 0 end
    from (select o.*, row_number() over (partition by lead_id order by gmv desc) rn from o) x
   where rn <= least(greatest(coalesce(p_limit, 10), 1), 50)
   order by lead_id, gmv desc
$$;

create or replace function merchant_portal_report_notes(p_from date, p_to date)
returns table (lead_id uuid, section_key text, body text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select n.lead_id, n.section_key, n.body, n.updated_at
    from merchant_report_notes n
   where n.lead_id in (select auth_merchant_lead_ids())
     and n.period_from = date_trunc('month', p_from)::date
     and n.period_to = date_trunc('month', p_to)::date
   order by n.lead_id, n.section_key
$$;

create or replace function merchant_portal_performance_months()
returns table (lead_id uuid, period text)
language sql stable security definer set search_path = public as $$
  select distinct s.lead_id, to_char(s.period_start, 'YYYY-MM')
    from tiktok_post_snapshots s
   where s.lead_id in (select auth_merchant_lead_ids()) and s.status_valid
   order by 1, 2
$$;

revoke execute on function merchant_portal_performance(date, date), merchant_portal_top_outlets(date, date, integer),
  merchant_portal_report_notes(date, date), merchant_portal_performance_months() from public, anon;
grant execute on function merchant_portal_performance(date, date), merchant_portal_top_outlets(date, date, integer),
  merchant_portal_report_notes(date, date), merchant_portal_performance_months() to authenticated;
