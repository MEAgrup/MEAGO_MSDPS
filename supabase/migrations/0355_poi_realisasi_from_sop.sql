-- =============================================================================
-- 0355 — OPSI B: realisasi POI jadi turunan poi_sop_progress (bukan brand_deals)
-- =============================================================================
-- KEPUTUSAN USER 2026-09-05 (item 5 / T4). Jangan re-litigasi.
--
--   1. Sumber kebenaran realisasi pindah ke tempat tim benar-benar mengisi:
--      `poi_sop_progress` (dan `poi_dining_cycles` untuk Dining Berbayar).
--   2. `actual_vt` BUKAN jumlah kreator. Satu kreator bisa posting lebih dari
--      satu video, jadi VT bisa MELEBIHI jumlah kreator. Metrik utama skor
--      adalah **jumlah kreator tercapai** — kolom baru `actual_kreator`;
--      `actual_vt` tetap dicatat sebagai total video (informasi, bukan skor).
--   3. Skor dibatasi **maksimal 100%** — melebihi target tidak menambah poin.
--   4. Padanan `visit_checked` = **langkah "Membuat & mengirimkan report
--      pengumpulan VT ke BD" selesai**. Itu titik angka VT diverifikasi ke BD;
--      memakai langkah visit D-day akan memberi poin sebelum hasilnya diketahui.
--
-- KENAPA `poin` TIDAK LAGI DISIMPAN DI brand_deals
--
-- `brand_deals_validate()` adalah trigger BEFORE di `brand_deals`. Inputnya
-- sekarang hidup di tabel LAIN (`poi_sop_progress`, `poi_sop_steps`) yang berubah
-- sendiri tanpa menyentuh `brand_deals` — trigger itu tidak akan pernah
-- menghitung ulang. Menyimpannya berarti nilai basi. Jadi `poin` menjadi
-- **turunan saat dibaca** lewat view, dan kolomnya ditandai deprecated.
--
-- Aman dilakukan: `brand_deals.poin` dan `v_poi_deal_summary` TIDAK dibaca satu
-- kali pun di `app/` maupun `lib/` (diverifikasi grep 2026-09-05) — papan skornya
-- belum pernah muncul di UI. Jadi perubahan ini tidak mengubah tampilan apa pun,
-- hanya membuat angkanya benar begitu papan skornya dipasang.
--
-- DINING BERBAYAR SENGAJA BELUM DISKOR
--
-- Alurnya per SIKLUS BULANAN (`poi_dining_cycles`, 22 langkah). Menjumlahkan
-- `actual_kreator` lintas bulan akan menghitung kreator yang sama berulang, dan
-- apakah `kreator_needed` berarti per-siklus atau per-deal belum ditentukan.
-- Daripada menebak, view melaporkan `poin = null` + `poin_status =
-- 'dining_berbayar_belum_ditentukan'`. Realisasi per siklus tetap dihitung dan
-- ditampilkan, jadi tidak ada data yang hilang — hanya skornya yang menunggu
-- keputusan. Tidak ada regresi: semua deal berpoin 0 sebelum migrasi ini.
-- =============================================================================

-- ── 1. Kolom metrik utama: jumlah kreator tercapai ──────────────────────────
alter table poi_sop_progress  add column if not exists actual_kreator integer;
alter table poi_dining_cycles add column if not exists actual_kreator integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'poi_sop_progress_actual_kreator_chk') then
    alter table poi_sop_progress
      add constraint poi_sop_progress_actual_kreator_chk check (actual_kreator is null or actual_kreator >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'poi_dining_cycles_actual_kreator_chk') then
    alter table poi_dining_cycles
      add constraint poi_dining_cycles_actual_kreator_chk check (actual_kreator is null or actual_kreator >= 0);
  end if;
end $$;

comment on column poi_sop_progress.actual_kreator is
  'Jumlah KREATOR yang benar-benar tercapai. METRIK UTAMA skor BD POI (dibanding kreator_needed di brand_deals, dibatasi maks 100%). Berbeda dari actual_vt.';
comment on column poi_sop_progress.actual_vt is
  'Total video/VT terkumpul. BISA MELEBIHI jumlah kreator — 1 kreator dapat posting >1 video. Informasi, BUKAN dasar skor; skor memakai actual_kreator.';
