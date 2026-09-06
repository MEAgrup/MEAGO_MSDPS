-- WAJIB TEST — v_poi_deal_realisasi & v_poi_deal_summary (migrasi 0355 + 0356).
--
-- Kenapa ada: kedua view inilah satu-satunya sumber angka Papan Skor BD
-- (app/(app)/bizdev/skor). Rumus poin TIDAK diduplikasi di TypeScript, jadi
-- kebenaran halaman itu sepenuhnya bergantung pada kebenaran view di sini.
-- Dua bug 0355 (view nol baris karena `cross join`, dan poin penuh untuk data
-- kosong karena `least()` mengabaikan NULL) lolos review dan hanya ketemu
-- karena dijalankan terhadap skenario sintetis — file ini mengabadikan
-- skenario itu supaya keduanya tidak bisa kembali tanpa terdeteksi.
--
-- Pakai:
--   bash scripts/pg_test_reset.sh
--   psql -h /tmp -p 55432 -U postgres -d msdps_reset -v ON_ERROR_STOP=1 -f scripts/test_poi_skor_views.sql
--
-- Seluruh isi dijalankan dalam transaksi yang DI-ROLLBACK — tidak meninggalkan
-- baris apa pun. Jangan pernah dijalankan terhadap production/staging.

\set ON_ERROR_STOP on
begin;

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ops.uji@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'bd.satu@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'bd.dua@example.test');

insert into employees (id, full_name, division) values
  ('11111111-1111-1111-1111-111111111111', 'Ops Uji',  'BizDev'),
  ('22222222-2222-2222-2222-222222222222', 'BD Satu',  'BizDev'),
  ('33333333-3333-3333-3333-333333333333', 'BD Dua',   'BizDev');

-- Jalur intake BD (leads_validate): brand_name + bd_employee_id yang wajib,
-- lead_name diturunkan trigger dari brand_name.
insert into leads (id, brand_name, bd_employee_id)
values ('44444444-4444-4444-4444-444444444444', 'Brand Uji',
        '22222222-2222-2222-2222-222222222222');

-- Harapan per skenario. `label` juga dipakai sebagai brand_name supaya baris
-- view bisa dicocokkan kembali ke harapannya.
create temp table harapan (
  label            text primary key,
  exp_kreator      integer,
  exp_pct          numeric,
  exp_poin         numeric,
  exp_status       text,
  exp_vt_step      integer,
  exp_vt_done      boolean,
  exp_vt_total     numeric
) on commit drop;

insert into harapan values
  -- (label,                        kreator, pct,  poin, status,                       step, done, vt_total)
  ('UJI capaian 100%',                   10,  100,    2, 'ok',                            12, true,  40),
  ('UJI capaian 50%',                     5,   50,    1, 'ok',                            12, true,  20),
  ('UJI capaian 10%',                     1,   10,  0.5, 'ok',                            12, true,   3),
  ('UJI melebihi target',                20,  100,    2, 'ok',                            12, true,  60),
  ('UJI kreator NULL',                 null, null,    0, 'jumlah_kreator_belum_diisi',    12, true,  15),
  -- pct_kreator tetap dihitung meski report VT belum selesai — yang digerbangi
  -- report VT adalah POIN-nya, bukan capaiannya. Papan Skor BD menampilkan
  -- capaian 100% berdampingan dengan poin 0 supaya bedanya terlihat.
  ('UJI report VT belum',                10,  100,    0, 'report_vt_belum_selesai',       12, false, 40),
  ('UJI dining free barter',             10,  100,    2, 'ok',                            14, true,  40),
  ('UJI dining berbayar sebagian',        6,   60,    1, 'ok',                            19, true,  50);

-- ---- Deal Accommodation & Dining Free/Barter (alur poi_sop_progress) -------
-- Trigger brand_deals_poi_sop_ensure memprovisi progress + 15/14 baris step
-- di muka; yang menandai selesai adalah completed_at, bukan keberadaan baris.
do $$
declare
  r record;
  v_deal uuid;
  v_prog uuid;
  v_step integer;
