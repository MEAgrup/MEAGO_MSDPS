# MSDPS — Laporan Performa Merchant otomatis (model "Analisa Sushi Yay")

## Status build (2026-11-06) — kode SELESAI, 0381 DI-APPLY KE STAGING (belum production)

Dibangun dari rencana di bawah (disetujui Yohan 2026-11-04). Ringkasan apa yang ada:

| Lapis | File |
|---|---|
| Migrasi | `supabase/migrations/0381_merchant_report.sql` (**0381**, bukan 0377 — 0377–0380 sudah dipakai migrasi lain di `main`) |
| Parser export | `lib/merchant-report/video-list.ts` (+ `read-xlsx.ts` yang mempertahankan tipe sel) |
| Rumus | `lib/merchant-report/metrics.ts` — port 1:1 `scripts/merchant_report/compute_metrics.py` |
| Insight otomatis | `lib/merchant-report/insights.ts` |
| Server action | `lib/actions/merchant-report.ts` |
| Halaman staf | `/meago/laporan-merchant` (daftar + upload), `/meago/laporan-merchant/[lead_id]?dari=&sampai=` (laporan 8 seksi) |
| Portal merchant | `/merchant/laporan` → seksi "Performa Bulanan TikTok GO" |
| Uji | `scripts/qc_merchant_report.mjs` (unit + paritas vs Python), `scripts/test_merchant_report.sql` (61 assertion RLS/rumus/portal, rollback) |

### Penyimpangan dari rencana (sengaja, dengan alasan)
1. **Nomor migrasi 0381** (0377–0380 terpakai: bridge CDPS, kontrak SPK, target GMV deal, fix review deal).
2. **Upload file mentah lewat signed upload ke Storage** (bucket privat `merchant-report-uploads`, dihapus setelah dibaca) —
   bukan lewat body server action, karena batas body Vercel ±4,5 MB lebih kecil dari workbook gabungan.
3. **`mcn_creators.binding_status` TIDAK disinkron** dari Video List. Perubahan kolom itu mencabut undangan Creator Portal
   (trigger 0372) dan export bulanan lebih basi daripada Creator Analysis mingguan. Yang diisi hanya `city` /
   `creator_level` yang **masih kosong** (tidak pernah menimpa).
4. **Insight disimpan sebagai teks polos** (satu baris = satu poin), diedit lewat textarea per blok — bukan
   `contenteditable` + HTML, supaya tidak ada jalur XSS dari staf ke portal merchant.
5. **`v_merchant_outlet_score` per bulan.** Skor periode multi-bulan bergantung pada rentang yang dipilih, jadi dihitung di
   `metrics.ts`; view memakai rumus yang sama untuk satu bulan.
6. Snapshot menyimpan **`row_seq`** (urutan kemunculan di file) + `location_name`/`location_city` per baris, supaya aturan
   "ambil baris pertama/terakhir" persis sama dengan `compute_metrics.py`. `duration_sec` bertipe `numeric`
   (Python membandingkan durasi float dengan batas bucket).
7. PK snapshot tetap `(post_id, location_id, period_start)` seperti rencana → upload data yang sama ke lead kedua
   **ditolak** dengan pesan "lead induk" (mencegah double count).
8. Skenario: judul seksi memakai 3 bulan setelah bulan terakhir periode (Sep → "Okt–Des 2026"), bukan "Q4" tetap.
9. Parameter yang bisa diubah dari UI: pengali skenario + target KPI. Bobot skor, ambang layer, `bucket_edges`,
   `low_red` ada di `merchant_report_params` (default = sample) — ubah via SQL bila perlu.

### Verifikasi yang sudah dijalankan
- `bash scripts/pg_test_reset.sh` → 99 migrasi lolos dari nol; 0381 idempoten (di-apply 2×).
- `scripts/test_merchant_report.sql` → 61/61 lolos (wewenang, ganti-bulan atomik, tolak lead kedua, rumus view dihitung
  tangan, merchant_locations, params/notes/logo, isolasi portal A vs B, anon ditolak).
- `node scripts/qc_merchant_report.mjs` → 1044/1044 lolos: unit parser + **paritas penuh dengan compute_metrics.py** pada
  dua workbook sintetis (bulanan, outlet+skor+layer, kota, creator+layer+aktivitas, best practice, fitur caption,
  task type, skenario). Uji mutasi: bug sengaja di `prank`/`round` langsung tertangkap.
- E2E lokal: workbook sintetis → parser TS → RPC `merchant_report_replace_month` → `v_merchant_monthly` identik dengan
  `metrics.ts` di 17 kolom.