comment on column poi_dining_cycles.actual_kreator is
  'Jumlah KREATOR tercapai pada siklus ini. Lihat catatan Dining Berbayar di migrasi 0355 — skor per-deal belum ditentukan.';
comment on column poi_dining_cycles.actual_vt is
  'Total video/VT siklus ini. Bisa melebihi jumlah kreator (1 kreator >1 video).';

-- ── 2. Tandai kolom realisasi lama deprecated (TIDAK di-drop) ───────────────
-- Sengaja tidak di-drop: kalau ada laporan lama yang membacanya, biar ketahuan
-- dulu. Tidak ada satu pun kode yang MENULIS kolom-kolom ini (audit 2026-09-02).
comment on column brand_deals.kreator_realized is
  'DEPRECATED sejak 0355 (opsi B). Sumber kebenaran: poi_sop_progress.actual_kreator. Tidak pernah ditulis kode apa pun.';
comment on column brand_deals.video_realized is
  'DEPRECATED sejak 0355 (opsi B). Sumber kebenaran: poi_sop_progress.actual_vt.';
comment on column brand_deals.visit_checked is
  'DEPRECATED sejak 0355 (opsi B). Padanannya: langkah "report pengumpulan VT ke BD" selesai di poi_sop_steps.';
comment on column brand_deals.listing_date is
  'DEPRECATED sejak 0355 (opsi B). Tidak pernah ditulis kode apa pun.';
comment on column brand_deals.visit_realized_date is
  'DEPRECATED sejak 0355 (opsi B). Tidak pernah ditulis kode apa pun.';
comment on column brand_deals.poin is
  'DEPRECATED sejak 0355 (opsi B). Poin kini turunan SAAT DIBACA di v_poi_deal_realisasi / v_poi_deal_summary — kolom ini tidak lagi dipelihara karena inputnya ada di tabel lain dan nilainya pasti basi.';

-- ── 3. Nomor langkah "report pengumpulan VT ke BD" per alur ─────────────────
-- Sumber: lib/mcn/poi-sop.ts. Accommodation/TTD 15 langkah → 12.
-- Dining Free/Barter 17 langkah (tabel sama) → 14.
-- Dining Berbayar 22 langkah (5 MOU opsional + 17 inti, tabel poi_dining_*) → 19.
create or replace function poi_vt_report_step(p_kategori text, p_bentuk text)
returns integer language sql immutable set search_path = public as $$
  select case
    when p_kategori = 'Dining' and p_bentuk = 'Berbayar'   then 19
    when p_kategori = 'Dining'                              then 14
    else 12
  end
$$;

comment on function poi_vt_report_step(text, text) is
  'Nomor langkah SOP "Membuat & mengirimkan report pengumpulan VT ke BD" menurut alur POI. Padanan visit_checked sejak 0355. Sinkron dengan lib/mcn/poi-sop.ts.';