begin
  for r in
    select * from (values
      ('UJI capaian 100%',      'Accomodation', 'Free/Barter', 10,   10, 40, true),
      ('UJI capaian 50%',       'Accomodation', 'Free/Barter', 10,    5, 20, true),
      ('UJI capaian 10%',       'Accomodation', 'Free/Barter', 10,    1,  3, true),
      ('UJI melebihi target',   'Accomodation', 'Free/Barter', 10,   20, 60, true),
      ('UJI kreator NULL',      'Accomodation', 'Free/Barter', 10, null, 15, true),
      ('UJI report VT belum',   'Accomodation', 'Free/Barter', 10,   10, 40, false),
      ('UJI dining free barter','Dining',       'Free/Barter', 10,   10, 40, true)
    ) as t(label, kategori, bentuk, needed, kreator, vt, vt_done)
  loop
    insert into brand_deals (
      brand_name, bd_id, lead_id, created_by, kategori_poi, bentuk_kerjasama,
      benefit, pic_name, pic_whatsapp, ops_name, kreator_needed,
      visit_start_date, visit_end_date, tanggal_mulai_kontrak, tanggal_akhir_kontrak
    ) values (
      r.label, '22222222-2222-2222-2222-222222222222',
      '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
      r.kategori, r.bentuk, 'Benefit Uji', 'PIC Uji', '081200000000', 'Fajri', r.needed,
      current_date, current_date, current_date, current_date + 30
    ) returning id into v_deal;

    select id into v_prog from poi_sop_progress where deal_id = v_deal;
    if v_prog is null then
      raise exception 'trigger poi_sop_ensure tidak memprovisi progress untuk %', r.label;
    end if;

    update poi_sop_progress
       set actual_kreator = r.kreator, actual_vt = r.vt, total_gmv = 1000
     where id = v_prog;

    -- poi_sop_steps_validate memaksa urutan: step N hanya boleh selesai kalau
    -- N-1 sudah selesai. Jadi langkah report VT dicapai dengan menyelesaikan
    -- 1..N berurutan, persis seperti Ops mencentangnya di UI.
    if r.vt_done then
      for v_step in 1..poi_vt_report_step(r.kategori, r.bentuk) loop
        update poi_sop_steps set completed_at = now()
         where progress_id = v_prog and step_no = v_step;
      end loop;
    end if;
  end loop;
end $$;

-- ---- Deal Dining Berbayar (alur poi_dining_cycles) ------------------------
-- Dasar skor hanya siklus yang langkah 19-nya selesai; vt & gmv menjumlahkan
-- SELURUH siklus. Skenario: 6 kreator terverifikasi + 4 belum → 6/10 = 60%.
do $$
declare
  v_deal uuid;
  v_c1   uuid;
  v_c2   uuid;
  v_step integer;
begin
  insert into brand_deals (
    brand_name, bd_id, lead_id, created_by, kategori_poi, bentuk_kerjasama,
    benefit, pic_name, pic_whatsapp, ops_name, kreator_needed, nominal_harga,
    visit_start_date, visit_end_date, tanggal_mulai_kontrak, tanggal_akhir_kontrak
  ) values (
    'UJI dining berbayar sebagian', '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
    'Dining', 'Berbayar', 'Benefit Uji', 'PIC Uji', '081200000000', 'Fajri', 10, 5000000,
    current_date, current_date, current_date, current_date + 60
  ) returning id into v_deal;

  -- Trigger brand_deals_poi_dining_ensure sudah membuat siklus dari rentang
  -- kontrak. Dua siklus pertama dipakai; sisanya dikosongkan agar tidak ikut
  -- menjumlah.
  select id into v_c1 from poi_dining_cycles where deal_id = v_deal and cycle_no = 1;
  select id into v_c2 from poi_dining_cycles where deal_id = v_deal and cycle_no = 2;
  if v_c1 is null or v_c2 is null then
    raise exception 'trigger poi_dining_ensure tidak memprovisi 2 siklus (dapat %)',
      (select count(*) from poi_dining_cycles where deal_id = v_deal);
  end if;

  update poi_dining_cycles set actual_kreator = 6, actual_vt = 30, total_gmv = 700 where id = v_c1;
  update poi_dining_cycles set actual_kreator = 4, actual_vt = 20, total_gmv = 300 where id = v_c2;

  -- Hanya siklus 1 yang lapor VT (langkah 19). Sama seperti alur SOP, step
  -- harus diselesaikan berurutan — 1..19.
  for v_step in 1..19 loop
    update poi_dining_steps set completed_at = now()
     where cycle_id = v_c1 and step_no = v_step;
  end loop;
end $$;

-- ---- Deal tanpa kategori_poi: TIDAK boleh muncul di view -----------------
insert into brand_deals (brand_name, bd_id, lead_id, created_by)
values ('UJI tanpa kategori', '22222222-2222-2222-2222-222222222222',
        '44444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111');

-- ---- Pemeriksaan ---------------------------------------------------------
do $$
declare
  v_gagal text[] := '{}';
  r       record;
  v_n     integer;
