-- =============================================================================
-- MSDPS · Migration 0361 — Pensiun "Account & Service" + OKR divisi non-operasional
-- =============================================================================
-- KENAPA. MEAGO! menutup deal dengan merchant POI, tapi tim yang mengerjakan
-- pekerjaan operasionalnya — Account, Ads, Creative, Store Operation — tidak ada
-- di MEAGO; semuanya duduk di MEA Agency dan bekerja di CDPS. M6-M10 (beserta
-- turunannya M11-M15) dibangun lengkap sebagai mesin eksekusi kedua dan tidak
-- pernah berpenghuni. Sejak Bridge MSDPS->CDPS Fase 1 (0360, 2026-09-11) deal
-- Berbayar yang terverifikasi Finance diteruskan sebagai satu order ORD- ke inbox
-- CDPS dan dieksekusi di sana.
--
-- APA YANG DILAKUKAN MIGRASI INI — hanya dua hal, keduanya ADITIF:
--   1. Menghentikan tiga pg_cron M13/M14 yang tiap minggu mencetak skor dari
--      tabel yang tidak diisi siapa pun lagi.
--   2. Membuat pasangan target + attainment OKR untuk divisi yang MASIH bekerja
--      di MSDPS.
--
-- APA YANG **TIDAK** DILAKUKAN — dan ini disengaja:
--   * NOL `drop table`, `drop view`, `delete`, atau `alter ... drop column`.
--     Seluruh data historis M6-M15 (briefs, strategies, complaints, sku_work_units,
--     ad_campaign_records, creator_bookings, live_stream_results,
--     merchant_health_snapshots, performance_scores) TETAP UTUH dan tetap terbaca
--     OD/Director lewat RLS yang sudah ada. Pensiun ini menutup pintu masuk
--     manusianya (UI dinisankan, lihat components/retired.tsx), bukan arsipnya.
--   * NOL sentuhan ke `okr_targets` dan ke tipe `perf_role`. Lihat blok 2 di bawah
--     untuk alasan lengkapnya — ini jebakan, bukan kemalasan.
-- =============================================================================

-- =============================================================================
-- 1. Hentikan mesin skor M13/M14
-- =============================================================================
-- cron.unschedule TIDAK menghapus satu baris snapshot pun; ia hanya berhenti
-- menambah baris baru. Kalau dibiarkan jalan, `generate_health_snapshots` dan
-- `generate_performance_scores` akan terus mencetak skor 0/null tiap Minggu dari
-- Brief yang tidak pernah dibuat lagi — dan baris itu IMMUTABLE (trg_*_no_update /
-- no_delete), jadi sampahnya tidak bisa dibersihkan retroaktif. Menghentikannya
-- sekarang lebih murah daripada menjelaskannya nanti.
--
-- Membalikkan pensiun = tiga `cron.schedule` dengan jadwal yang tertulis di
-- komentar tiap baris. Fungsi-fungsinya sendiri tidak disentuh dan masih bisa
-- dipanggil manual oleh OD/Director.
do $$
declare
  j text;
begin
  foreach j in array array['msdps_health_weekly',   -- 0208:447 · '30 17 * * 0'
                           'msdps_health_monthly',  -- 0208:450 · '0 18 1 * *'
                           'msdps_perf_weekly']     -- 0209:342 · '45 17 * * 0'
  loop
    if exists (select 1 from cron.job where jobname = j) then
      perform cron.unschedule(j);
      raise notice 'cron job % dihentikan (pensiun Account & Service)', j;
    end if;
  end loop;
end $$;

-- msdps_retention_monthly (0315:85) SENGAJA dibiarkan jalan — tidak ada
-- hubungannya dengan M6-M15.