- `npx tsc --noEmit` bersih.

- **File mentah asli** (`DATA_RAW_DINING_GAB_2026_sushi_yay_only.xlsx`, dikirim Yohan 2026-11-06):
  `node scripts/qc_merchant_report.mjs <file>` → **2180/2180 lolos** — paritas penuh dengan `compute_metrics.py` +
  SEMUA angka acuan §6 (GMV Agu/Sep, order, views, new/aktif post, outlet 57/66 & 67/74, creator 98/537 & 172/615,
  0-order/>50 9/11 & 7/19, layer outlet 16/28/30, creator Layer 1 = 17). Parse seluruh workbook: JAN–APR ditolak
  (format lama), "mei juli 2026" ditolak (33.392 sel ID dibulatkan Excel), Agus & SEPT masuk (dari kolom `month`).
- **Temuan data**: sheet SEPT memuat 162 baris outlet **"Yay! Grill"** (Gatsu Bandung, Cipondoh) dan angka sample yang
  disetujui (74 outlet Sep) MENGHITUNGNYA. Karena itu filter kata kunci outlet dijadikan **opsional, default kosong**
  (export TikTok sudah per akun merchant); nama brand lead hanya dipakai membuang awalan "Brand - " dari nama outlet.
- **Staging** (`vgjzvdpxrdoefoncuazw`): di-apply 2026-11-06 (tercatat dengan nama lama `0378_merchant_report`, isi identik 0381); `scripts/test_merchant_report.sql` dijalankan dengan
  hak bawaan Supabase (tanpa grant tambahan) → **61/61 lolos**, transaksi dibatalkan.

### BELUM (perlu orang / akses)
1. Uji UI §8 dengan data asli. Staging hanya punya 1 lead (tidak ada Sushi Yay) dan **preview Vercel feature branch
   memakai Supabase PRODUCTION** (`docs/STAGING.md` §3) — jangan upload lewat preview PR.
2. Apply 0381 ke production + merge PR, lalu upload file ke lead induk Sushi Yay (default LEAD-202609-0018).
3. Item §7 (logo MEAGO!, logo merchant, konfirmasi lead induk, akun merchant uji) masih menunggu Yohan.

---

# MSDPS — Handoff: Laporan Performa Merchant otomatis (model "Analisa Sushi Yay")

Paste file ini ke chat baru untuk lanjut BUILD. Status: **rencana disetujui Yohan 2026-11-04, belum ada kode**.
Lampirkan juga ke chat baru (kalau ada): `Sample_Laporan_Sushi_Yay_Agu-Sep_2026.html`, `compute_metrics.py`,
`render_report.py`, dan file data `DATA_RAW_DINING_GAB_2026_sushi_yay_only.xlsx`. Kalau tidak dilampirkan,
semua rumus & struktur ada di dokumen ini — cukup untuk membangun ulang.

---

## 1. Konteks
- Repo: `MEAgrup/MEAGO_MSDPS` (Next.js App Router + Supabase prod `mvcckptntrvzujqaoxxh`). Baca dulu
  `docs/HANDOFF.md`, `docs/BUILD_PLAN.md` (konvensi engineering WAJIB), `docs/GLOSARIUM.md`.
- Yohan ingin laporan performa merchant TikTok Dining seperti infografis contoh **Sushi Yay Jan–Sep 2026**
  dan **Amanda Brownies Mei–Sep 2026** dibuat **otomatis dari MSDPS**, **bulanan**, user **memilih periode**
  (mis. Agu–Sep), digabung dengan laporan merchant yang sudah ada (`/merchant/laporan`), **insight bisa
  diedit tim BD MEAGO**, ada **kolom upload logo merchant**, **logo MEAGO! otomatis**.
- Sumber data satu-satunya: export TikTok GO **"Content Analysis › Video List"** per bulan
  (1 baris = post × outlet). Parser format ini SUDAH ADA: `lib/mcn/content-analysis.ts`
  (dipakai `lib/actions/campaign-ingest.ts` → tabel `tiktok_post_index`, migrasi 0346).
- **Sample laporan sudah dibuat & disetujui** (HTML mandiri, SVG inline, mode terang/gelap, toolbar
  tim BD). Angkanya cocok dengan contoh: Sep GMV 218.340.885 / 3.731 order; Agu 110.165.315 / 2.232.