-- ── 4. Realisasi per deal, turunan bukti SOP ────────────────────────────────
create or replace view v_poi_deal_realisasi
with (security_invoker = true) as
-- Aturan skor dibaca lewat SUBQUERY SKALAR, bukan `from app_config ... cross join`.
-- Alasannya bukan gaya: dengan cross join, hilangnya satu baris konfigurasi membuat
-- SELURUH view mengembalikan NOL BARIS — papan skor kosong tanpa satu pun pesan
-- error. Ketemu saat menguji migrasi ini di database hasil `db reset` yang belum
-- menyeed `poi.poin_rule`. Subquery skalar menghasilkan NULL bila barisnya tidak
-- ada, lalu coalesce jatuh ke default — view selalu punya tepat satu baris aturan.
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
    -- alur poi_sop_progress (Accommodation/TTD & Dining Free/Barter)
    p.actual_kreator                                                 as sop_kreator,
    p.actual_vt                                                      as sop_vt,
    p.total_gmv                                                      as sop_gmv,
    exists (
      select 1 from poi_sop_steps s
       where s.progress_id = p.id
         and s.step_no = poi_vt_report_step(d.kategori_poi, d.bentuk_kerjasama)
         and s.completed_at is not null
    )                                                                as sop_vt_report_done,
    -- alur poi_dining_cycles (Dining Berbayar) — agregat per siklus, info saja
    (select count(*) from poi_dining_cycles c where c.deal_id = d.id)          as cycle_count,
    (select sum(c.actual_kreator) from poi_dining_cycles c where c.deal_id = d.id) as cycle_kreator_sum,
    (select sum(c.actual_vt) from poi_dining_cycles c where c.deal_id = d.id)      as cycle_vt_sum,
    (select sum(c.total_gmv) from poi_dining_cycles c where c.deal_id = d.id)      as cycle_gmv_sum,
    (select count(*) from poi_dining_cycles c
       join poi_dining_steps s on s.cycle_id = c.id
      where c.deal_id = d.id and s.step_no = 19 and s.completed_at is not null)    as cycle_vt_report_done
  from brand_deals d
  left join poi_sop_progress p on p.deal_id = d.id
  where d.kategori_poi is not null
),
calc as (
  select b.*,
         -- Dibatasi maks 100%: melebihi target tidak menambah poin (keputusan user).
         --
         -- ⚠ `least()` MENGABAIKAN NULL — `least(null, 100)` mengembalikan 100, bukan
         -- null. Tanpa penjagaan `is null` di bawah, deal yang jumlah kreatornya BELUM
         -- DIISI akan tampil 100% dan mendapat poin penuh. Ketemu saat menguji migrasi
         -- ini (skenario T6); ini justru kasus yang paling penting benar, karena
         -- seluruh deal production hari ini kolomnya masih kosong.
         case
           when b.sop_kreator is null or coalesce(b.kreator_needed, 0) = 0 then null
           else least(b.sop_kreator::numeric / b.kreator_needed * 100, 100)
         end as pct_kreator
  from base b
)
select
  c.deal_id, c.code, c.brand_name, c.period, c.bd_id, c.kategori_poi, c.bentuk_kerjasama,
  c.kreator_needed,
  c.vt_report_step,
  case when c.is_berbayar_dining then 'dining_berbayar'
       when c.kategori_poi = 'Dining' then 'dining_freebarter'
       else 'accommodation_ttd' end                                   as flow,
  -- realisasi
  case when c.is_berbayar_dining then c.cycle_kreator_sum else c.sop_kreator end as kreator_realized,
  case when c.is_berbayar_dining then c.cycle_vt_sum      else c.sop_vt      end as vt_total,
  case when c.is_berbayar_dining then c.cycle_gmv_sum     else c.sop_gmv     end as total_gmv,
  c.cycle_count,
  -- padanan visit_checked
  case when c.is_berbayar_dining then c.cycle_vt_report_done > 0
       else c.sop_vt_report_done end                                  as vt_report_done,
  case when c.is_berbayar_dining then null else round(c.pct_kreator, 1) end as pct_kreator,
  -- poin
  -- Aturan 0333 memberi `half` (1 poin) bila jumlah kreator NULL. Itu tidak
  -- dibawa ke sini: di bawah opsi B kolomnya justru yang wajib diisi tim, dan
  -- memberi poin untuk data yang belum diisi berarti menghadiahi kelalaian.
  -- Tanpa angka kreator → 0 poin, dengan alasannya terbaca di poin_status.
  case
    when c.is_berbayar_dining then null
    when not c.sop_vt_report_done then 0
    when c.pct_kreator is null then 0
    when c.pct_kreator >= r.full_pct then r.full
    when c.pct_kreator >= r.half_pct then r.half
    else r.low
  end                                                                 as poin,
  case
    when c.is_berbayar_dining              then 'dining_berbayar_belum_ditentukan'
    when not c.sop_vt_report_done          then 'report_vt_belum_selesai'
    when c.pct_kreator is null             then 'jumlah_kreator_belum_diisi'
    else 'ok'
  end                                                                 as poin_status
from calc c cross join rule r;

comment on view v_poi_deal_realisasi is
  'Realisasi POI per deal sebagai TURUNAN bukti SOP (opsi B, 0355). kreator_realized dari poi_sop_progress.actual_kreator (metrik utama, dibatasi maks 100% vs kreator_needed); vt_total = total video, bisa > jumlah kreator. Padanan visit_checked = langkah poi_vt_report_step() selesai. Dining Berbayar: poin null, lihat poin_status.';

