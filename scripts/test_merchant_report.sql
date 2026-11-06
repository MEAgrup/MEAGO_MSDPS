-- =============================================================================
-- Uji Laporan Performa Merchant (migrasi 0378)
-- =============================================================================
-- Yang dikunci di sini:
--   (a) hanya is_merchant_report_staff() (BizDev, SPV CM, OD/Director, Account)
--       yang bisa menulis/membaca snapshot, params, notes; CM staff & Finance
--       ditolak/kosong; merchant tidak bisa SELECT tabel mentah;
--   (b) merchant_report_replace_month mengganti satu (lead, bulan) atomik — upload
--       ulang tidak menggandakan; data yang sama ke lead lain ditolak (lead induk);
--   (c) v_merchant_monthly / v_merchant_outlet_monthly / v_merchant_outlet_score
--       = rumus compute_metrics.py (dihitung tangan dari fixture di bawah);
--   (d) merchant_locations tersinkron (first_seen/last_seen lintas bulan);
--   (e) RPC portal hanya mengembalikan data lead milik akun merchant itu;
--   (f) anon tidak bisa memanggil RPC apa pun.
--
-- Cara pakai — lokal (butuh database hasil scripts/pg_test_reset.sh):
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -v ON_ERROR_STOP=1 \
--     -f scripts/test_merchant_report.sql
-- Staging: jalankan isi file apa adanya lewat SQL Editor / MCP execute_sql pada
-- vgjzvdpxrdoefoncuazw. JANGAN di production. Semua di-ROLLBACK di akhir.
-- =============================================================================
begin;

-- Hak yang di Supabase datang dari default privileges (stub lokal tidak punya).
grant usage on schema public to authenticated, anon;
grant select on employees to authenticated;
grant execute on function is_employee() to authenticated;
grant select, insert, update, delete on tiktok_post_snapshots, merchant_locations, merchant_report_params,
  merchant_report_notes to authenticated;
grant select on v_merchant_monthly, v_merchant_outlet_monthly, v_merchant_outlet_score, v_merchant_city,
  v_merchant_creator, v_merchant_top_posts to authenticated;

-- ---- Fixture ----------------------------------------------------------------
create temporary table t_actor (label text primary key, uid uuid) on commit drop;
insert into t_actor (label, uid) values
  ('od',         'c0000000-0000-4000-8000-000000000001'),
  ('bd',         'c0000000-0000-4000-8000-000000000002'),
  ('spv_cm',     'c0000000-0000-4000-8000-000000000003'),
  ('staff_cm',   'c0000000-0000-4000-8000-000000000004'),
  ('finance',    'c0000000-0000-4000-8000-000000000005'),
  ('merchant_a', 'c0000000-0000-4000-8000-000000000006'),
  ('merchant_b', 'c0000000-0000-4000-8000-000000000007');
grant select on t_actor to authenticated;
insert into auth.users (id, email) select uid, label || '@uji-mr.local' from t_actor;
insert into employees (id, full_name, division, rank, is_od, is_director, active) values
  ('c0000000-0000-4000-8000-000000000001','Uji OD',      'Marketing',        'staff',true, false,true),
  ('c0000000-0000-4000-8000-000000000002','Uji BD',      'BizDev',           'staff',false,false,true),
  ('c0000000-0000-4000-8000-000000000003','Uji SPV CM',  'CreatorManagement','lead', false,false,true),
  ('c0000000-0000-4000-8000-000000000004','Uji Staff CM','CreatorManagement','staff',false,false,true),
  ('c0000000-0000-4000-8000-000000000005','Uji Finance', 'Finance',          'staff',false,false,true);

create temporary table t_lead (label text primary key, id uuid) on commit drop;
grant select on t_lead to authenticated;
with a as (insert into leads (lead_name, phone_raw, source, brand_name)
           values ('Uji Sushi A', '081299990001', 'Website MEAGO', 'Uji Sushi A') returning id),
     b as (insert into leads (lead_name, phone_raw, source, brand_name)
           values ('Uji Brownies B', '081299990002', 'Website MEAGO', 'Uji Brownies B') returning id)
