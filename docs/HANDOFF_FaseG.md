# HANDOFF — Fase G: Campaign Kreator MEA GO

## STATUS UPDATE 2026-09-04 (sore) — tabrakan nomor migrasi dengan PR #27, sudah direkonsiliasi

Branch ini di-merge dengan `main` (yang sudah memuat PR #26 dan **PR #27**, "Nominal
suggestion, director-only deal edit/delete, POI notes+SLA settings, Excel export, CRM
table, deal filters"). PR #27 memakai nomor file `0341`-`0343` untuk migrasi yang **sama
sekali berbeda** dari punya Fase G (nama file beda jadi tidak bentrok di git, cuma
membingungkan dibaca manusia — lihat header `0348` untuk daftar lengkap kedua sisi).

**Dampak nyata yang ditemukan:** kedua sisi sama-sama `drop policy + create policy` dengan
nama **sama** (`brand_deals_update`) pada tabel yang sama. Karena diterapkan ke production
di waktu berbeda (Fase G lebih dulu, PR #27 menyusul beberapa jam kemudian), production
sempat berakhir di kebijakan **director-only murni** dari PR #27 — BizDev/CampaignSpecialist/
Account tidak bisa lagi mengubah budget/stage campaign mereka sendiri lewat
`/meago/campaigns/[id]`, meskipun Fase G "terlihat" sudah di-deploy. Sebaliknya, reset dari
nol (`pg_test_reset.sh`, file diproses alfabetis) berakhir di urutan **terbalik** dan
menghasilkan state yang **berbeda dari production** — kelas bug: dua penulis migrasi
paralel berbagi skema penomoran tanpa koordinasi, dan reset-dari-nol tidak menjamin urutan
yang sama dengan urutan apply sungguhan.

**Perbaikan:** `0348_reconcile_brand_deals_update_rls.sql` — kebijakan final eksplisit,
tidak bergantung urutan file mana pun. Keputusan (dikonfirmasi user): **gabungkan kedua
niat**, bukan pilih salah satu — Merchant Deals biasa (`campaign_enabled=false`) tetap
director-only sesuai PR #27; baris campaign (`campaign_enabled=true`) kembali terbuka untuk
BizDev/CampaignSpecialist (semua) dan Account (miliknya sendiri), persis cakupan
`0342_go_campaigns_foundation.sql`. DELETE `brand_deals` sengaja tidak disentuh (tetap
director-only murni — Fase G tidak butuh pengecualian di situ). **Sudah diverifikasi via
query `pg_policies` langsung di production: qual cocok dengan yang dimaksud.** Diterapkan
ke staging DAN production.

**Pelajaran untuk migrasi berikutnya:** kalau ada kemungkinan sesi/PR paralel menyentuh
tabel yang sama, jangan asumsikan nomor file berikutnya "aman" hanya karena nama filenya
beda — cek `git log`/PR terbuka lain untuk migrasi yang menimpa nama policy/trigger yang
sama sebelum push, terutama untuk `brand_deals` (tabel paling ramai penulisnya di repo ini).

### ⚠ Temuan terpisah, BELUM diperbaiki — staging kehilangan tabel POI
Saat mencoba apply `0342_poi_notes.sql` (punya PR #27) ke **staging**, gagal:
`ERROR: 42P01: relation "poi_sop_progress" does not exist`. Staging punya *riwayat migrasi*
yang mencatat `poi_sop_tracking`/`poi_dining_sop_tracking` sebagai sudah diterapkan, tapi
tabel `poi_sop_progress`, `poi_sop_steps`, `poi_dining_cycles`, `poi_dining_steps` benar-benar
tidak ada di staging (dicek langsung via `information_schema.tables`). Ini **drift lama,
tidak terkait Fase G maupun PR #27** — kemungkinan migrasi pernah gagal sebagian atau tabel
sempat di-drop manual di staging. **Belum diperbaiki di sesi ini** — `0342_poi_notes.sql`
dan `0343_poi_sla_settings.sql` (PR #27) **TIDAK diterapkan ke staging** (prasyaratnya tidak
ada di sana), tapi **sudah diterapkan ke production** (bagian dari `main` sebelum sesi ini,
tabelnya ada & terisi di production — dikonfirmasi via `list_tables`). Staging jadi tidak
representatif untuk fitur POI SOP/SLA settings sampai drift ini diinvestigasi dan diperbaiki
terpisah — jangan andalkan staging untuk uji fitur itu sebelum ada migrasi perbaikan.

---

## STATUS UPDATE 2026-09-04 (siang) — G.1 sampai G.5 SELESAI, roadmap §6 di bawah ini rampung

Seluruh roadmap §6 (G.1→G.5) sudah dibangun, diuji, dan **di-apply ke staging + production**
di branch `claude/baca-handoff-task-n7zv4p`.
Migrasi `0341`-`0347` (Fase G). Migrasi `0348` (rekonsiliasi RLS, lihat status update di atas).
`bash scripts/pg_test_reset.sh` → 69 migrasi lolos dari nol (setelah merge `main`/PR #27).

| Fase | Migrasi | Isi |
|---|---|---|
| G.1 | 0341, 0342 | Enum `CampaignSpecialist`; kolom campaign di `brand_deals` (funding, budget, target, segmentasi); `campaign_budget_log`; `campaign_ads_spend`; budget guard trigger |
| G.2 | 0343 | `campaign_participants` (`CPT-`); `creator_meets_campaign_eligibility()`; gerbang pendaftaran+kurasi; `v_portal_campaigns` |
| G.3 | 0344 | `campaign_video_submissions`/`campaign_live_submissions`; 3 kolom rekening `mcn_creators`; bucket `campaign-proofs`; gerbang deadline+dedup post_id |
| G.4 | 0345 | `campaign_curation_batches` (`CUR-`); `campaign_payouts` (`CPY-`); RPC `close_curation_batch()` idempoten; `lib/campaign-completion.ts` + `scripts/test_campaign_completion.mjs` (unit test wajib, 15 assertion) |
| G.5 | 0346 | `tiktok_post_index` GLOBAL; RPC `validate_campaign_posts()`; view `v_campaign_result` |
| cleanup | 0347 | Drop `campaign_requests` + card "Routing Campaign" lama (sesuai §6 G.2: "setelah rilis, hapus") |

UI: `/meago/campaigns` (+ `[id]` — budget, stage, pendaftar, bukti, batch kurasi, hasil
validasi, ingest), `/kreator/campaign` (daftar/batalkan/submit bukti), `/kreator/profil`
(rekening), kartu "Antrian Payout Campaign MEA GO" baru di `/finance`.

**Belum pernah dipakai dengan data nyata** — belum ada campaign sungguhan dibuat di
production (fitur baru live, 0 baris di semua tabel baru). Sebelum dianggap "selesai teruji"
di dunia nyata, jalankan minimal satu campaign end-to-end (buat → aktifkan → kreator daftar →
approve → submit bukti → ingest export TikTok asli → validasi → tutup batch → payout) dan
verifikasi angkanya masuk akal.

Keputusan desain yang **tidak eksplisit di roadmap/interview asli**, diputuskan sendiri saat
implementasi (didokumentasikan di komentar migrasi terkait, dicatat ringkas di sini supaya
mudah ditinjau ulang bila keliru):
- **Kuota menggerbang APPROVAL, bukan pendaftaran** (0343) — pendaftar boleh lebih banyak dari
  kuota, kurasi yang menyeleksi. Alternatif: kuota menutup pendaftaran begitu penuh.
- **"Completed" untuk payout** (0345) = approved + minimal 1 bukti valid sesuai track (video:
  non-duplikat; live: minimal 1 entri apa pun, tanpa syarat durasi/waktu minimum).
- **Rekening kreator BOLEH diubah kapan saja** oleh kreator sendiri (0344) — bukan dikunci
  setelah payout pertama. Kalau ternyata perlu dikunci, tambahkan guard terpisah, jangan
  asumsikan sudah ada.
- **`eligible_roster_status`** dipetakan dari `mcn_creators.live_roster` (boolean) ke token
  `'active'`/`'inactive'` — satu-satunya kolom eligibility yang sumbernya bukan text/text[].
- **`campaign_mode`** nilai `'collaboration_package'`/`'others'` dipilih mengikuti field
  `Task type` di parser TikTok (`lib/mcn/content-analysis.ts`), bukan istilah lain.

Status per 2026-09-02 di bawah ini (isi asli sebelum status update) dipertahankan sebagai
riwayat masalah yang mendasari desain — masih relevan untuk konteks, jangan dihapus.

---

## 1. Masalah yang sedang dipecahkan

Tim MEA GO punya campaign berbayar dari dua sumber (**Campaign Specialist** = budget
internal MEA, **BizDev** = budget brand). Alurnya masih manual: blast WA ke kreator →
kreator balas link video → operasional cek di Google Spreadsheet ber-rumus → ACC →
minta bayar ke Finance. Tujuan Fase G: pindahkan seluruh alur itu ke MSDPS.

Rencana lengkap + hasil interview 4 ronde (semua keputusan sudah TERKUNCI, jangan
re-litigasi) ada di plan file sesi lama. Ringkasan keputusan ada di §5 dokumen ini.

---

## 2. Yang SUDAH selesai (PR #24, merged)

### 2.1 Bug besar: rantai migrasi repo tidak bisa jalan dari nol — DIPERBAIKI
Terbukti empiris, bukan dugaan. Menjalankan `0001`→`0338` di PostgreSQL 16 bersih gagal:
```
0332_deal_transactions.sql:56  ERROR: column "bentuk_kerjasama" does not exist
```
21 kolom `brand_deals` ada di live tapi tidak pernah dibuat migrasi mana pun (di-apply
langsung ke live; diakui di komentar `0332`/`0333`). Artinya `supabase db reset`,
provisioning environment baru, dan CI dari nol semuanya mati.

- `0320_brand_deals_poi_reconcile.sql` — 21 kolom + constraint + 2 FK + 2 index, ditaruh
  pada posisi kronologis yang benar (sesudah `0316`, **sebelum** `0332` yang memakainya).
- `0339_schema_reconcile.sql` — `mcn_creators.status_kontrak` NOT NULL DEFAULT `'kontrak'`,
  view `v_poi_deal_summary`.

**Hasil: 58 migrasi lolos dari nol; 79 objek identik struktur kolomnya dengan live.**

Uji ulang kapan saja: `bash scripts/pg_test_reset.sh`
Cara bandingkan dengan live: `docs/SCHEMA_DRIFT.md`

### 2.2 Kebocoran ke Portal Kreator — DITUTUP (`0340`)
`v_portal_deals` menampilkan SEMUA deal `running` ke setiap kreator yang login.
Live: **80 tampil, hanya 10 yang siap ditawarkan.** 70 sisanya hasil Import Master Deal
yang belum dilengkapi — nama brand-nya nyata ("Staycationku Premium Villa", "Harris Hotel
& Conventions Gubeng"), jadi tampak sah, tapi tanpa kategori/brief/PIC/jadwal visit.
Disaring `kategori_poi is not null`.

### 2.3 Visibilitas hilir
| Temuan | Bukti live | Perbaikan |
|---|---|---|
| 70 dari 80 deal tak pernah masuk tracker operasional (kedua tracker POI memfilter `kategori_poi`) | 70 baris | Stat "Belum Lengkap" di `/deals` + badge amber di nav |
| SOP dicentang tapi hasil tak diisi | `DEAL-202608-0001` 15/15 step, `actual_vt` & `total_gmv` NULL di SELURUH transaksi | Badge merah "Hasil belum diisi" di `PoiCard` |
| Card "Routing Campaign" kosong permanen | `campaign_requests` **0 baris** sejak dibuat | Disembunyikan saat kosong, ditandai DEPRECATED |
| Card "Brand Report" kosong permanen | `cooperating_shops` 0 baris (form deal tak pernah isi `shop_id`, 0/80) | Disembunyikan saat kosong |

### 2.4 Parser bukti campaign — SIAP
`lib/mcn/content-analysis.ts` — export TikTok **"Content Analysis › Video List"**, format
KETIGA (beda dari `creator-analysis.ts` dan `video-ingest.ts`).

Diuji ke dua file export nyata, **75 QC assertion lolos**:
| File | Baris | Window | Industri | Valid TikTok | Lokasi | Kreator |
|---|---|---|---|---|---|---|
| Dining 1–3 Agu | 3.334 | `2026-08-01..03` | Dining | 2.590 | 1.728 | 594 |
| Accommodation 1–7 Agu | 2.085 | `2026-08-01..07` | Accommodation | 2.005 | 693 | 287 |

Jalankan: `node scripts/qc_content_analysis.mjs <file1.xlsx> <file2.xlsx>`

Temuan yang membentuk desainnya:
- **Kunci merchant = `Location ID`** (numerik, stabil). BUKAN kolom `Merchant` (itu daftar
  OTA: Agoda/GoFood) dan BUKAN `Location name` (satu ID bisa punya 2 ejaan kapitalisasi).
- Window tarikan dibaca dari sheet `Filter`; post di luar window memang tidak ada di file —
  inilah mekanisme "kolom merchant kosong = tanggal upload salah".
- `Status` = verdict TikTok sendiri (Valid/Invalid posts). `Task type` = Collaboration
  package vs Others → persis pembeda `campaign_mode`.
- `Post ID` unik dalam file (3334/3334) → deteksi duplikat murni soal submit ganda di MSDPS.
- **594 kreator di file vs 34 di `mcn_creators` production** → ingest DILARANG auto-create
  kreator.

### 2.5 Glosarium istilah — DIKUNCI (`docs/GLOSARIUM.md`)
"Merchant" berarti dua hal berlawanan:
- **MSDPS/MEA GO**: merchant = brand/POI yang bekerja sama → padanannya **`Location`** di
  file TikTok.
- **Kolom `Merchant` di file TikTok**: daftar platform OTA/delivery (Agoda, GoFood).

Build yang ada sudah konsisten memakai arti MEA GO. Parser baru karena itu menamai
field-nya `otaPlatformsRaw`, dengan assertion yang menolak field bernama `merchant*`.
Glosarium juga mengunci ejaan Accommodation (**3 varian**: `Accomodation` di leads /
`Accommodation` di INDUSTRIES / `Accommodations` di export TikTok — dinormalisasi lewat
`lib/mcn/industry-normalize.ts`), tiga arti "campaign", dan dua master creator.

---

## 3. ⚠ MASALAH DATA TERBUKA — kerjakan lebih dulu

### Roster kreator ada di environment yang SALAH
```
production mcn_creators : 34    (era QA, termasuk QA Dummy Creator & 'udin')
staging    mcn_creators : 3.505 (roster asli, dibuat 22–27 Juli 2026)
```
Sementara SELURUH data operasional lain ada di production dan staging kosong:
leads 608 vs 1 · brand_deals 80 vs 0 · lead_status_history 1.163 vs 0 ·
poi_sop_steps 120 vs 0 · creator_period_summary 63 vs 0.

**Jadi database-nya TIDAK tertukar.** Production memang sistem yang hidup. Yang terjadi:
impor master kreator mendarat di staging dan tidak pernah dibawa ke production. Nama &
username-nya nyata dan cocok dengan file export TikTok (`yesiwd`, `aline_1905`,
`mamazil77`, `bintangmalvino2`). 29 dari 34 kreator production ada juga di staging.

**Dampak ke Fase G:** segmentasi kelayakan pendaftar campaign membaca `mcn_creators`.
Dengan 34 baris di production (2 dummy), fitur pendaftaran tidak akan berguna.

**Roster staging TIDAK bersih:**
- 1.296 username diawali `@` (impor kedua tidak memotong `@`); **1.248 di antaranya
  duplikat** dari versi bersihnya (`@babyanggiii` vs `babyanggiii`)
- 11 baris uji
- → hasil bersih **~2.248 kreator unik**, bukan 3.505

**Cara menjalankan** (`scripts/migrate_creators_staging_to_prod.sh`, sudah ditulis & di-commit,
**belum dijalankan**): ambil connection string mode Session dari Supabase Dashboard →
Project Settings → Database, lalu
```bash
export STAGING_URL='postgresql://postgres:PASS@db.vgjzvdpxrdoefoncuazw.supabase.co:5432/postgres'
export PROD_URL='postgresql://postgres:PASS@db.mvcckptntrvzujqaoxxh.supabase.co:5432/postgres'
bash scripts/migrate_creators_staging_to_prod.sh --dry-run
bash scripts/migrate_creators_staging_to_prod.sh
```
Memakai pipe COPY langsung antar-database — nama kreator (penuh emoji, `&`, tanda kutip)
tidak melewati chat sehingga tidak ada risiko salah transkripsi.

### Catatan jujur soal `status_kontrak`
Migrasi `0339` menyamakan skema staging ke production (`NOT NULL DEFAULT 'kontrak'`).
Di production itu NO-OP (34 baris, semuanya sudah `'kontrak'`). **Di staging, itu mengubah
3.504 baris dari NULL menjadi `'kontrak'`** — nilai asumsi, bukan fakta bisnis. Keputusan
user: **biarkan**, karena mayoritas kreator MEA GO memang berkontrak; koreksi per kreator
lewat form Edit. Perlu diingat kalau roster ini dipindah: status kontraknya ikut terbawa
sebagai `'kontrak'`.

Catatan lain: ini bertentangan dengan `docs/BUILD_PLAN.md:42` yang mendokumentasikan
`status_kontrak` sebagai **nullable**. Production sudah menyimpang dari keputusan itu
sebelum sesi ini.

---

## 4. Keputusan terbuka lain (belum dikerjakan)

1. **`crm_leads` + `crm_transaksi`** — live-only, 0 baris di production (5 & 1 di staging),
   tidak dirujuk `app/` maupun `lib/`. Modul Leads yang dipakai adalah `leads` M1.
   Drop dari live menunggu konfirmasi (tidak bisa dibatalkan). Perintahnya ada di
   `0339_schema_reconcile.sql` bagian bawah.
2. **Dua model realisasi bertabrakan (B2/B4).** `brand_deals.poin` dihitung trigger dari
   `visit_checked` + `kreator_realized`, tapi **tidak ada satu baris kode pun** yang menulis
   kolom-kolom itu; yang benar-benar diisi tim adalah `poi_sop_progress.actual_vt`
   (form di `app/(app)/bizdev/poi/poi-card.tsx`). Jadi skor BD tidak akan pernah keluar,
   dan `v_poi_deal_summary` selalu nol. Menyatukannya = perubahan perilaku, butuh keputusan
   sumber kebenaran mana yang menang. **Fase G.4 menutup ini sendiri** karena realisasi jadi
   turunan bukti per-kreator, bukan angka ketikan.
3. **70 deal belum lengkap** — dilengkapi manual, import ulang, atau dibiarkan? Data produksi.

---

## 5. Keputusan Fase G yang TERKUNCI (hasil interview, jangan re-litigasi)

| # | Keputusan |
|---|---|
| 1 | Campaign = **extend `brand_deals`**, satu entitas dengan Merchant Deals |
| 2 | Sumber: Campaign Specialist (budget internal) & BizDev (budget brand) |
| 3 | Divisi: **`CampaignSpecialist` enum BARU**; penerima campaign BizDev = divisi `Account` |
| 4 | CS kerjakan sendiri; BizDev **lempar** ke AM. Penerima = "bagian operasional" |
| 5 | Over-budget: **hard block staff**, Lead+ override → wajib alasan + label `[Over Budget]` + log |
| 6 | Alokasi = **`base_fee × kuota slot`** ≤ `creator_budget` |
| 7 | `ads_budget`: realisasi **input manual** multi-entri → dipakai hitung ROAS |
| 8 | Base fee **flat per campaign, tanpa kelipatan** |
| 9 | Segmentasi: Industry, Kota, Level, Jenis kreator, Roster live, Status kontrak, ambang GMV. **Follower TIDAK dipakai** |
| 10 | Pendaftaran **wajib login Portal Kreator**, hanya kreator yang ada di `mcn_creators` |
| 11 | Rekening kreator **diisi sekali di profil** portal |
| 12 | Bukti live: **tabel submission sendiri**, `live_schedule_slots` tidak dicampur |
| 13 | Kurasi: **batch periode formal** → tutup periode → satu pengajuan ke Finance |
| 14 | Bukti boleh diubah kreator **bebas sampai deadline**, lalu terkunci otomatis |
| 15 | Payout: **tabel baru `campaign_payouts`** — `creator_payouts` M5/M9 tidak disentuh |
| 16 | Realisasi GMV/Views/ROAS **otomatis dari ingest export TikTok** |
| 17 | Campaign "Creator Package (TikTok)": MSDPS **berhenti di kurasi pendaftar** |
| 18 | Deliverable video & live **terpisah, tidak bentrok** |

**Kenapa `creator_payouts` tidak dipakai ulang:** `0103_module5_finance.sql:48-67` —
`referenced_bookings uuid[] NOT NULL` (isi `creator_bookings` KOL M9), `creator_id` FK ke
`creators` M9 **bukan `mcn_creators`**, `milestone_unit_value` generated hardcoded 10/5.
Enum `payout_status` tetap dipakai ulang supaya antrian Finance seragam.

---

## 6. Langkah berikutnya (G.1 → G.5)

Nomor migrasi berikutnya mulai **`0341`** (terakhir dipakai: `0340`).

- **G.1 Fondasi campaign + budget guard**
  `0341` enum `CampaignSpecialist` (transaksi terpisah — aturan rumah `0300:5-8`).
  `0342` extend `brand_deals`: `campaign_enabled`, `funding_source`, `campaign_mode`,
  `campaign_track`, `operational_team`, `operational_owner_id`, `campaign_stage` +
  `stage_changed_by/at`, `creator_budget`, `ads_budget_planned`, `base_fee`, `over_budget`
  + alasan, target hasil, per-kreator, **`target_location_id`**, window post + deadline,
  `brief`, `has_free_meal`, 9 kolom `eligible_*`/`min_gmv*`.
  Tabel `campaign_budget_log`, `campaign_ads_spend`.
  Lib: `campaign-budget.ts`, `campaign-stage.ts`. Actions `go-campaigns.ts`.
  Route `/meago/campaigns` + `[id]`.
- **G.2 Pendaftaran & kurasi** — `campaign_participants` (`CPT-`), gate kelayakan/stage/kuota
  di trigger, `v_portal_campaigns`, portal `/kreator/campaign`. Campaign `tiktok_package`
  selesai di sini. Setelah rilis: hapus card "Routing Campaign" + tabel `campaign_requests`.
- **G.3 Bukti + rekening** — `campaign_video_submissions`, `campaign_live_submissions`,
  bucket privat `campaign-proofs`, `mcn_creators` + 3 kolom rekening, trigger gate deadline,
  trigger tandai duplikat post_id.
- **G.4 Batch kurasi + payout** — `campaign_curation_batches` (`CUR-`), `campaign_payouts`
  (`CPY-`), `close_curation_batch()` idempoten, antrian di `/finance`.
  `campaign-completion.ts` **wajib unit test — ini logika uang.**
- **G.5 Ingest** — `tiktok_post_index` GLOBAL (PK `post_id`, bukan per-campaign),
  `validate_campaign_posts()` dengan urutan verdict: `tidak_ditemukan` → `di_luar_periode`
  → `merchant_tidak_sesuai` → `bukan_milik_kreator` → `ditolak_tiktok` → `duplikat` → `valid`.
  View `v_campaign_result` (guard div-0 → null, **null ≠ 0**). Parser sudah siap.

---

## 7. Jebakan yang WAJIB dihindari

1. **`enforce_status_transition()` hardcode kolom `status`** (`0004:44,49-51`), dan
   `brand_deals.status` sudah dipakai entity `brand_deal` (`0305:126`). `campaign_stage`
   **butuh fungsi trigger sendiri** yang tetap membaca tabel `status_transitions`.
   Jangan ubah `enforce_status_transition()` — dipakai belasan tabel live.
2. **JANGAN pakai `brand_deals.shop_id`** untuk merchant target campaign: ada partial unique
   index `brand_deals_shop_uniq` (`0305:52`) → dua campaign untuk merchant sama gagal insert,
   dan `brand_deals_sync_shop()` akan menulis `cooperating_shops` palsu.
   Pakai **`target_location_id`** (TikTok Location ID).
3. **RLS `brand_deals`**: update hanya BizDev + mgmt (`0305:161`). Perlu diperluas ke
   `CampaignSpecialist`, dan akses tulis `Account` **dibatasi ke baris campaign miliknya**
   (`campaign_enabled and operational_owner_id = auth_emp_id()`).
4. **`ALTER TYPE … ADD VALUE` harus migrasi terpisah** (`0300:5-8`).
5. **React 19/Next 15: `name`/`value` tombol submit tidak masuk FormData**
   (`BUILD_PLAN.md:46`) — satu `<form>` per aksi + hidden input.
6. **Kreator update `mcn_creators`**: RLS Postgres tidak bisa membatasi per kolom. Pakai pola
   terbukti `createAdminClient` service-role di server action (`lib/actions/portal.ts`).
7. **`npm run build` JANGAN saat `npm run dev` menyala** (`BUILD_PLAN.md:48`).
8. **Setiap perubahan skema live WAJIB punya file migrasi** — lihat `docs/SCHEMA_DRIFT.md`.
   Jalankan `bash scripts/pg_test_reset.sh` sebelum merge migrasi apa pun.

---

## 8. Verifikasi baseline hari ini

- `bash scripts/pg_test_reset.sh` → 58 migrasi lolos dari nol
- `npx tsc --noEmit` → bersih
- `npm run build` → bersih (37 halaman)
- `node scripts/qc_content_analysis.mjs <2 file export>` → 75/75

## 9. File kunci

**Baru:** `lib/mcn/content-analysis.ts`, `lib/mcn/industry-normalize.ts`,
`scripts/qc_content_analysis.mjs`, `scripts/pg_test_reset.sh`,
`scripts/migrate_creators_staging_to_prod.sh`, `docs/SCHEMA_DRIFT.md`, `docs/GLOSARIUM.md`,
`supabase/migrations/0320`, `0339`, `0340`

**Diubah:** `app/(app)/layout.tsx`, `app/(app)/deals/page.tsx`, `app/(app)/bizdev/page.tsx`,
`app/(app)/bizdev/poi/poi-card.tsx`