-- =============================================================================
-- 2. Target OKR divisi non-operasional
-- =============================================================================
-- KENAPA TABEL BARU, BUKAN MEMPERLUAS `okr_targets`.
-- `okr_targets.role` bertipe ENUM `perf_role` ('Ecommerce','Ads','KOL','AM')
-- (0007:21). Menambah divisi non-operasional ke sana berarti
-- `alter type perf_role add value`, yang:
--   (a) tidak boleh dipakai di transaksi yang sama dengan penambahannya —
--       migrasi Supabase jalan dalam satu transaksi, jadi butuh dua migrasi
--       berpasangan hanya untuk satu tabel;
--   (b) TIDAK BISA DIBATALKAN — Postgres tidak punya `drop value`, sehingga
--       "pensiun yang reversibel" jadi berbohong di level tipe;
--   (c) diam-diam mengubah perilaku `generate_performance_scores` (0209:94
--       melakukan `e.division::text::perf_role`, yang hari ini MELEMPAR ERROR
--       untuk divisi non-operasional). Menambah nilai enum justru membuat mesin
--       yang baru saja kita pensiunkan mulai menghasilkan angka sampah.
-- Karena itu `okr_targets` dibekukan apa adanya sebagai riwayat (baris + audit
-- log tetap), dan divisi non-operasional dapat tabelnya sendiri. Pola isinya
-- cermin 0007: unique parsial saat active, capture_audit, RLS OD/Director kelola.
create table okr_targets_meago (
  id            uuid primary key default gen_random_uuid(),
  period        text not null,                 -- '2026-Q3'
  division      text not null
                  check (division in ('BizDev','CreatorManagement','Acquisition',
                                      'Marketing','Finance')),
  metric        text not null,
  target_value  numeric not null,
  comparator    okr_comparator not null default 'gte',  -- tipe 0007 dipakai ulang
  active        boolean not null default true,
  set_by        uuid references employees(id),
  created_at    timestamptz not null default now()
);

comment on table okr_targets_meago is
  'Target OKR kuartalan divisi NON-OPERASIONAL MSDPS (BizDev/CM/Acquisition/Marketing/Finance), lahir bersama pensiun Account & Service (0361). Ditetapkan OD/Director. Attainment dihitung di v_okr_attainment_meago. Supersede dengan active=false, jangan pernah edit riwayat. Pasangan operasionalnya, okr_targets (0007), DIBEKUKAN — jangan tulis ke sana lagi.';

create unique index okr_targets_meago_active_uniq
  on okr_targets_meago (period, division, metric) where active;

create trigger trg_audit_okr_meago after insert or update on okr_targets_meago
  for each row execute function capture_audit('okr_target_meago');

alter table okr_targets_meago enable row level security;

-- Cermin okr_select (0007): OD/Director baca semua; lead baca divisinya sendiri.
-- Di sini pemetaannya lurus (division = auth_division()), tanpa kasus khusus
-- AM->Account seperti versi operasional.
create policy okr_meago_select on okr_targets_meago
  for select to authenticated
  using (
    is_od() or is_director()
    or (is_lead() and division = auth_division()::text)
  );

create policy okr_meago_manage on okr_targets_meago
  for all to authenticated
  using (is_od() or is_director())
  with check (is_od() or is_director());

-- CATATAN: sengaja TIDAK ada padanan okr_target_value() (0209:50) di sini.
-- Di M14 fungsi itu perlu karena generate_performance_scores memanggilnya per
-- baris; di sini fallback default ditangani langsung oleh katalog + LEFT JOIN di
-- dalam v_okr_attainment_meago_internal, jadi fungsi tambahan hanya akan jadi
-- SQL tanpa pemanggil.

