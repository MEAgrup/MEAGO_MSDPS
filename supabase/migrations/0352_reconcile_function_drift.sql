-- =============================================================================
-- MSDPS · Migration 0352 — rekonsiliasi drift definisi fungsi & index (item 3b)
-- =============================================================================
-- Ditemukan 2026-09-04 saat memverifikasi paritas item 3 dengan
-- scripts/schema_fingerprint.sql.
--
-- KOREKSI atas catatan awal item 3b: laporan pertama menyebut "26 dari 106 fungsi
-- berbeda", termasuk validator uang (leads_validate, payouts_validate,
-- transactions_validate). Itu SALAH — hash mentah `pg_get_functiondef` ikut
-- menghitung komentar `--` dan spasi. Sesudah dinormalisasi (komentar +
-- whitespace dibuang, '→' vs '->' disamakan), staging dan production hanya
-- berbeda pada DUA fungsi. Sisanya identik logikanya; production kebetulan
-- kehilangan baris komentar karena cara penerapannya dulu.
--
-- Pelajaran: bandingkan definisi yang SUDAH dinormalisasi. Hash mentah
-- melaporkan komentar sebagai "drift" dan memicu alarm palsu.
--
-- Isi migrasi ini (semuanya idempoten; tiap blok no-op di environment yang
-- sudah benar):
--   1. mcn_purge_expired_weekly_data — staging kehilangan satu baris NYATA
--   2. generate_health_monthly       — buang kolom mati `n_weeks`
--   3. create_poi_finance            — resmikan ke repo (sudah ada di 2 environment)
--   4. mcn_creators_status_kontrak_idx — resmikan ke repo (sudah ada di production)
-- =============================================================================

-- ---- 1. mcn_purge_expired_weekly_data ---------------------------------------
-- Satu-satunya perbedaan perilaku yang benar-benar ada. Versi staging (dari
-- migrasi 0317 varian staging-only yang dibuang di 0351) TIDAK memuat baris
-- `delete from creator_video_gmv`, jadi retensi mingguan di staging tidak pernah
-- membersihkan tabel itu. Repo & production sudah benar.
create or replace function mcn_purge_expired_weekly_data()
returns void language plpgsql security definer set search_path = public as $fn$
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
end $fn$;

-- ---- 2. generate_health_monthly ---------------------------------------------
-- Repo & staging punya `count(*) filter (where true) as n_weeks` di SELECT, tapi
-- n_weeks TIDAK PERNAH dibaca di sisa badan fungsi — kode mati sejak 0208.
-- Production tidak punya baris itu. Keputusan user 2026-09-04: samakan ke bentuk
-- production (buang kode matinya), production tidak disentuh.
-- Signature WAJIB sama persis dengan 0208 (`char(6)`), kalau tidak `create or
-- replace` justru membuat fungsi kembar dengan tipe parameter berbeda.
create or replace function generate_health_monthly(p_period char(6) default null)
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  v_period char(6);
  v_prev_period char(6);
  v_count int := 0;
  r record;
  v_gmv numeric; v_gmv_est boolean;
  v_prev_avg numeric;
  v_trend text;
begin
  if auth.uid() is not null and not (is_od() or is_director()) then
    raise exception '[hanya OD/Director yang dapat men-generate ringkasan bulanan manual]'
      using errcode = 'insufficient_privilege';
  end if;

  v_period := coalesce(p_period,
                       to_char((date_trunc('month', now() at time zone 'Asia/Jakarta') - interval '1 month'), 'YYYYMM'));
  v_prev_period := to_char(to_date(v_period, 'YYYYMM') - interval '1 month', 'YYYYMM');

  for r in
    select h.merchant_id,
           avg(h.composite_score) as avg_score,
           (array_agg(h.band order by h.week_start desc))[1] as eom_band
    from merchant_health_snapshots h
    where h.period = v_period
      and not exists (select 1 from merchant_health_monthly mm
                      where mm.merchant_id = h.merchant_id and mm.period = v_period)
    group by h.merchant_id
  loop
    select gmv_value into v_gmv from merchant_gmv_authoritative
    where merchant_id = r.merchant_id and period = v_period
    order by entered_at desc limit 1;
    v_gmv_est := v_gmv is null;
    if v_gmv is null then
      select max(gmv_value) into v_gmv
      from (select (h.channel_gmv->>'ads')::numeric as gmv_value from merchant_health_snapshots h where h.merchant_id = r.merchant_id and h.period = v_period
            union all
            select (h.channel_gmv->>'kol')::numeric from merchant_health_snapshots h where h.merchant_id = r.merchant_id and h.period = v_period
            union all
            select (h.channel_gmv->>'live')::numeric from merchant_health_snapshots h where h.merchant_id = r.merchant_id and h.period = v_period) x;
    end if;

    select avg_score into v_prev_avg from merchant_health_monthly
    where merchant_id = r.merchant_id and period = v_prev_period;
    v_trend := case when v_prev_avg is null then '→'
                    when r.avg_score - v_prev_avg >= 3 then '↑'
                    when r.avg_score - v_prev_avg <= -3 then '↓'
                    else '→' end;

    insert into merchant_health_monthly
      (code, merchant_id, period, avg_score, eom_band, monthly_trend,
       total_gmv, gmv_estimated, total_complaints)
    values
      (next_code('MHRM'), r.merchant_id, v_period, round(r.avg_score, 1), r.eom_band, v_trend,
       v_gmv, v_gmv_est,
       (select count(*) from complaints c
        where c.merchant_id = r.merchant_id and to_char(c.created_at, 'YYYYMM') = v_period));
    v_count := v_count + 1;
  end loop;

  return v_count;
