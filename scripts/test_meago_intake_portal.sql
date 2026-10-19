-- =============================================================================
-- Uji acceptance migrasi 0369–0374 (intake meago.id, Prospek Kreator, akses
-- portal, Merchant Portal). Jalankan di MSDPS Staging sebagai postgres
-- (SQL Editor / MCP). SEMUA dalam satu transaksi yang di-ROLLBACK — tidak ada
-- data tersisa. Identitas staf/kreator/merchant disimulasikan lewat
-- request.jwt.claims + SET LOCAL ROLE authenticated (RLS & auth.uid() aktif).
-- Output: satu baris per langkah (step, ok, detail). Semua ok = true → lulus.
-- =============================================================================
begin;

create temp table _t (n serial, step text, ok boolean, detail text);
grant all on _t to authenticated, anon;
grant usage on sequence _t_n_seq to authenticated, anon;

do $test$
declare
  u_acq   uuid := gen_random_uuid();
  u_cre   uuid := gen_random_uuid();
  u_m1    uuid := gen_random_uuid();
  u_m2    uuid := gen_random_uuid();
  u_bd    uuid := (select id from employees where division = 'BizDev' and rank = 'staff' and active limit 1);
  u_bd2   uuid := (select id from employees where division = 'BizDev' and rank = 'lead' and active limit 1);
  v_res   jsonb;
  v_pid   uuid;
  v_rej   uuid;
  v_cid   uuid;
  v_l1    uuid;
  v_l2    uuid;
  v_n     int;
  v_txt   text;
  h1 text := encode(sha256('tok-creator-1'::bytea), 'hex');
  h2 text := encode(sha256('tok-creator-2'::bytea), 'hex');
  h3 text := encode(sha256('tok-merchant-1'::bytea), 'hex');
  h4 text := encode(sha256('tok-merchant-2'::bytea), 'hex');