insert into t_lead select 'A', id from a union all select 'B', id from b;
update leads set crm_status = 'Dealing', benefit_dealing = 'uji' where id in (select id from t_lead);
insert into brand_deals (brand_name, lead_id, campaign_name, status)
  select 'Uji ' || label, id, 'Kampanye uji ' || label, 'running' from t_lead;
insert into merchant_portal_users (lead_id, auth_user_id)
  select (select id from t_lead where label = 'A'), 'c0000000-0000-4000-8000-000000000006'::uuid
  union all select (select id from t_lead where label = 'B'), 'c0000000-0000-4000-8000-000000000007'::uuid;

-- Baris Agustus (sudah diagregasi post × outlet oleh lib/merchant-report):
--   P1×L1 valid  GMV 100.000  2 order  red  80.000  views  1.000  post 2026-08-05 (new)
--   P1×L2 valid  GMV       0  0 order  red       0  views    500
--   P2×L1 valid  GMV 600.000 60 order  red 600.000  views 20.000  post 2026-07-20 (lama)
--   P3×L3 INVALID (tidak dihitung)
create temporary table t_payload (k text primary key, j jsonb) on commit drop;
grant select on t_payload to authenticated;
insert into t_payload values ('aug', '[
 {"post_id":"7600000000000000001","location_id":"4220001","row_seq":1,"post_title":"AYCE cuma 99rb","post_date":"2026-08-05","duration_sec":21,"task_type":"Others","status_valid":true,"location_name":"Uji Sushi A - Gatsu","location_name_display":"Gatsu","location_city":"Bandung","creator_username":"kre_a","creator_name":"Kre A","creator_level":"Lv.2","creator_city":"Bandung","creator_link_status":"Linked creators","sales_value":100000,"orders":2,"redemption_amount":80000,"redeemed_orders":2,"video_views":1000},
 {"post_id":"7600000000000000001","location_id":"4220002","row_seq":2,"post_title":"AYCE cuma 99rb","post_date":"2026-08-05","duration_sec":21,"task_type":"Others","status_valid":true,"location_name":"Uji Sushi A - Dago","location_name_display":"Dago","location_city":"Bandung","creator_username":"kre_a","creator_name":"Kre A","creator_level":"Lv.2","creator_city":"Bandung","creator_link_status":"Linked creators","sales_value":0,"orders":0,"redemption_amount":0,"redeemed_orders":0,"video_views":500},
 {"post_id":"7600000000000000002","location_id":"4220001","row_seq":3,"post_title":"review","post_date":"2026-07-20","duration_sec":30,"task_type":"Collaboration package","status_valid":true,"location_name":"Uji Sushi A - Gatsu","location_name_display":"Gatsu","location_city":"Bandung","creator_username":"KRE_B","creator_name":"Kre B","creator_level":"Lv.3","creator_city":"Depok","creator_link_status":null,"sales_value":600000,"orders":60,"redemption_amount":600000,"redeemed_orders":60,"video_views":20000},
 {"post_id":"7600000000000000003","location_id":"4220003","row_seq":4,"post_title":"x","post_date":"2026-08-10","duration_sec":15,"task_type":"Others","status_valid":false,"location_name":"Uji Sushi A - Pekanbaru","location_name_display":"Pekanbaru","location_city":"Pekanbaru","creator_username":"kre_c","creator_name":"Kre C","creator_level":null,"creator_city":null,"creator_link_status":null,"sales_value":999,"orders":9,"redemption_amount":0,"redeemed_orders":0,"video_views":9}
]'::jsonb),
('sep', '[
 {"post_id":"7600000000000000004","location_id":"4220001","row_seq":1,"post_title":"promo","post_date":"2026-09-02","duration_sec":12,"task_type":"Others","status_valid":true,"location_name":"Uji Sushi A - Gatsu Baru","location_name_display":"Gatsu Baru","location_city":"Bandung","creator_username":"kre_a","creator_name":"Kre A","creator_level":"Lv.2","creator_city":"Bandung","creator_link_status":"Linked creators","sales_value":50000,"orders":1,"redemption_amount":50000,"redeemed_orders":1,"video_views":100}
]'::jsonb);

