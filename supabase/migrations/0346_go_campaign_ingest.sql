-- =============================================================================
-- MSDPS · Fase G.5 · Migration 0346 — Ingest export TikTok + validasi bukti
-- =============================================================================
-- Lanjutan G.1-G.4 (0341-0345). Cakupan G.5 (docs/HANDOFF_FaseG.md §6):
-- tiktok_post_index GLOBAL (PK post_id), validate_campaign_posts() dengan
-- urutan verdict tetap, view v_campaign_result (guard div-0). Parser sudah
-- siap (lib/mcn/content-analysis.ts, format "Content Analysis › Video List").
--
-- Kenapa GLOBAL (bukan per-campaign): satu file export TikTok berisi post
-- dari BANYAK campaign/merchant sekaligus, dan post yang sama muncul lagi di
-- export minggu berikutnya dengan angka GMV/views yang bertambah (kumulatif).
-- Index global di-upsert per post_id (angka terbaru menang) — merchant mana
-- yang berhak atas post tertentu diputuskan saat VALIDASI
-- (validate_campaign_posts), bukan saat ingest.
-- =============================================================================

-- ---- 1. tiktok_post_index (GLOBAL, PK post_id) ------------------------------
create table tiktok_post_index (
  post_id               text primary key,
  post_title            text,
  post_date             date not null,
  duration_sec          integer,
  status                text check (status in ('valid','invalid')),
  task_type             text,
  creator_type          text,
  location_id           text not null,
  location_name         text,
  location_city         text,
  location_industry     text,
  creator_username      text not null,
  creator_name          text,
  creator_city          text,
  creator_level         text,
  sales_value           numeric,
  orders                integer,
  redemption_amount     numeric,
  redeemed_orders       integer,
  video_views           integer,
  ctr                   numeric,
  cvr                   numeric,
  aov                   numeric,
  video_completion_rate numeric,
  like_rate             numeric,
  comment_rate          numeric,
  ingested_at           timestamptz not null default now(),
  ingested_by           uuid
);

comment on table tiktok_post_index is
  'Index GLOBAL semua post dari export TikTok "Content Analysis › Video List" (lib/mcn/content-analysis.ts), PK post_id — TIDAK per-campaign. Di-upsert setiap ingest (angka terbaru menang, GMV/views TikTok kumulatif bertambah tiap minggu). Kepemilikan merchant/kreator diputuskan saat validate_campaign_posts(), bukan di sini.';

create index tiktok_post_index_location_idx on tiktok_post_index (location_id);
create index tiktok_post_index_creator_idx on tiktok_post_index (lower(creator_username));
create index tiktok_post_index_date_idx on tiktok_post_index (post_date);

