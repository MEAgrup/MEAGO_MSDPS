-- =============================================================================
-- 0356 — Dining Berbayar ikut diskor: kreator_needed adalah target PER DEAL
-- =============================================================================
-- KEPUTUSAN USER 2026-09-05 (lanjutan T4/opsi B). Jangan re-litigasi.
--
--   `kreator_needed` = target **per DEAL**, bukan per siklus bulanan.
--
-- Migrasi 0355 sengaja membiarkan Dining Berbayar tanpa skor (`poin = null`,
-- `poin_status = 'dining_berbayar_belum_ditentukan'`) karena dua hal belum
-- ditentukan: (a) apakah target per-siklus atau per-deal, dan (b) bagaimana
-- menggabungkan realisasi lintas siklus. (a) sekarang terjawab, dan (b)
-- mengikutinya: target per-deal berarti realisasi seluruh siklus diakumulasi
-- terhadap satu target yang sama.
--
-- SIKLUS MANA YANG BOLEH DIHITUNG
--
-- Hanya siklus yang **langkah 19 ("Membuat & mengirimkan report pengumpulan VT
-- ke BD") sudah selesai**. Ini bukan aturan baru — ini generalisasi per-siklus
-- dari aturan yang sudah dikunci di 0355: angka baru dihitung sesudah
-- diverifikasi ke BD. Pada alur satu-progress (Accommodation/TTD, Dining
-- Free/Barter) aturannya identik, hanya di sana kebetulan cuma ada satu langkah
-- 19 sehingga sifatnya semua-atau-tidak. Menjumlahkan siklus yang belum lapor
-- akan memberi poin untuk angka yang belum diperiksa siapa pun.
--
-- `vt_total` dan `total_gmv` TETAP menjumlahkan SELURUH siklus — keduanya
-- informasi, bukan dasar skor, dan menyembunyikan sebagiannya justru membuat
-- angka di kartu tidak cocok dengan yang dilihat tim.
--
-- ⚠ BATAS MODEL DATA YANG HARUS DIKETAHUI
--
-- Yang dicatat per siklus adalah JUMLAH kreator, bukan identitasnya. Dengan
-- target per-deal dan realisasi diakumulasi lintas bulan, kreator yang sama
-- dipesan ulang di bulan berikutnya akan **terhitung dua kali** — sebuah deal
-- bisa mencapai 100% dengan memutar orang yang sama. Database tidak punya
-- informasi untuk mencegahnya. Kalau ini nanti terasa mengganggu, perbaikannya
-- adalah mencatat identitas kreator per siklus (tabel penghubung), bukan
-- menambal formulanya. Dicatat di sini supaya tidak ditemukan lagi dari nol.
-- =============================================================================

-- View di-drop lalu dibuat ulang (bukan `create or replace`) karena definisi
-- beberapa kolom berubah arti dan ada kolom baru — drop-create menghindarkan
-- batasan `create or replace view` soal urutan & nama kolom. Urutan drop
-- mengikuti dependensi: summary membaca realisasi.
drop view if exists v_poi_deal_summary;
drop view if exists v_poi_deal_realisasi;

create view v_poi_deal_realisasi
with (security_invoker = true) as
-- Aturan skor lewat subquery skalar + default. JANGAN diubah jadi
-- `from app_config ... cross join`: hilangnya satu baris konfigurasi akan
-- membuat SELURUH view mengembalikan nol baris tanpa pesan error (0355).
with rule as (
  select
    coalesce((v->>'full_pct')::numeric, 100) as full_pct,
    coalesce((v->>'full')::numeric,       2) as full,
    coalesce((v->>'half_pct')::numeric,  50) as half_pct,
    coalesce((v->>'half')::numeric,       1) as half,
    coalesce((v->>'low')::numeric,      0.5) as low
  from (select (select value from app_config where key = 'poi.poin_rule') as v) cfg
),
base as (
  select
    d.id                                                             as deal_id,
    d.code,
    d.brand_name,
    to_char(d.created_at, 'YYYYMM')                                  as period,
    d.bd_id,
    d.kategori_poi,
    d.bentuk_kerjasama,
    coalesce(d.kreator_needed, d.kreators_needed)                    as kreator_needed,
    poi_vt_report_step(d.kategori_poi, d.bentuk_kerjasama)           as vt_report_step,
    (d.kategori_poi = 'Dining' and d.bentuk_kerjasama = 'Berbayar')  as is_berbayar_dining,
    p.actual_kreator                                                 as sop_kreator,
    p.actual_vt                                                      as sop_vt,
    p.total_gmv                                                      as sop_gmv,
    exists (
      select 1 from poi_sop_steps s
       where s.progress_id = p.id
         and s.step_no = poi_vt_report_step(d.kategori_poi, d.bentuk_kerjasama)
         and s.completed_at is not null
    )                                                                as sop_vt_report_done,
    (select count(*) from poi_dining_cycles c where c.deal_id = d.id)              as cycle_count,
    -- vt & gmv: SELURUH siklus (informasi)
    (select sum(c.actual_vt)  from poi_dining_cycles c where c.deal_id = d.id)     as cycle_vt_sum,
    (select sum(c.total_gmv)  from poi_dining_cycles c where c.deal_id = d.id)     as cycle_gmv_sum,
    -- kreator: HANYA siklus yang langkah 19-nya selesai (dasar skor)
    (select sum(c.actual_kreator) from poi_dining_cycles c
      where c.deal_id = d.id
        and exists (select 1 from poi_dining_steps s
                     where s.cycle_id = c.id and s.step_no = 19 and s.completed_at is not null)
    )                                                                              as cycle_kreator_verified,
    (select count(*) from poi_dining_cycles c
      where c.deal_id = d.id
        and exists (select 1 from poi_dining_steps s
                     where s.cycle_id = c.id and s.step_no = 19 and s.completed_at is not null)
    )                                                                              as cycle_verified_count
  from brand_deals d
  left join poi_sop_progress p on p.deal_id = d.id
  where d.kategori_poi is not null
),
calc as (
  select b.*,
         case when b.is_berbayar_dining then b.cycle_kreator_verified else b.sop_kreator end as kreator_eff,
         case when b.is_berbayar_dining then b.cycle_verified_count > 0 else b.sop_vt_report_done end as vt_report_eff
  from base b
),
pct as (
  select c.*,
         -- Dibatasi maks 100%: melebihi target tidak menambah poin.
         -- `least()` MENGABAIKAN NULL (`least(null,100)` = 100), jadi penjagaan
         -- `is null` di bawah WAJIB — tanpa itu deal yang jumlah kreatornya
         -- belum diisi tampil 100% dan dapat poin penuh (bug 0355).
         case
           when c.kreator_eff is null or coalesce(c.kreator_needed, 0) = 0 then null
           else least(c.kreator_eff::numeric / c.kreator_needed * 100, 100)
         end as pct_kreator
  from calc c
)
select
  c.deal_id, c.code, c.brand_name, c.period, c.bd_id, c.kategori_poi, c.bentuk_kerjasama,
  c.kreator_needed,
  c.vt_report_step,
  case when c.is_berbayar_dining then 'dining_berbayar'
       when c.kategori_poi = 'Dining' then 'dining_freebarter'
       else 'accommodation_ttd' end                                   as flow,
  c.kreator_eff                                                       as kreator_realized,
  case when c.is_berbayar_dining then c.cycle_vt_sum  else c.sop_vt  end as vt_total,
  case when c.is_berbayar_dining then c.cycle_gmv_sum else c.sop_gmv end as total_gmv,
  c.cycle_count,
  c.cycle_verified_count,
  c.vt_report_eff                                                     as vt_report_done,
  round(c.pct_kreator, 1)                                             as pct_kreator,
  case
    when not c.vt_report_eff          then 0
    when c.pct_kreator is null        then 0
    when c.pct_kreator >= r.full_pct  then r.full
    when c.pct_kreator >= r.half_pct  then r.half
    else r.low
  end                                                                 as poin,
  case
    when not c.vt_report_eff   then 'report_vt_belum_selesai'
    when c.pct_kreator is null then 'jumlah_kreator_belum_diisi'
    else 'ok'
  end                                                                 as poin_status
from pct c cross join rule r;

comment on view v_poi_deal_realisasi is
  'Realisasi POI per deal sebagai TURUNAN bukti SOP (opsi B, 0355 + 0356). kreator_needed adalah target PER DEAL untuk semua alur. kreator_realized: Accommodation/TTD & Dining Free/Barter dari poi_sop_progress.actual_kreator; Dining Berbayar diakumulasi dari poi_dining_cycles.actual_kreator HANYA siklus yang langkah 19-nya selesai. Dibatasi maks 100% vs kreator_needed. vt_total & total_gmv menjumlahkan SELURUH siklus (informasi, bukan dasar skor). Catatan: yang dicatat jumlah kreator, bukan identitas — kreator yang dipesan ulang antar siklus terhitung dua kali (lihat 0356).';

create view v_poi_deal_summary
with (security_invoker = true) as
  select
    r.period,
    r.bd_id,
    coalesce(e.full_name, '(tanpa BD)')                     as bd_name,
    r.kategori_poi,
    count(*)::integer                                       as total_deal,
    count(*) filter (where r.vt_report_done)::integer        as realisasi_visit,
    coalesce(sum(r.poin), 0::numeric)                       as poin_sum,
    coalesce(sum(r.kreator_realized), 0)::integer           as kreator_realized_sum,
    coalesce(sum(r.vt_total), 0::numeric)                   as vt_total_sum,
    coalesce(sum(r.total_gmv), 0::numeric)                  as gmv_sum,
    count(*) filter (where r.poin is null)::integer          as deal_poin_belum_ditentukan
  from v_poi_deal_realisasi r
  left join employees e on e.id = r.bd_id
  group by 1, 2, 3, 4;

comment on view v_poi_deal_summary is
  'Rekap deal & skor BD per periode/BD/kategori POI. Poin turunan v_poi_deal_realisasi (opsi B). realisasi_visit = "langkah report VT ke BD selesai". Sejak 0356 seluruh alur POI berpoin, termasuk Dining Berbayar, jadi deal_poin_belum_ditentukan seharusnya 0 — kolomnya dipertahankan sebagai alarm bila muncul alur baru yang belum diskor.';