-- ---- Mesin assertion (pola scripts/test_usage_page_views.sql) ----------------
create temporary table t_result (ok boolean, label text) on commit drop;
grant insert on t_result to authenticated;

create function pg_temp.expect(p_actor text, p_expect boolean, p_label text, p_sql text,
                               p_need_rows boolean default false)
returns void language plpgsql as $fn$
declare
  v_uid uuid; v_ok boolean; v_rows bigint := 0; v_detail text := '';
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', coalesce(v_uid::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  if p_actor = 'anon' then set local role anon; else set local role authenticated; end if;
  begin
    execute p_sql;
    get diagnostics v_rows = ROW_COUNT;
    if p_need_rows and v_rows = 0 then v_ok := false; v_detail := '0 baris';
    else v_ok := true; end if;
  exception when others then
    v_ok := false; v_detail := sqlerrm;
  end;
  reset role;
  insert into t_result (ok, label)
    values (v_ok = p_expect, p_actor || ' · ' || p_label ||
            case when v_ok = p_expect then '' else '  → ' || coalesce(nullif(v_detail,''),'(diterima, seharusnya ditolak)') end);
end $fn$;

create function pg_temp.expect_bool(p_label text, p_actual boolean, p_expected boolean default true)
returns void language sql as $fn$
  insert into t_result (ok, label)
  values (p_actual is not distinct from p_expected,
          p_label || case when p_actual is not distinct from p_expected then '' else '  → dapat ' || coalesce(p_actual::text,'NULL') end)
$fn$;