## 2. Keputusan terkunci (jangan dilitigasi ulang)
1. Hanya bulan yang datanya **lengkap** yang diproses; bulan tidak lengkap **diabaikan**, bukan diisi perkiraan.
2. Format export lama Jan–Apr 2026 (item_id/poi_id, USD) dan sheet Mei–Jul yang Post ID/Location ID-nya
   dibulatkan Excel → **di luar scope** sampai Yohan export ulang.
3. Harus ada **menu upload data mentah** di MSDPS (data merchant belum ada di DB: `tiktok_post_index` 0 baris).
4. Unit baris = **post × outlet × bulan**; baris pecahan (sheet Agustus punya 2.710 post×outlet dengan >1 baris,
   beda views/CTR) **dijumlahkan** saat ingest.
5. Hanya baris `Status = "Valid posts"` yang dihitung.
6. Insight = teks otomatis dari aturan, **bisa diedit & disimpan per merchant+periode** oleh BD/CM, ada tombol
   "Kembalikan ke teks otomatis".
7. Logo merchant: upload (PNG/JPG/SVG ≤1 MB) → tampil di header; kosong → kotak inisial warna brand.
   Logo MEAGO! selalu di header kanan + footer. **Aset logo MEAGO! belum ada di repo maupun media meago.id**
   → minta file ke Yohan; sementara wordmark SVG "MEAGO! · Official TikTok GO Partner" (hijau `#1EA469`).
8. Skenario Q4, target KPI, kalender momentum, roadmap/PIC = **parameter/template** yang diisi staf, bukan data.
9. Satu brand bisa punya 2 lead di MSDPS (Sushi Yay: LEAD-202609-0018 Jabar & 0155 DKI; Amanda: 0310 & 0676)
   → perlu **lead induk** per brand (tanya Yohan; default: lead yang punya deal Berbayar, 0018 & 0310).

## 3. Temuan data mentah (DATA_RAW_DINING_GAB_2026_sushi_yay_only.xlsx)
| Sheet | Format | Baris | Catatan |
|---|---|---|---|
| JAN–APR 2026 | lama (item_id, poi_id, poi_vv, *_amount_dollar) | 1.675–2.091 | USD; tanpa Status/judul/durasi/kota; **skip** |
| mei juli 2026 | Video List v1 + kolom `month`, header `Creator binding status` | 16.696 | Post ID & Location ID float (7.61e+18) → **tolak, minta export ulang** |
| Agus 2026 | Video List v1, header `Creator link status` | 10.769 | OK; 66 outlet; 871 link status kosong |
| SEPT 2026 | Video List v2: `Industry`, `Current status`, `Location region`, `Creator province`, `Post link`, `Product ID` | 5.358 | OK; 74 outlet; tanpa duplikat |
Header v1/v2 harus di-alias: `current status`→status, `creator binding status`→creator link status, `industry`→location industry.
Kolom `Merchant` di export = platform OTA (bukan merchant MSDPS) — lihat komentar di `content-analysis.ts`.
Outlet dikenali dari `Location ID` + `Location name` (normalisasi "Sushi Yay! -" = "Sushi Yay -").
Username kreator cocok dengan `mcn_creators.username` (ceriwismakan, danniljalanjajan, nyoena, dll).

## 4. Rencana build (urutan)
### A. Migrasi `0377_merchant_report.sql`
- `merchant_locations(id, lead_id fk leads, location_id text, location_name text, location_name_norm text,
  city text, region text, first_seen date, last_seen date, active bool default true, unique(lead_id, location_id))`.
- `tiktok_post_snapshots(post_id text, location_id text, period_start date, period_end date, lead_id fk,
  source_format text check in ('video_list_v1','video_list_v2'), post_title, post_date date, duration_sec int,
  task_type, status_valid bool, creator_username, creator_name, creator_level, creator_city, creator_link_status,
  sales_value numeric, orders int, redemption_amount numeric, redeemed_orders int, video_views bigint,
  upload_batch text, ingested_by uuid, ingested_at, primary key (post_id, location_id, period_start))`.
  `tiktok_post_index` TIDAK diubah (masih dipakai validasi campaign).
- `merchant_report_params(lead_id pk, fx_by_month jsonb, score_w_gmv 0.4, score_w_red 0.3, score_w_ord 0.3,
  outlet_l1 0.8, outlet_l2 0.4, creator_l1 0.9, creator_l2 0.6, creator_l3_min_views 1000, low_red 0.6,
  dormant_days 60, bucket_edges int[] default '{5,10,20,50}', scenario jsonb default
  '{"Konservatif":[0.85,0.95,1.0],"Moderat":[1.0,1.2,1.3],"Agresif":[1.15,1.5,1.7]}', kpi jsonb)`.