end $fn$;

-- ---- 3. create_poi_finance ---------------------------------------------------
-- Ada di staging DAN production dengan isi identik, tapi tidak pernah punya file
-- migrasi di repo — jadi `db reset` & environment baru tidak memilikinya.
-- Saat ini tidak dipanggil apa pun (bukan fungsi lain, bukan trigger, bukan
-- app/ maupun lib/). Keputusan user 2026-09-04: diresmikan ke repo apa adanya,
-- bukan di-drop — tidak ada objek live yang disentuh, dan lubang `db reset`
-- tertutup. Kalau nanti terbukti memang tidak dipakai, drop-nya migrasi
-- tersendiri.
create or replace function create_poi_finance(
  p_deal_id uuid,
  p_payment_intent payment_intent default 'Lunas'::payment_intent
)
returns text language plpgsql security definer set search_path = public as $fn$
declare
  v_deal        brand_deals%rowtype;
  v_merchant_id uuid;
  v_kategori    text;
  v_trx_id      uuid;
  v_trx_code    text;
begin
  if not (is_od() or is_director() or auth_division() = 'BizDev') then
    raise exception '[akses ditolak]' using errcode = 'insufficient_privilege';
  end if;

  select * into v_deal from brand_deals where id = p_deal_id;
  if not found then
    raise exception '[deal tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  if v_deal.kategori_poi is null then
    raise exception '[deal ini bukan deal POI]' using errcode = 'check_violation';
  end if;
  if v_deal.bentuk_kerjasama is distinct from 'Berbayar'
     or v_deal.nominal_harga is null or v_deal.nominal_harga <= 0 then
    raise exception '[deal ini bukan kerjasama berbayar]' using errcode = 'check_violation';
  end if;
  if v_deal.transaction_id is not null then
    raise exception '[transaksi untuk deal ini sudah dibuat]' using errcode = 'check_violation';
  end if;

  -- Pemetaan kategori POI -> kategori merchant M4.
  -- CATATAN EJAAN: 'Accomodation' (satu 'm') memang ejaan yang dipakai
  -- kategori_poi; padanan M4-nya 'Accommodation'. Lihat docs/GLOSARIUM.md.
  v_kategori := case v_deal.kategori_poi
                  when 'TTD'          then 'Attraction & Leisure'
                  when 'Accomodation' then 'Accommodation'
                  when 'Dining'       then 'Dining'
                end;

  -- Cari merchant existing berdasar nama toko; bila tak ada, buat.
  select id into v_merchant_id from merchants
   where lower(nama_toko) = lower(v_deal.brand_name)
   limit 1;
  if v_merchant_id is null then
    insert into merchants (nama_toko, kota, link_toko, kategori,
                           gmv_baseline, target_gmv, payment_intent)
    values (v_deal.brand_name, '-', '-', v_kategori,
            0, 0, p_payment_intent)
    returning id into v_merchant_id;               -- kode MER- di-mint trigger
  end if;

  insert into transactions (merchant_id, payment_intent, total_agreed_value)
  values (v_merchant_id, p_payment_intent, v_deal.nominal_harga)
  returning id, code into v_trx_id, v_trx_code;

  update brand_deals set transaction_id = v_trx_id where id = p_deal_id;

  return v_trx_code;
end $fn$;

-- Cerminkan hak akses yang sudah berlaku di production: PUBLIC/anon dicabut,
-- authenticated boleh eksekusi. Tanpa ini `db reset` menghasilkan fungsi yang
-- LEBIH LONGGAR daripada production (PUBLIC dapat EXECUTE secara default).
revoke execute on function create_poi_finance(uuid, payment_intent) from public, anon;
grant  execute on function create_poi_finance(uuid, payment_intent) to authenticated;

-- ---- 4. mcn_creators_status_kontrak_idx --------------------------------------
-- Hanya ada di production. Asalnya commit e9d2817 yang membuat index ini di
-- migrasi 0316; file 0316 kemudian ditulis ulang dan index-nya hilang dari repo,
-- sehingga staging & `db reset` tidak pernah memilikinya.
-- Keputusan user 2026-09-04: diresmikan ke repo (production tidak disentuh).
-- Catatan jujur: saat ini index ini nyaris tidak berguna — `status_kontrak`
-- hanya punya SATU nilai berbeda di 2.250 baris (hasil backfill 0339), jadi
-- planner tidak akan memakainya sampai kolomnya benar-benar bervariasi.
create index if not exists mcn_creators_status_kontrak_idx
  on mcn_creators (status_kontrak);