-- Jalankan query skalar boolean sebagai aktor.
create function pg_temp.as_bool(p_actor text, p_sql text) returns boolean language plpgsql as $fn$
declare v_uid uuid; v boolean;
begin
  select uid into v_uid from t_actor where label = p_actor;
  perform set_config('request.jwt.claim.sub', coalesce(v_uid::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into v; exception when others then v := null; end;
  reset role;
  return v;
end $fn$;

create function pg_temp.replace_sql(p_lead text, p_month text, p_payload text) returns text language sql as $fn$
  select format($q$select merchant_report_replace_month((select id from t_lead where label = %L), %L::date,
                'video_list_v1', 'UJI', (select j from t_payload where k = %L))$q$, p_lead, p_month, p_payload)
$fn$;

-- ---- (a)(b) Tulis snapshot ---------------------------------------------------
select pg_temp.expect('staff_cm', false, 'CM staff tidak bisa upload', pg_temp.replace_sql('A', '2026-08-01', 'aug'));
select pg_temp.expect('finance',  false, 'Finance tidak bisa upload',  pg_temp.replace_sql('A', '2026-08-01', 'aug'));
select pg_temp.expect('merchant_a', false, 'merchant tidak bisa upload', pg_temp.replace_sql('A', '2026-08-01', 'aug'));
select pg_temp.expect('bd', true, 'BizDev upload Agustus lead A', pg_temp.replace_sql('A', '2026-08-01', 'aug'));
select pg_temp.expect('spv_cm', true, 'SPV CM upload ulang Agustus (mengganti)', pg_temp.replace_sql('A', '2026-08-01', 'aug'));
select pg_temp.expect_bool('upload ulang tidak menggandakan (4 baris)',
  (select count(*) = 4 from tiktok_post_snapshots where lead_id = (select id from t_lead where label = 'A')));
select pg_temp.expect('bd', false, 'bulan bukan tanggal 1 ditolak', pg_temp.replace_sql('A', '2026-08-15', 'aug'));
select pg_temp.expect('bd', false, 'data sama ke lead B ditolak (lead induk)', pg_temp.replace_sql('B', '2026-08-01', 'aug'));
select pg_temp.expect_bool('penolakan lead B tidak menghapus data A',
  (select count(*) = 4 from tiktok_post_snapshots where lead_id = (select id from t_lead where label = 'A')));
select pg_temp.expect('od', true, 'OD upload September lead A', pg_temp.replace_sql('A', '2026-09-01', 'sep'));
select pg_temp.expect_bool('creator_username disimpan huruf kecil',
  (select count(*) = 1 from tiktok_post_snapshots where creator_username = 'kre_b'));
select pg_temp.expect_bool('period_end = akhir bulan',
  (select bool_and(period_end = '2026-08-31') from tiktok_post_snapshots where period_start = '2026-08-01'
     and lead_id = (select id from t_lead where label = 'A')));

-- ---- (a) Baca ------------------------------------------------------------------
select pg_temp.expect('spv_cm', true, 'SPV CM baca snapshot', 'select 1 from tiktok_post_snapshots', true);
select pg_temp.expect('staff_cm', false, 'CM staff: snapshot kosong (RLS)', 'select 1 from tiktok_post_snapshots', true);
select pg_temp.expect('merchant_a', false, 'merchant: snapshot mentah kosong', 'select 1 from tiktok_post_snapshots', true);
select pg_temp.expect('merchant_a', false, 'merchant: v_merchant_monthly kosong', 'select 1 from v_merchant_monthly', true);
select pg_temp.expect('anon', false, 'anon: tabel snapshot ditolak', 'select 1 from tiktok_post_snapshots');
select pg_temp.expect('bd', true, 'merchant_report_leads oleh BizDev', 'select * from merchant_report_leads(true)', true);
select pg_temp.expect('staff_cm', false, 'merchant_report_leads oleh CM staff ditolak', 'select * from merchant_report_leads(true)');
select pg_temp.expect('merchant_a', false, 'merchant_report_leads oleh merchant ditolak', 'select * from merchant_report_leads(true)');
select pg_temp.expect_bool('merchant_report_leads: lead A punya 2 bulan',
  pg_temp.as_bool('bd', $q$select months @> array['2026-08','2026-09'] and n_rows = 5 from merchant_report_leads(true)
                           where lead_id = (select id from t_lead where label = 'A')$q$));

-- ---- (c) Rumus = compute_metrics.py ---------------------------------------------
select pg_temp.expect_bool('Agu: GMV 700.000, order 62, views 21.500, redemption 680.000',
  (select gmv = 700000 and orders = 62 and views = 21500 and redemption = 680000
     from v_merchant_monthly where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect_bool('Agu: redemption rate & AOV & order/1k views',
  (select round(red_rate, 6) = round(680000/700000.0, 6) and round(aov, 4) = round(700000/62.0, 4)
          and round(order_per_1k, 6) = round(62/21.5, 6)
     from v_merchant_monthly where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect_bool('Agu: new post 1 (P2 bertanggal Juli), post aktif 2, GMV/post 350.000',
  (select new_posts = 1 and active_posts = 2 and gmv_per_post = 350000
     from v_merchant_monthly where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect_bool('Agu: outlet terlihat 2 (L3 hanya invalid), bertransaksi 1, >50 order 1',
  (select outlets_seen = 2 and outlets_active = 1 and outlets_gt_top = 1
     from v_merchant_monthly where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect_bool('Agu: creator aktif 2, ber-GMV 2 (kre_c invalid tidak dihitung)',
  (select creators_active = 2 and creators_gmv = 2
     from v_merchant_monthly where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect_bool('Agu: bucket 0 order = 1, >50 = 1, lainnya 0',
  (select b0 = 1 and b5 = 1 and b1 + b2 + b3 + b4 = 0
     from v_merchant_monthly where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect_bool('Sep: GMV 50.000, 1 outlet, bucket 1–5',
  (select gmv = 50000 and outlets_seen = 1 and b1 = 1
     from v_merchant_monthly where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-09-01'));
select pg_temp.expect_bool('outlet monthly: nama = baris pertama (Gatsu), kota Bandung',
  (select location_name = 'Gatsu' and city = 'Bandung' and new_posts = 1
     from v_merchant_outlet_monthly where lead_id = (select id from t_lead where label = 'A')
      and period_start = '2026-08-01' and location_id = '4220001'));
select pg_temp.expect_bool('skor outlet Agu: L1 = 1,0 Layer 1; L2 = 0 Layer 3',
  (select bool_and(case location_id when '4220001' then score = 1 and layer = 1 else score = 0 and layer = 3 end)
     from v_merchant_outlet_score where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect_bool('skor outlet Sep (n=1) = 1,0 seperti prank() Python',
  (select score = 1 and layer = 1 from v_merchant_outlet_score
    where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-09-01'));
select pg_temp.expect_bool('creator view: kre_b tidak bound (link kosong), kre_a bound',
  (select bool_and(case creator_username when 'kre_b' then not bound else bound end)
     from v_merchant_creator where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect_bool('top posts Agu: #1 = P2 (GMV 600.000), dedupe post P1',
  (select string_agg(post_id, ',' order by rank) = '7600000000000000002,7600000000000000001'
     from v_merchant_top_posts where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect_bool('kota: Bandung 2 outlet Agu',
  (select n_outlets = 2 from v_merchant_city where lead_id = (select id from t_lead where label = 'A')
      and period_start = '2026-08-01' and city = 'Bandung'));

-- ---- (d) merchant_locations --------------------------------------------------
select pg_temp.expect_bool('merchant_locations: 3 outlet lead A',
  (select count(*) = 3 from merchant_locations where lead_id = (select id from t_lead where label = 'A')));
select pg_temp.expect_bool('merchant_locations L1: first_seen Agu, last_seen Sep, nama terbaru',
  (select first_seen = '2026-08-01' and last_seen = '2026-09-30' and location_name_norm = 'Gatsu Baru'
     from merchant_locations where lead_id = (select id from t_lead where label = 'A') and location_id = '4220001'));

-- ---- Params & notes ----------------------------------------------------------
select pg_temp.expect('spv_cm', true, 'SPV CM simpan params', $q$insert into merchant_report_params (lead_id, kpi)
  values ((select id from t_lead where label = 'A'), '{"aov_min":65000,"red_min":0.9,"conv_min":0.45,"top2_max":0.4}')$q$);
select pg_temp.expect('spv_cm', false, 'bucket_edges tidak naik ditolak', $q$update merchant_report_params set bucket_edges = '{5,5,20,50}'
  where lead_id = (select id from t_lead where label = 'A')$q$);
select pg_temp.expect('bd', true, 'BizDev ubah bucket_edges {3,10,20,40}', $q$update merchant_report_params set bucket_edges = '{3,10,20,40}'
  where lead_id = (select id from t_lead where label = 'A')$q$, true);
select pg_temp.expect_bool('bucket mengikuti params (62 order > 40)',
  (select outlets_gt_top = 1 and b5 = 1 from v_merchant_monthly
    where lead_id = (select id from t_lead where label = 'A') and period_start = '2026-08-01'));
select pg_temp.expect('staff_cm', false, 'CM staff tidak bisa ubah params', $q$update merchant_report_params set low_red = 0.5
  where lead_id = (select id from t_lead where label = 'A')$q$, true);
select pg_temp.expect('bd', true, 'BizDev simpan insight', $q$insert into merchant_report_notes (lead_id, period_from, period_to, section_key, body)
  values ((select id from t_lead where label = 'A'), '2026-08-01', '2026-09-01', 'ins1', 'GMV Sep naik karena outlet Gatsu')$q$);
select pg_temp.expect('bd', false, 'section_key sembarang ditolak', $q$insert into merchant_report_notes (lead_id, period_from, period_to, section_key, body)
  values ((select id from t_lead where label = 'A'), '2026-08-01', '2026-09-01', 'judul', 'x')$q$);
select pg_temp.expect('staff_cm', false, 'CM staff tidak bisa simpan insight', $q$insert into merchant_report_notes (lead_id, period_from, period_to, section_key, body)
  values ((select id from t_lead where label = 'A'), '2026-08-01', '2026-09-01', 'ins2', 'x')$q$);

-- ---- Logo --------------------------------------------------------------------
select pg_temp.expect('bd', true, 'set logo path valid', $q$select merchant_report_set_logo((select id from t_lead where label = 'A'),
  (select id from t_lead where label = 'A')::text || '/logo-1.png')$q$);
select pg_temp.expect('bd', false, 'logo path lead lain ditolak', $q$select merchant_report_set_logo((select id from t_lead where label = 'A'),
  (select id from t_lead where label = 'B')::text || '/logo-1.png')$q$);
select pg_temp.expect('staff_cm', false, 'CM staff tidak bisa set logo', $q$select merchant_report_set_logo((select id from t_lead where label = 'A'), null)$q$);
select pg_temp.expect_bool('leads.logo_path tersimpan',
  (select logo_path like '%/logo-1.png' from leads where id = (select id from t_lead where label = 'A')));

-- ---- (e) Portal merchant -------------------------------------------------------
select pg_temp.expect_bool('portal A: 2 bulan performa milik A',
  pg_temp.as_bool('merchant_a', $q$select count(*) = 2 and bool_and(lead_id = (select id from t_lead where label = 'A'))
                                   from merchant_portal_performance('2026-08-01', '2026-09-30')$q$));
select pg_temp.expect_bool('portal A: rentang Sep saja = 1 bulan',
  pg_temp.as_bool('merchant_a', $q$select count(*) = 1 from merchant_portal_performance('2026-09-01', '2026-09-01')$q$));
select pg_temp.expect_bool('portal B: tidak melihat data A',
  pg_temp.as_bool('merchant_b', $q$select count(*) = 0 from merchant_portal_performance('2026-01-01', '2026-12-01')$q$));
select pg_temp.expect_bool('portal A: top outlet #1 = Gatsu, GMV periode 750.000',
  pg_temp.as_bool('merchant_a', $q$select outlet = 'Gatsu' and gmv = 750000 from merchant_portal_top_outlets('2026-08-01','2026-09-01', 1)$q$));
select pg_temp.expect_bool('portal B: top outlet kosong',
  pg_temp.as_bool('merchant_b', $q$select count(*) = 0 from merchant_portal_top_outlets('2026-08-01','2026-09-01', 10)$q$));
select pg_temp.expect_bool('portal A: insight tersimpan periode Agu–Sep terlihat',
  pg_temp.as_bool('merchant_a', $q$select count(*) = 1 from merchant_portal_report_notes('2026-08-01','2026-09-01')$q$));
select pg_temp.expect_bool('portal A: insight periode lain tidak ikut',
  pg_temp.as_bool('merchant_a', $q$select count(*) = 0 from merchant_portal_report_notes('2026-09-01','2026-09-01')$q$));
select pg_temp.expect_bool('portal B: insight A tidak terlihat',
  pg_temp.as_bool('merchant_b', $q$select count(*) = 0 from merchant_portal_report_notes('2026-08-01','2026-09-01')$q$));
select pg_temp.expect_bool('portal A: daftar bulan = Agu, Sep',
  pg_temp.as_bool('merchant_a', $q$select string_agg(period, ',' order by period) = '2026-08,2026-09' from merchant_portal_performance_months()$q$));
update leads set crm_status = 'Rejected' where id = (select id from t_lead where label = 'A');
select pg_temp.expect_bool('portal A: lead tidak closing lagi → kosong',
  pg_temp.as_bool('merchant_a', $q$select count(*) = 0 from merchant_portal_performance('2026-08-01', '2026-09-30')$q$));

-- ---- (f) anon ------------------------------------------------------------------
select pg_temp.expect('anon', false, 'anon: merchant_portal_performance ditolak', $q$select * from merchant_portal_performance('2026-08-01','2026-09-01')$q$);
select pg_temp.expect('anon', false, 'anon: merchant_report_replace_month ditolak', pg_temp.replace_sql('A', '2026-08-01', 'aug'));
select pg_temp.expect('anon', false, 'anon: merchant_report_leads ditolak', 'select * from merchant_report_leads(true)');

-- ---- Laporan ----------------------------------------------------------------
select case when ok then '  ok  ' else ' GAGAL' end as hasil, label from t_result order by ctid;

do $$
declare v_fail integer; v_total integer;
begin
  select count(*) filter (where not ok), count(*) into v_fail, v_total from t_result;
  if v_fail > 0 then
    raise exception '% dari % assertion GAGAL', v_fail, v_total;
  end if;
  raise notice '% assertion lolos, 0 gagal.', v_total;
end $$;

rollback;