-- =============================================================================
-- 3. v_okr_attainment_meago — pola tiga lapis 0314
-- =============================================================================
-- View ini mengagregasi lintas divisi dan menyentuh kolom sensitif (brand_deals
-- komisi_*, transactions/audit_log, creator_period_summary), jadi ia
-- DEFINER-BY-DESIGN persis seperti v_okr_attainment. Ikuti pola yang sudah ada
-- (0314), jangan bikin pola keempat:
--   lapis 1  v_*_internal   definer, TANPA grant anon/authenticated
--   lapis 2  v_*_rows()     fungsi definer set-returning sebagai jembatan hak
--   lapis 3  v_*            security_invoker = true, select * from v_*_rows()
create view v_okr_attainment_meago_internal as
-- KATALOG. Daftar metrik + default + comparator HARUS cermin lib/okr-metrics.ts.
-- Duplikasi TS<->SQL ini sudah jadi pola rumah (okr-metrics.ts vs literal di
-- generate_performance_scores 0209), tapi tetap harus dipindahkan berbarengan —
-- keduanya saling menunjuk lewat komentar. Katalog ada DI SINI, bukan sekadar
-- LEFT JOIN ke okr_targets_meago, supaya realisasi tetap terhitung dan terlihat
-- walau Director belum menetapkan target apa pun (halaman /okr sudah memang
-- menampilkan "Default (N)" dengan cara yang sama).
with catalog(division, metric, default_value, comparator, is_cumulative) as (values
  ('BizDev',            'deals_berbayar_per_quarter',        12::numeric, 'gte'::okr_comparator, true),
  ('BizDev',            'deals_bridged_per_quarter',         10::numeric, 'gte',                 true),
  ('CreatorManagement', 'affiliate_gmv_per_quarter', 500000000::numeric, 'gte',                 true),
  ('Acquisition',       'creators_bound_per_quarter',        30::numeric, 'gte',                 true),
  ('Marketing',         'roas',                               4::numeric, 'gte',                 false),
  ('Marketing',         'cost_per_lead',                  75000::numeric, 'lte',                 false),
  ('Finance',           'verified_value_per_quarter', 300000000::numeric, 'gte',                 true)
),
-- Kuartal berjalan (Asia/Jakarta — hari kalender di sini yang dipakai, bukan UTC)
-- PLUS tiap kuartal yang sudah punya target aktif, supaya riwayat tidak hilang
-- saat kuartal berganti.
periods as (
  select to_char((now() at time zone 'Asia/Jakarta')::date, 'YYYY-"Q"Q') as period
  union
  select t.period from okr_targets_meago t
   where t.active and t.period ~ '^\d{4}-Q[1-4]$'
),
bounds as (
  select p.period, c.division, c.metric, c.default_value, c.comparator, c.is_cumulative,
         make_date(left(p.period, 4)::int, (right(p.period, 1)::int - 1) * 3 + 1, 1) as q_start,
         (make_date(left(p.period, 4)::int, (right(p.period, 1)::int - 1) * 3 + 1, 1)
          + interval '3 months')::date as q_end
  from periods p cross join catalog c
),
calc as (
  select b.*,
         t.target_value as set_target,
         t.comparator   as set_comparator,
         -- Porsi kuartal yang sudah berlalu (0..1), untuk pace metrik kumulatif.
         least(1.0, greatest(0.0,
           (least(current_date, b.q_end) - b.q_start)::numeric
           / nullif(b.q_end - b.q_start, 0))) as elapsed_frac,
         case b.metric
           -- BizDev — deal Berbayar baru yang terdaftar di kuartal ini.
           -- created_at adalah satu-satunya jangkar kuartal yang sahih: brand_deals
           -- TIDAK punya kolom "closed_at", dan status (running/hold/done) adalah
           -- keadaan PENGERJAAN yang sejak bridge tidak lagi terjadi di MSDPS.
           -- Preseden jangkar yang sama: v_poi_deal_realisasi (0355:120).
           -- kategori_poi is not null membuang baris Import Master Deal yang belum
           -- dilengkapi (baris yang juga dihitung badge kuning di nav).
           when 'deals_berbayar_per_quarter' then
             (select count(*)::numeric from brand_deals d
              where d.bentuk_kerjasama = 'Berbayar' and d.kategori_poi is not null
                and d.created_at::date >= b.q_start and d.created_at::date < b.q_end)

           -- BizDev — deal yang BENAR-BENAR sampai ke CDPS. Ini keluaran nyata
           -- BizDev di era bridge: status 'sent' dijamin punya ord_code + sent_at
           -- oleh constraint cdps_outbox_sent_shape (0360:179).
           when 'deals_bridged_per_quarter' then
             (select count(*)::numeric from cdps_outbox o
              where o.status = 'sent'
                and o.sent_at::date >= b.q_start and o.sent_at::date < b.q_end)

           -- Creator Management — GMV affiliate kreator. DEDUP WAJIB: kunci unik
           -- creator_period_summary memuat upload_batch, jadi satu re-upload minggu
           -- yang sama akan menggandakan GMV tanpa dedup. Pola persis dedup
           -- v_project_summary (0308:124-130): baris created_at terbaru yang menang.
           -- affiliate_gmv (bukan redemption/gmv_total) sesuai keputusan Fase E.1.
           -- ⚠️ msdps_retention_monthly (0315:73) menghapus baris period_start yang
           -- lebih tua dari 6 bulan. Aman untuk metrik kuartal berjalan; JANGAN
           -- pakai tabel ini untuk perbandingan year-over-year.
           when 'affiliate_gmv_per_quarter' then
             (select coalesce(sum(x.affiliate_gmv), 0) from (
                select distinct on (cps.mcn_creator_id, cps.period_start) cps.affiliate_gmv
                from creator_period_summary cps
                where cps.period_start >= b.q_start and cps.period_start < b.q_end
                order by cps.mcn_creator_id, cps.period_start, cps.created_at desc) x)

           -- Akuisisi — kreator baru yang binding di kuartal ini.
           when 'creators_bound_per_quarter' then
             (select count(*)::numeric from acquisitions a
              where a.binding_date >= b.q_start and a.binding_date < b.q_end)

           -- Marketing — ROAS & CPL DITIMBANG (sum/sum), bukan rata-rata rasio
           -- per kampanye: avg() dari rasio memberi kampanye Rp1 juta bobot yang
           -- sama dengan kampanye Rp100 juta. v_marketing_metrics bergrain kampanye
           -- dan tidak punya kolom tanggal, jadi irisan kuartalnya lewat
           -- campaigns.start_date.
           when 'roas' then
             (select round(sum(vm.attributed_revenue) / nullif(sum(vm.budget), 0), 2)
              from v_marketing_metrics vm
              join campaigns c2 on c2.id = vm.campaign_id
              where c2.start_date >= b.q_start and c2.start_date < b.q_end)

           when 'cost_per_lead' then
             (select round(sum(vm.budget) / nullif(sum(vm.lead_by_dashboard), 0), 0)
              from v_marketing_metrics vm
              join campaigns c2 on c2.id = vm.campaign_id
              where c2.start_date >= b.q_start and c2.start_date < b.q_end)

           -- Finance — uang yang benar-benar diverifikasi DI kuartal ini.
           -- Tidak bisa dari transactions.amount_verified: itu akumulator berjalan,
           -- bukan peristiwa bertanggal (verify_payment 0103:234 hanya menambah).
           -- installments juga BUKAN jawabannya — tabel itu tidak pernah ditulis
           -- siapa pun (nol pemanggil di seluruh repo), status-nya selamanya
           -- '[Menunggu Verifikasi]'. Yang punya peristiwanya adalah audit_log:
           -- trg_transactions_audit (0103:91) menulis before/after penuh tiap
           -- UPDATE, jadi delta amount_verified per verifikasi bisa direkonstruksi
           -- persis. Mengorek audit_log memang pola M14 (0209 melakukannya untuk
           -- ad_campaign). Baris INSERT: before null, after 0 -> delta 0.
           -- Catatan ketergantungan: ini sahih selama trg_transactions_audit tetap
           -- terpasang dan audit_log tidak pernah dipangkas (hari ini nol job
           -- retensi menyentuh audit_log, dan history immutable by design).
           when 'verified_value_per_quarter' then
             (select coalesce(sum(
                       (al.after->>'amount_verified')::numeric
                       - coalesce((al.before->>'amount_verified')::numeric, 0)), 0)
              from audit_log al
              where al.entity = 'transaction'
                and al.at::date >= b.q_start and al.at::date < b.q_end
                and (al.after->>'amount_verified')
                    is distinct from (al.before->>'amount_verified'))
           else null
         end as raw_actual
  from bounds b
  left join okr_targets_meago t
    on t.active and t.period = b.period
   and t.division = b.division and t.metric = b.metric
)
select
  c.period,
  c.division,
  c.metric,
  coalesce(c.set_target, c.default_value)                                as target_value,
  case when c.set_target is null then 'default' else 'director' end      as target_source,
  coalesce(c.set_comparator, c.comparator)                               as comparator,
  c.is_cumulative,
  round(c.elapsed_frac * 100, 1)                                         as elapsed_pct,
  round(coalesce(c.raw_actual, 0), 2)                                    as actual_value,
  -- Bagi-nol SELALU jadi null (aturan rumah: tampil '—', tidak pernah galat).
  case when coalesce(c.set_comparator, c.comparator) = 'gte'
       then round(coalesce(c.raw_actual, 0)
                  / nullif(coalesce(c.set_target, c.default_value), 0) * 100, 1)
       -- lte (biaya: makin rendah makin baik) — pembagian dibalik.
       else round(coalesce(c.set_target, c.default_value)
                  / nullif(c.raw_actual, 0) * 100, 1)
  end                                                                    as attainment_pct,
  -- Pace: attainment dibandingkan porsi kuartal yang sudah berlalu. Tanpa ini,
  -- target kumulatif di minggu kedua selalu terbaca "gagal". Metrik rasio
  -- (ROAS/CPL) tidak di-pace — null.
  case when not c.is_cumulative then null
       when coalesce(c.set_comparator, c.comparator) = 'gte'
       then round(coalesce(c.raw_actual, 0)
                  / nullif(coalesce(c.set_target, c.default_value) * c.elapsed_frac, 0) * 100, 1)
       else null
  end                                                                    as pace_pct,
  c.q_start,
  c.q_end