alter table tiktok_post_index enable row level security;
create policy tiktok_post_index_select on tiktok_post_index for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account'));
create policy tiktok_post_index_upsert on tiktok_post_index for insert to authenticated
  with check (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account'));
create policy tiktok_post_index_update on tiktok_post_index for update to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account'));

-- ---- 2. Verdict per submission (kolom baru di campaign_video_submissions) --
alter table campaign_video_submissions
  add column tiktok_verdict text check (tiktok_verdict in
    ('tidak_ditemukan','di_luar_periode','merchant_tidak_sesuai','bukan_milik_kreator','ditolak_tiktok','duplikat','valid')),
  add column tiktok_verdict_at timestamptz;

comment on column campaign_video_submissions.tiktok_verdict is
  'Diisi validate_campaign_posts() — urutan prioritas TETAP: tidak_ditemukan → di_luar_periode → merchant_tidak_sesuai → bukan_milik_kreator → ditolak_tiktok → duplikat → valid. NULL = belum pernah divalidasi.';

-- ---- 3. validate_campaign_posts(): cocokkan submission vs tiktok_post_index
create or replace function validate_campaign_posts(p_deal_id uuid)
returns table(verdict text, cnt integer)
language plpgsql security definer set search_path = public as $$
declare
  v_deal brand_deals%rowtype;
  r      record;
  v_verdict text;
begin
  select * into v_deal from brand_deals where id = p_deal_id and campaign_enabled;
  if v_deal.id is null then
    raise exception '[campaign tidak ditemukan]' using errcode = 'check_violation';
  end if;
  if not (is_od() or is_director() or auth_division() in ('BizDev','CampaignSpecialist','Account')) then
    raise exception '[tidak berwenang menjalankan validasi bukti]' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select s.id as submission_id, s.post_id, s.is_duplicate,
           lower(c.username) as creator_username,
           t.location_id, t.post_date, t.status as tiktok_status,
           lower(t.creator_username) as tiktok_creator_username
    from campaign_video_submissions s
    join campaign_participants p on p.id = s.participant_id
    join mcn_creators c on c.id = p.mcn_creator_id
    left join tiktok_post_index t on t.post_id = s.post_id
    where p.deal_id = p_deal_id
  loop
    if r.post_id is null or r.location_id is null then
      -- Belum ada di export TikTok manapun yang sudah di-ingest.
      v_verdict := 'tidak_ditemukan';
    elsif (v_deal.post_window_start is not null and r.post_date < v_deal.post_window_start)
       or (v_deal.post_window_end   is not null and r.post_date > v_deal.post_window_end) then
      v_verdict := 'di_luar_periode';
    elsif v_deal.target_location_id is not null and r.location_id <> v_deal.target_location_id then
      v_verdict := 'merchant_tidak_sesuai';
    elsif r.creator_username is distinct from r.tiktok_creator_username then
      v_verdict := 'bukan_milik_kreator';
    elsif r.tiktok_status = 'invalid' then
      v_verdict := 'ditolak_tiktok';
    elsif r.is_duplicate then
      v_verdict := 'duplikat';
    else
      v_verdict := 'valid';
    end if;

    update campaign_video_submissions
      set tiktok_verdict = v_verdict, tiktok_verdict_at = now()
      where id = r.submission_id;
  end loop;

  return query
    select s.tiktok_verdict, count(*)::integer
    from campaign_video_submissions s
    join campaign_participants p on p.id = s.participant_id
    where p.deal_id = p_deal_id
    group by s.tiktok_verdict;
end $$;

comment on function validate_campaign_posts(uuid) is
  'RPC "Validasi Bukti" per campaign. Urutan verdict TETAP (lihat komentar kolom tiktok_verdict). Boleh dijalankan berkali-kali (idempoten per submission — verdict lama ditimpa verdict terbaru berdasarkan tiktok_post_index saat ini).';

revoke execute on function validate_campaign_posts(uuid) from public, anon;
grant execute on function validate_campaign_posts(uuid) to authenticated;

-- ---- 4. v_campaign_result: GMV/views/ROAS dari post valid, guard div-0 -----
-- Idiom rumah numerator / nullif(denominator,0) (0104_module2_marketing.sql:70-73,
-- 0333_deal_transaction_validate.sql:107) — pembagi nol -> NULL, BUKAN 0.
create view v_campaign_result
  with (security_invoker = true) as
  select
    d.id                                                                    as deal_id,
    d.code,
    d.brand_name,
    count(*) filter (where s.tiktok_verdict = 'valid')                      as valid_posts,
    count(*) filter (where s.tiktok_verdict is not null
                        and s.tiktok_verdict <> 'valid')                    as invalid_posts,
    coalesce(sum(t.sales_value) filter (where s.tiktok_verdict = 'valid'), 0)  as total_gmv,
    coalesce(sum(t.video_views) filter (where s.tiktok_verdict = 'valid'), 0)  as total_views,
    coalesce(ads.total_ads_spend, 0)                                        as total_ads_spend,
    round(
      coalesce(sum(t.sales_value) filter (where s.tiktok_verdict = 'valid'), 0)
        / nullif(coalesce(ads.total_ads_spend, 0), 0), 2
    ) as roas,
    round(
      coalesce(sum(t.sales_value) filter (where s.tiktok_verdict = 'valid'), 0)
        / nullif(count(*) filter (where s.tiktok_verdict = 'valid'), 0), 2
    ) as gmv_per_valid_post
  from brand_deals d
  left join campaign_participants p on p.deal_id = d.id
  left join campaign_video_submissions s on s.participant_id = p.id
  left join tiktok_post_index t on t.post_id = s.post_id
  left join v_campaign_ads_spend_summary ads on ads.deal_id = d.id
  where d.campaign_enabled
  group by d.id, d.code, d.brand_name, ads.total_ads_spend;

comment on view v_campaign_result is
  'Rekap hasil campaign dari post valid (post_id yang lolos validate_campaign_posts). roas/gmv_per_valid_post NULL (bukan 0) kalau pembaginya nol — belum ada ads spend/belum ada post valid berarti "belum diketahui", bukan "nol performa". security_invoker=true -> tunduk RLS brand_deals/campaign_participants/campaign_video_submissions pemanggil (kreator otomatis tidak melihat apa pun lewat view ini karena brand_deals tidak punya policy select kreator).';