- `merchant_report_notes(id, lead_id, period_from date, period_to date, section_key text, body text,
  updated_by uuid, updated_at, unique(lead_id, period_from, period_to, section_key))`.
- `leads.logo_path text` + Storage bucket `merchant-logos` (private; signed URL saat render).
- Views (security_invoker): `v_merchant_monthly`, `v_merchant_outlet_monthly`, `v_merchant_outlet_score`,
  `v_merchant_city`, `v_merchant_creator`, `v_merchant_top_posts` — rumus di §5.
- RPC security-definer untuk portal: `merchant_portal_performance(p_from date, p_to date)` mengikuti pola
  whitelist `0374_merchant_portal_rpc.sql` (filter `auth_merchant_lead_ids()`; tanpa komisi/budget/notes).
- RLS staff: ikuti `tiktok_post_index` (0346, diperluas 0358 → `isCampaignStaff` + SPV CM) + BizDev.
  Konvensi: fungsi revoke dari anon/public; RPC grant authenticated saja.

### B. Ingest — `lib/mcn/content-analysis.ts` + `lib/actions/merchant-report-ingest.ts`
- Terima **workbook gabungan** (banyak sheet, kolom `month`) **atau** file export per bulan (window dari sheet
  filter seperti sekarang). Bulan dari kolom `month`/window, bukan tebakan. 1 sheet = 1 bulan penuh.
- Validasi per sheet: Post ID & Location ID string digit (tolak float/bulat → pesan "export ulang"), kolom
  status ada, header wajib (Post ID, Location ID, Creator ID). Sheet gagal dilewati dengan alasan; sheet lain tetap masuk.
- Agregasi per (post_id, location_id, bulan): Σ sales_value, orders, redemption_amount, redeemed_orders,
  video_views; atribut teks ambil baris pertama; `status_valid` = status == "Valid posts".
- Upsert `tiktok_post_snapshots`; sinkron `merchant_locations` (semua Location ID yang muncul untuk lead itu;
  kata kunci brand dari `leads.brand_name` untuk memfilter bila file multi-brand); sinkron
  `mcn_creators.binding_status/creator_level/city` dari bulan terbaru.
- Halaman `/meago/laporan-merchant`: daftar merchant (lead induk), bulan yang sudah ter-upload, upload, generate.

### C. Laporan
- `/meago/laporan-merchant/[lead_id]?dari=YYYY-MM&sampai=YYYY-MM` (staff) — layout = sample HTML
  (8 seksi), SVG inline tanpa CDN, mode terang/gelap, tombol cetak PDF, toolbar: upload logo, edit insight
  (contenteditable per blok `data-key`, simpan ke `merchant_report_notes`), reset ke otomatis.
- `/merchant/laporan` (portal): seksi "Performa Bulanan" ringkas (KPI, tren, top outlet, kategori order)
  dari RPC; insight = versi tersimpan BD bila ada.
- Dokumentasi: `docs/BUILD_PLAN.md` baris baru; `docs/GLOSARIUM.md` (snapshot, outlet, bucket, layer, skor);
  salin dokumen ini ke `docs/HANDOFF_LAPORAN_MERCHANT.md`.

## 5. Definisi metrik (sumber: compute_metrics.py — WAJIB sama)
Semua dari baris valid, unit post × outlet × bulan.
- **Bulanan**: GMV = Σsales_value; order = Σorders; views = Σvideo_views; redemption = Σredemption_amount;
  redemption rate = redemption ÷ GMV; AOV = GMV ÷ order; order/1.000 views = order ÷ (views/1000);
  new post = post unik dengan `post_date` di bulan itu; post aktif = post unik dengan baris valid;
  GMV per post aktif = GMV ÷ post aktif; outlet terlihat = Location ID unik; outlet bertransaksi = outlet
  dengan order > 0; creator aktif = username unik; creator ber-GMV = username dengan GMV > 0;
  MoM = (bulan ini − bulan lalu) ÷ bulan lalu.
- **Bucket order outlet** per bulan: 0 / 1–5 / 6–10 / 11–20 / 21–50 / >50 (edges di params). Penyebut = outlet
  terlihat bulan itu (tampilkan penyebut per bulan karena berubah: 66 Agu, 74 Sep).