begin
  for r in
    select h.label,
           h.exp_kreator, h.exp_pct, h.exp_poin, h.exp_status, h.exp_vt_step,
           h.exp_vt_done, h.exp_vt_total,
           v.kreator_realized, v.pct_kreator, v.poin, v.poin_status,
           v.vt_report_step, v.vt_report_done, v.vt_total
      from harapan h
      left join v_poi_deal_realisasi v on v.brand_name = h.label
  loop
    if r.kreator_realized is null and r.poin is null then
      v_gagal := v_gagal || format('%s: tidak ada barisnya di v_poi_deal_realisasi', r.label);
      continue;
    end if;
    if r.kreator_realized is distinct from r.exp_kreator then
      v_gagal := v_gagal || format('%s: kreator_realized %s, harap %s', r.label, r.kreator_realized, r.exp_kreator);
    end if;
    if r.pct_kreator is distinct from r.exp_pct then
      v_gagal := v_gagal || format('%s: pct_kreator %s, harap %s', r.label, r.pct_kreator, r.exp_pct);
    end if;
    if r.poin is distinct from r.exp_poin then
      v_gagal := v_gagal || format('%s: poin %s, harap %s', r.label, r.poin, r.exp_poin);
    end if;
    if r.poin_status is distinct from r.exp_status then
      v_gagal := v_gagal || format('%s: poin_status %s, harap %s', r.label, r.poin_status, r.exp_status);
    end if;
    if r.vt_report_step is distinct from r.exp_vt_step then
      v_gagal := v_gagal || format('%s: vt_report_step %s, harap %s', r.label, r.vt_report_step, r.exp_vt_step);
    end if;
    if r.vt_report_done is distinct from r.exp_vt_done then
      v_gagal := v_gagal || format('%s: vt_report_done %s, harap %s', r.label, r.vt_report_done, r.exp_vt_done);
    end if;
    if r.vt_total is distinct from r.exp_vt_total then
      v_gagal := v_gagal || format('%s: vt_total %s, harap %s', r.label, r.vt_total, r.exp_vt_total);
    end if;
  end loop;

  -- Deal tanpa kategori_poi tidak diskor.
  select count(*) into v_n from v_poi_deal_realisasi where brand_name = 'UJI tanpa kategori';
  if v_n <> 0 then
    v_gagal := v_gagal || format('deal tanpa kategori_poi ikut masuk view (%s baris)', v_n);
  end if;

  -- poin_status hanya boleh salah satu dari tiga nilai yang diterjemahkan UI.
  -- Nilai baru berarti Papan Skor BD menampilkan kode mentah ke pengguna.
  select count(*) into v_n from v_poi_deal_realisasi
   where poin_status not in ('ok', 'report_vt_belum_selesai', 'jumlah_kreator_belum_diisi');
  if v_n <> 0 then
    v_gagal := v_gagal || format('%s baris punya poin_status di luar 3 nilai yang dikenal UI', v_n);
  end if;

  -- Alur baru tanpa aturan skor harus nol (jaminan 0356).
  select coalesce(sum(deal_poin_belum_ditentukan), 0) into v_n from v_poi_deal_summary;
  if v_n <> 0 then
    v_gagal := v_gagal || format('deal_poin_belum_ditentukan %s, harap 0', v_n);
  end if;

  -- Agregasi summary harus sama dengan agregasi langsung dari realisasi —
  -- inilah yang membuat Papan Skor BD boleh menjumlahkan baris summary
  -- lintas kategori tanpa menghitung poin sendiri.
  select count(*) into v_n from (
    select period, bd_id, sum(poin_sum) poin, sum(total_deal) deal,
           sum(realisasi_visit) visit, sum(kreator_realized_sum) kreator
      from v_poi_deal_summary group by 1, 2
  ) a full join (
    select period, bd_id, sum(poin) poin, count(*) deal,
           count(*) filter (where vt_report_done) visit,
           coalesce(sum(kreator_realized), 0) kreator
      from v_poi_deal_realisasi group by 1, 2
  ) b on a.period = b.period and a.bd_id is not distinct from b.bd_id
  where (a.poin, a.deal, a.visit, a.kreator) is distinct from (b.poin, b.deal, b.visit, b.kreator);
  if v_n <> 0 then
    v_gagal := v_gagal || format('%s grup summary tidak cocok dengan agregasi realisasi', v_n);
  end if;

  if array_length(v_gagal, 1) > 0 then
    raise exception E'% pemeriksaan GAGAL:\n  - %',
      array_length(v_gagal, 1), array_to_string(v_gagal, E'\n  - ');
  end if;

  raise notice '✅ v_poi_deal_realisasi & v_poi_deal_summary: seluruh pemeriksaan lolos (% skenario)',
    (select count(*) from harapan);
end $$;

rollback;