from calc c
where is_od() or is_director()
   or (is_lead() and c.division = auth_division()::text);

comment on view v_okr_attainment_meago_internal is
  'Body + role-gate attainment OKR divisi non-operasional (0361). Definer, TIDAK di-grant ke anon/authenticated — akses lewat v_okr_attainment_meago_rows().';

revoke all on v_okr_attainment_meago_internal from public, anon, authenticated;

create function v_okr_attainment_meago_rows()
  returns setof v_okr_attainment_meago_internal
  language sql stable security definer set search_path = public
as $$ select * from v_okr_attainment_meago_internal $$;

comment on function v_okr_attainment_meago_rows() is
  'Jembatan definer OKR non-operasional (0361), pola 0314. WARN advisor 0029 (callable by authenticated) = intensional.';

revoke all on function v_okr_attainment_meago_rows() from public, anon;
grant execute on function v_okr_attainment_meago_rows() to authenticated, service_role;

create or replace view v_okr_attainment_meago with (security_invoker = true) as
  select * from v_okr_attainment_meago_rows();

comment on view v_okr_attainment_meago is
  'Attainment OKR kuartal-berjalan divisi non-operasional MSDPS (BizDev/CM/Acquisition/Marketing/Finance). Pengganti v_okr_attainment (M14) yang ikut pensiun bersama Account & Service.';

revoke all on v_okr_attainment_meago from public, anon, authenticated;
grant select on v_okr_attainment_meago to authenticated;

-- Sengaja TIDAK ada seed target di sini (beda dari 0209:250). Default hidup di
-- katalog CTE view ini DAN di lib/okr-metrics.ts (keduanya harus dipindahkan
-- berbarengan); angka nyata tetap milik Director lewat halaman /okr.