- **Outlet** (periode terpilih): GMV, order, redemption, views, redemption rate; skor = 0,4·PR(GMV) +
  0,3·PR(redemption) + 0,3·PR(order), PR = peringkat persentil 0..1 (rank/(n−1)); Layer 1 ≥ 0,8; Layer 2 ≥ 0,4;
  sisanya Layer 3. Audit prioritas: outlet GMV > Rp5 jt dengan redemption rate < 0,6.
- **Kota**: Σ per `location_city`; GMV per outlet = GMV ÷ jumlah outlet; Δ bulan terakhir vs pertama.
- **Creator**: GMV, order, redemption, views, post unik, GMV/post; bound = `creator_link_status` tidak kosong
  pada bulan terakhir; share top-2 / top-10 = GMV kumulatif k teratas ÷ total. Layer dihitung di antara creator
  bound ber-GMV: skor sama seperti outlet; Layer 1 ≥ 0,9; Layer 2 ≥ 0,6; selain itu "Monitor". Bound dengan GMV 0
  dan views ≥ 1.000 = Layer 3; bound lainnya = Monitor; tidak bound = "Belum bound/linked". Aktivitas = hari
  sejak post terakhir (as-of akhir periode): ≤14 Aktif, 15–30 Melambat, >30 Tidak posting.
- **Best practice**: baris diurutkan GMV; top 5% baris → share GMV, median views top vs sisanya; bucket durasi
  ≤15 / 16–25 / 26–35 / >35 dtk → % baris dengan GMV > 0; bucket views ≤500 / 501–2.000 / 2.000–10.000 /
  10.000–50.000 / >50.000 → % menjual; fitur caption via regex pada `post_title` (harga/diskon, CTA tag lokasi,
  nama outlet/kota, kata urgensi, edukasi AYCE/paket) → jumlah, % menjual dengan/tanpa, lift GMV/post;
  GMV/post per `task_type`; contoh post terbaik = 6 post unik (dedupe post_id) GMV tertinggi.
- **Skenario Q4**: baseline = GMV bulan terakhir × pengali per bulan (params). KPI default: AOV ≥ Rp60 rb,
  redemption ≥ 90%, order/1.000 views ≥ 0,45, share top-2 < 40%.
- **Insight otomatis** (teks default, bisa diedit): kalimat MoM GMV; konversi membaik/melemah; outlet 0-order &
  >50 berubah; konsentrasi top-2; jumlah creator ber-GMV vs aktif; AOV vs target.

## 6. Angka acuan untuk verifikasi (Sushi Yay, dari file mentah)
| | Agu 2026 | Sep 2026 |
|---|---|---|
| GMV | 110.165.315 | 218.340.885 |
| Order | 2.232 | 3.731 |
| Views | 5.843.774 | 8.268.794 |
| Redemption rate | 80,5% | 87,6% |
| AOV | 49.357 | 58.521 |
| New post / post aktif | 1.030 / 3.468 | 1.918 / 4.920 |
| Outlet bertransaksi / terlihat | 57 / 66 | 67 / 74 |
| Creator ber-GMV / aktif | 98 / 537 | 172 / 615 |
| Outlet 0 order / >50 | 9 / 11 | 7 / 19 |
Periode Agu–Sep: share top-2 creator 59%, top-10 80%; Layer 1 creator 17; outlet Layer 1/2/3 = 16/28/30;
top outlet Pekanbaru Riau Rp42,0 jt, Gatsu Bandung Rp38,6 jt, Mekarwangi Bandung Rp33,1 jt.

## 7. Yang masih harus diminta ke Yohan
1. Export ulang Mei–Jul 2026 (ID utuh) bila ingin bulan itu masuk — bukan blocker.
2. File logo MEAGO! (SVG/PNG) + logo merchant Sushi Yay & Amanda.
3. Konfirmasi lead induk per brand.
4. Akun merchant uji di staging (`portal_invites`) untuk cek `/merchant/laporan`.

## 8. Verifikasi sebelum PR
1. Upload file mentah Sushi Yay via menu baru di staging → Agu & Sep masuk, Jan–Jul ditolak dengan alasan jelas.
2. `v_merchant_monthly` = tabel §6; `v_merchant_outlet_monthly` Sep: 7 outlet 0-order, 19 outlet >50.
3. Generate Agu–Sep → angka identik dengan sample HTML; edit insight tersimpan & muncul lagi setelah reload;
   logo merchant tampil; cetak PDF rapi.
4. Akun merchant Sushi Yay hanya melihat outletnya; akun Amanda tidak melihat Sushi Yay.
5. `npx tsc --noEmit` bersih; skrip acceptance rollback (pola 0369–0374); update BUILD_PLAN & GLOSARIUM.