begin
  -- ---- setup (postgres) ----------------------------------------------------
  insert into auth.users (id, aud, role, email) values
    (u_acq, 'authenticated', 'authenticated', 'qa.acq@meago.test'),
    (u_cre, 'authenticated', 'authenticated', 'qa.kreator.flow@meago.test'),
    (u_m1,  'authenticated', 'authenticated', 'owner@qa-resto-a.test'),
    (u_m2,  'authenticated', 'authenticated', 'owner@qa-resto-b.test');
  insert into employees (id, full_name, division, rank) values (u_acq, 'QA Acquisition', 'Acquisition', 'staff');

  -- 1. Intake kreator baru
  v_res := meago_intake_apply(jsonb_build_object('event_id','t1','site','meago.id','wp_ref','qa-flow-k1','type','kreator',
    'contact', jsonb_build_object('nama','QA Flow','email','qa.kreator.flow@meago.test','whatsapp_raw','081200001111'),
    'fields', jsonb_build_object('tiktok_username','@QA_Flow_Kreator','niche','Kuliner','kota','Bandung','consent',true),
    'attribution', jsonb_build_object('cta_id','hero-kreator')));
  select id into v_pid from creator_prospects where wp_ref = 'qa-flow-k1';
  insert into _t(step, ok, detail) values ('intake kreator → 1 prospek [Baru]',
    v_pid is not null and (select status from creator_prospects where id = v_pid) = '[Baru]', v_res::text);

  -- 2. Kiriman ulang wp_ref sama → respons sama, tanpa baris baru
  insert into _t(step, ok, detail) values ('idempotensi: replay → respons sama, tidak ada baris baru',
    meago_intake_apply(jsonb_build_object('site','meago.id','wp_ref','qa-flow-k1','type','kreator',
      'contact', jsonb_build_object('nama','QA Flow','whatsapp_raw','081200001111'),
      'fields', jsonb_build_object('tiktok_username','qa_flow_kreator','consent',true))) = v_res
    and (select count(*) from creator_prospects where tiktok_username = 'qa_flow_kreator') = 1, null);

  -- 3. Username sudah ada & Bound → langsung [Bound] existing
  insert into mcn_creators (name, platform, username, binding_status) values ('QA Lama', 'tiktok', 'qa_lama_bound', 'Bound creators');
  v_res := meago_intake_apply(jsonb_build_object('site','meago.id','wp_ref','qa-flow-k2','type','kreator',
    'contact', jsonb_build_object('nama','QA Lama','whatsapp_raw','081200002222'),
    'fields', jsonb_build_object('tiktok_username','QA_LAMA_BOUND','consent',true)));
  insert into _t(step, ok, detail) values ('username sudah terdaftar → tetap [Baru], TIDAK ditautkan, ada label (0375)',
    (select status = '[Baru]' and not existing_bound and matched_mcn_creator_id is null
       from creator_prospects where wp_ref = 'qa-flow-k2') and (v_res->>'linked_existing')::boolean, v_res::text);

  -- 4. test:true → tidak menulis
  select count(*) into v_n from creator_prospects;
  v_res := meago_intake_apply(jsonb_build_object('site','meago.id','wp_ref','qa-flow-test','type','kreator','test',true,
    'contact', jsonb_build_object('nama','T','whatsapp_raw','081200009999'),
    'fields', jsonb_build_object('tiktok_username','qa_test_only','consent',true)));
  insert into _t(step, ok, detail) values ('test:true → validasi saja',
    (select count(*) from creator_prospects) = v_n and not exists (select 1 from web_intake_events where wp_ref = 'qa-flow-test'), v_res::text);

  -- ---- alur kreator sebagai Acquisition -------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_acq, 'role', 'authenticated')::text, true);
  set local role authenticated;

  insert into _t(step, ok, detail) values ('Acquisition melihat label "sudah terdaftar" hanya untuk username lama',
    exists (select 1 from creator_prospect_registered() r join creator_prospects p on p.id = r.prospect_id where p.wp_ref = 'qa-flow-k2')
    and not exists (select 1 from creator_prospect_registered() where prospect_id = v_pid), null);

  perform creator_prospect_set_status(v_pid, '[Dihubungi]');
  perform creator_prospect_set_status(v_pid, '[Proses Binding]');
  insert into _t(step, ok, detail) values ('Acquisition: [Baru]→[Dihubungi]→[Proses Binding]',
    (select status from creator_prospects where id = v_pid) = '[Proses Binding]', null);

  begin
    perform creator_prospect_set_status(v_pid, '[Bound]');
    insert into _t(step, ok, detail) values ('[Bound] ditolak bila belum tertaut', false, 'lolos — seharusnya ditolak');
  exception when others then
    insert into _t(step, ok, detail) values ('[Bound] ditolak bila belum tertaut', sqlerrm like '[belum bisa Bound%', sqlerrm);
  end;

  v_cid := creator_prospect_create_creator(v_pid);
  begin
    perform creator_prospect_set_status(v_pid, '[Bound]');
    insert into _t(step, ok, detail) values ('[Bound] ditolak bila binding_status belum Bound', false, 'lolos');
  exception when others then
    insert into _t(step, ok, detail) values ('[Bound] ditolak bila binding_status belum Bound', sqlerrm like '[belum bisa Bound%', sqlerrm);
  end;

  begin
    perform portal_invite_precheck('creator', v_pid);
    insert into _t(step, ok, detail) values ('Kirim Akses ditolak sebelum Bound', false, 'lolos');
  exception when others then
    insert into _t(step, ok, detail) values ('Kirim Akses ditolak sebelum Bound', true, sqlerrm);
  end;

  reset role;
  update mcn_creators set binding_status = 'Bound creators' where id = v_cid;   -- simulasi ingest binding TikTok GO
  set local role authenticated;

  perform creator_prospect_set_status(v_pid, '[Bound]');
  insert into _t(step, ok, detail) values ('[Bound] setelah binding_status = Bound creators',
    (select status from creator_prospects where id = v_pid) = '[Bound]', null);

  insert into acquisitions (mcn_creator_id, lead_source, binding_date) values (v_cid, 'inbound', current_date);
  perform creator_prospect_link_acquisition(v_pid, (select id from acquisitions where mcn_creator_id = v_cid));
  insert into _t(step, ok, detail) values ('Catat ACQ tertaut ke prospek',
    (select acquisition_id is not null from creator_prospects where id = v_pid), null);

  v_res := portal_grant_access('creator', v_pid, u_cre, h1);
  insert into _t(step, ok, detail) values ('Kirim Akses kreator: akun tertaut + undangan',
    (select auth_user_id from mcn_creators where id = v_cid) = u_cre, v_res::text);
  v_res := portal_grant_access('creator', v_pid, u_cre, h2);      -- kirim ulang
  reset role;
  insert into _t(step, ok, detail) values ('Kirim ulang → token lama di-revoke',
    (portal_invite_check(h1)->>'status') = 'revoked' and (portal_invite_check(h2)->>'status') = 'valid', null);

  -- ---- aktivasi (service role) ----------------------------------------------
  v_res := portal_invite_consume(h2);
  insert into _t(step, ok, detail) values ('Aktivasi: consume valid → used', (portal_invite_check(h2)->>'status') = 'used', v_res::text);
  begin
    perform portal_invite_consume(h2);
    insert into _t(step, ok, detail) values ('Token sekali pakai', false, 'dipakai dua kali');
  exception when others then
    insert into _t(step, ok, detail) values ('Token sekali pakai', true, sqlerrm);
  end;

  -- ---- Creator Portal: akses berdasar Bound ---------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_cre, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into _t(step, ok, detail) values ('Kreator Bound: auth_creator_id() terisi', auth_creator_id() = v_cid, null);
  reset role;
  update mcn_creators set binding_status = 'Previously bound creators' where id = v_cid;
  set local role authenticated;
  insert into _t(step, ok, detail) values ('Binding lepas → auth_creator_id() NULL (request berikutnya tertolak)',
    auth_creator_id() is null, null);
  select count(*) into v_n from creator_complaints;
  insert into _t(step, ok, detail) values ('Binding lepas → data portal (RLS) kosong', v_n = 0, null);
  reset role;

  -- ---- prospek Ditolak tidak bisa dapat akses -------------------------------
  perform meago_intake_apply(jsonb_build_object('site','meago.id','wp_ref','qa-flow-k3','type','kreator',
    'contact', jsonb_build_object('nama','QA Tolak','email','qa.tolak@meago.test','whatsapp_raw','081200003333'),
    'fields', jsonb_build_object('tiktok_username','qa_tolak','consent',true)));
  select id into v_rej from creator_prospects where wp_ref = 'qa-flow-k3';
  perform set_config('request.jwt.claims', json_build_object('sub', u_acq, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform creator_prospect_set_status(v_rej, '[Ditolak]');
    insert into _t(step, ok, detail) values ('[Ditolak] wajib alasan', false, 'lolos tanpa alasan');
  exception when others then
    insert into _t(step, ok, detail) values ('[Ditolak] wajib alasan', sqlerrm like '[alasan%', sqlerrm);
  end;
  perform creator_prospect_set_status(v_rej, '[Ditolak]', 'binding di agency lain');
  begin
    perform portal_grant_access('creator', v_rej, u_m2, encode(sha256('x'::bytea), 'hex'));
    insert into _t(step, ok, detail) values ('Prospek [Ditolak]: RPC Kirim Akses menolak', false, 'lolos');
  exception when others then
    insert into _t(step, ok, detail) values ('Prospek [Ditolak]: RPC Kirim Akses menolak', true, sqlerrm);
  end;
  begin
    perform creator_prospect_create_creator(v_rej);
    insert into _t(step, ok, detail) values ('Prospek [Ditolak]: tidak dibuatkan data kreator', false, 'lolos');
  exception when others then
    insert into _t(step, ok, detail) values ('Prospek [Ditolak]: tidak dibuatkan data kreator', true, sqlerrm);
  end;
  reset role;

  -- ---- merchant --------------------------------------------------------------
  v_res := meago_intake_apply(jsonb_build_object('site','meago.id','wp_ref','qa-flow-m1','type','dining',
    'contact', jsonb_build_object('nama','QA Owner A','email','owner@qa-resto-a.test','whatsapp_raw','081300001111'),
    'fields', jsonb_build_object('jabatan','Owner','nama_brand','QA Resto A','kategori','Restoran','kota','Bali','consent',true),
    'attribution', jsonb_build_object('cta_id','hero-merchant')));
  select id into v_l1 from leads where brand_name = 'QA Resto A';
  insert into _t(step, ok, detail) values ('intake merchant → leads [Pool] Website MEAGO tanpa BD',
    (select status = '[Pool]' and source = 'Website MEAGO' and bd_employee_id is null and crm_status = 'Leads'
       from leads where id = v_l1), v_res::text);
  v_res := meago_intake_apply(jsonb_build_object('site','meago.id','wp_ref','qa-flow-m1b','type','dining',
    'contact', jsonb_build_object('nama','QA Owner A','whatsapp_raw','+62 813-0000-1111'),
    'fields', jsonb_build_object('nama_brand','QA Resto A','consent',true)));
  insert into _t(step, ok, detail) values ('dedupe nomor WA → lead sama, catatan ditambah',
    (select count(*) from leads where brand_name = 'QA Resto A') = 1 and (v_res->>'linked_existing')::boolean
      and (select submissions from lead_web_attribution where lead_id = v_l1) = 2
      and (select cta_id from lead_web_attribution where lead_id = v_l1) = 'hero-merchant', v_res::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u_bd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform claim_website_lead(v_l1);
  perform set_config('request.jwt.claims', json_build_object('sub', u_bd2, 'role', 'authenticated')::text, true);
  begin
    perform claim_website_lead(v_l1);
    insert into _t(step, ok, detail) values ('Ambil Lead atomik (BD kedua ditolak)', false, 'lolos');
  exception when others then
    insert into _t(step, ok, detail) values ('Ambil Lead atomik (BD kedua ditolak)',
      sqlerrm like '%sudah diambil%' and (select bd_employee_id from leads where id = v_l1) = u_bd, sqlerrm);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u_bd, 'role', 'authenticated')::text, true);
  begin
    perform portal_invite_precheck('merchant', v_l1);
    insert into _t(step, ok, detail) values ('Merchant belum closing → Kirim Akses ditolak', false, 'lolos');
  exception when others then
    insert into _t(step, ok, detail) values ('Merchant belum closing → Kirim Akses ditolak', true, sqlerrm);
  end;
  reset role;

  -- closing: Dealing + brand_deals; merchant kedua sebagai pembanding RLS
  update leads set crm_status = 'Dealing', benefit_dealing = 'QA benefit' where id = v_l1;
  insert into brand_deals (brand_name, lead_id, campaign_name, status, komisi_mea_pct, service_fee, notes)
    values ('QA Resto A', v_l1, 'Kampanye QA A', 'running', 12.5, 999999, 'CATATAN INTERNAL A');
  insert into poi_dining_cycles (deal_id, cycle_no, period_start, period_end, total_gmv, actual_vt, report_status, report_link, notes)
    select id, 1, current_date - 14, current_date - 1, 1500000, 30, 'Approved', 'https://example.test/lap-a', 'internal' from brand_deals where lead_id = v_l1;
  perform meago_intake_apply(jsonb_build_object('site','meago.id','wp_ref','qa-flow-m2','type','hotel',
    'contact', jsonb_build_object('nama','QA Owner B','email','owner@qa-resto-b.test','whatsapp_raw','081300002222'),
    'fields', jsonb_build_object('nama_brand','QA Hotel B','consent',true)));
  select id into v_l2 from leads where brand_name = 'QA Hotel B';
  update leads set bd_employee_id = u_bd, crm_status = 'Dealing', benefit_dealing = 'QA' where id = v_l2;
  insert into brand_deals (brand_name, lead_id, campaign_name, status) values ('QA Hotel B', v_l2, 'Kampanye QA B', 'running');

  perform set_config('request.jwt.claims', json_build_object('sub', u_bd, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_res := portal_grant_access('merchant', v_l1, u_m1, h3);
  perform portal_grant_access('merchant', v_l2, u_m2, h4);
  insert into _t(step, ok, detail) values ('Kirim Akses merchant (BizDev) → merchant_portal_users aktif',
    exists (select 1 from merchant_portal_users where lead_id = v_l1 and auth_user_id = u_m1 and active), v_res::text);

  -- Akun karyawan tidak bisa dijadikan akun portal
  begin
    perform portal_grant_access('merchant', v_l1, u_bd2, encode(sha256('y'::bytea), 'hex'));
    insert into _t(step, ok, detail) values ('Email karyawan ditolak sebagai akun portal', false, 'lolos');
  exception when others then
    insert into _t(step, ok, detail) values ('Email karyawan ditolak sebagai akun portal', true, sqlerrm);
  end;
  reset role;

  -- ---- Merchant Portal sebagai merchant A ------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', u_m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into _t(step, ok, detail) values ('Merchant A: hanya brand sendiri',
    (select count(*) = 1 and bool_and(brand_name = 'QA Resto A') from merchant_portal_me()), null);
  insert into _t(step, ok, detail) values ('Merchant A: kampanye hanya miliknya',
    (select count(*) = 1 and bool_and(campaign_name = 'Kampanye QA A') from merchant_portal_campaigns()), null);
  select string_agg(distinct k, ',') into v_txt
    from merchant_portal_campaigns() c, jsonb_object_keys(to_jsonb(c)) k
   where k ~ '(komisi|service_fee|notes|review|nominal|benefit|budget|payout)';
  insert into _t(step, ok, detail) values ('Field internal tidak keluar dari RPC kampanye', v_txt is null, v_txt);
  insert into _t(step, ok, detail) values ('Laporan siklus + link hanya bila Approved',
    (select count(*) = 1 and bool_and(report_link is not null) from merchant_portal_cycles()), null);
  insert into _t(step, ok, detail) values ('GMV bulanan dari rekap siklus',
    (select count(*) >= 1 from merchant_portal_gmv_monthly()), null);
  select (select count(*) from brand_deals) + (select count(*) from leads) + (select count(*) from poi_dining_cycles)
       + (select count(*) from merchants) + (select count(*) from creator_prospects) + (select count(*) from web_intake_events)
    into v_n;
  insert into _t(step, ok, detail) values ('Merchant A: tabel internal tertutup (RLS)', v_n = 0, v_n::text);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', u_m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into _t(step, ok, detail) values ('Merchant B tidak melihat data merchant A',
    not exists (select 1 from merchant_portal_campaigns() where campaign_name = 'Kampanye QA A')
    and not exists (select 1 from merchant_portal_cycles()), null);
  reset role;

  -- Lead Rejected → akses merchant dicabut
  update leads set crm_status = 'Rejected' where id = v_l1;
  perform set_config('request.jwt.claims', json_build_object('sub', u_m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into _t(step, ok, detail) values ('Lead Rejected → Merchant Portal A kosong',
    not exists (select 1 from merchant_portal_me()) and not exists (select 1 from merchant_portal_campaigns()), null);
  reset role;
  insert into _t(step, ok, detail) values ('Lead Rejected → merchant_portal_users nonaktif',
    not (select active from merchant_portal_users where lead_id = v_l1 and auth_user_id = u_m1), null);

  -- ---- anon tidak bisa memanggil intake --------------------------------------
  set local role anon;
  begin
    perform meago_intake_apply('{}'::jsonb);
    insert into _t(step, ok, detail) values ('anon tidak bisa memanggil meago_intake_apply', false, 'lolos');
  exception when insufficient_privilege then
    insert into _t(step, ok, detail) values ('anon tidak bisa memanggil meago_intake_apply', true, sqlerrm);
  end;
  set local role authenticated;
  begin
    perform portal_invite_consume(h3);
    insert into _t(step, ok, detail) values ('authenticated tidak bisa consume token', false, 'lolos');
  exception when insufficient_privilege then
    insert into _t(step, ok, detail) values ('authenticated tidak bisa consume token', true, sqlerrm);
  end;
  reset role;

  -- ---- audit_log ---------------------------------------------------------------
  insert into _t(step, ok, detail)
  select 'audit_log mencatat transisi & aksi akses',
         bool_or(entity = 'creator_prospect' and action = 'STATUS_CHANGE' and actor = u_acq)
     and bool_or(entity = 'portal_invite' and action = 'INSERT' and actor = u_acq)
     and bool_or(entity = 'merchant_portal_user' and action = 'INSERT' and actor = u_bd)
     and bool_or(entity = 'lead' and action = 'UPDATE' and actor = u_bd)
     and bool_or(entity = 'mcn_creator' and action = 'UPDATE'),
         string_agg(distinct entity || ':' || action, ', ')
    from audit_log where at >= now();   -- now() = awal transaksi uji ini
end $test$;

select n, step, ok, detail from _t order by n;
rollback;