-- ── 5. Papan skor BD dari sumber yang benar ─────────────────────────────────
create or replace view v_poi_deal_summary
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
  'Rekap deal & skor BD per periode/BD/kategori POI. Sejak 0355 (opsi B) poin dihitung dari v_poi_deal_realisasi — turunan poi_sop_progress, bukan kolom realisasi brand_deals yang deprecated. realisasi_visit kini berarti "langkah report VT ke BD selesai". deal_poin_belum_ditentukan = Dining Berbayar yang skornya menunggu keputusan.';

-- ── 6. brand_deals_validate(): berhenti memelihara `poin` ───────────────────
-- Seluruh badan fungsi disalin dari 0333 dengan HANYA blok POIN yang diganti,
-- supaya tidak ada validasi lain yang hilang tanpa sengaja.
create or replace function brand_deals_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_digits   text;
begin
  -- --- Perilaku existing (semua baris) ---
  if new.brand_name is null or btrim(new.brand_name) = '' then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  new.deal_end := new.exp_date;
  if new.code is null then
    new.code := next_code('DEAL');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;

  -- --- Blok POI (hanya bila kategori_poi terisi) ---
  if new.kategori_poi is not null then
    if new.pic_name is null or btrim(new.pic_name) = ''
       or new.pic_whatsapp is null or btrim(new.pic_whatsapp) = ''
       or new.bentuk_kerjasama is null
       or new.benefit is null or btrim(new.benefit) = ''
       or new.visit_start_date is null
       or new.visit_end_date is null
       or new.kreator_needed is null or new.kreator_needed <= 0
       or new.lead_id is null
       or new.bd_id is null
       or new.ops_name is null then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;

    if new.kategori_poi = 'Dining'
       and (new.tanggal_mulai_kontrak is null or new.tanggal_akhir_kontrak is null) then
      raise exception '[tanggal awal & akhir kerjasama wajib diisi untuk kategori Dining]'
        using errcode = 'check_violation';
    end if;

    if new.bentuk_kerjasama = 'Berbayar'
       and (new.nominal_harga is null or new.nominal_harga <= 0) then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;

    if new.visit_end_date < new.visit_start_date then
      raise exception '[tanggal selesai visit tidak boleh sebelum tanggal mulai]'
        using errcode = 'check_violation';
    end if;

    v_digits := regexp_replace(new.pic_whatsapp, '[^0-9]', '', 'g');
    if v_digits like '0%' then
      v_digits := '62' || substr(v_digits, 2);
    end if;
    new.pic_whatsapp := v_digits;

    insert into lead_benefit_options (label) values (new.benefit)
      on conflict (label) do nothing;

    -- POIN: tidak lagi dihitung di sini (opsi B, 0355). Inputnya ada di
    -- poi_sop_progress/poi_sop_steps yang berubah tanpa menyentuh brand_deals,
    -- jadi nilai tersimpan pasti basi. Dipaksa NULL supaya tidak ada yang
    -- salah mengira kolom ini masih hidup, dan supaya klien tidak bisa
    -- menyuntikkan poin sendiri. Poin dibaca dari v_poi_deal_realisasi.
    new.poin := null;
  end if;

  return new;
end $$;

revoke execute on function brand_deals_validate() from public, anon, authenticated;

-- Seragamkan kolom deprecated: seluruh nilainya 0 dan diturunkan dari kolom yang
-- tidak pernah diisi, jadi tidak ada informasi yang hilang. Tanpa ini kolomnya
-- campur 0 dan null dan tampak seolah sebagian deal "punya skor".
update brand_deals set poin = null where poin is not null;

-- ── 7. Buang update_poi_realisasi() ─────────────────────────────────────────
-- Fungsi ini menulis kelima kolom realisasi yang sekarang deprecated. Ia tidak
-- pernah punya file migrasi dan TIDAK PERNAH dipanggil dari mana pun (0 rujukan
-- di app/, lib/, fungsi lain, maupun trigger — diverifikasi 2026-09-05).
-- Membiarkannya hidup berarti menyimpan jebakan: siapa pun yang memanggilnya
-- akan membuat dua sumber kebenaran berbeda lagi.
drop function if exists update_poi_realisasi(uuid, date, date, integer, integer, boolean);
