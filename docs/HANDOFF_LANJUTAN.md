# HANDOFF — Lanjutan sesudah rekonsiliasi skema (2026-09-04 malam)

Tempel dokumen ini ke chat baru untuk melanjutkan. Ditulis sebagai **titik mulai**, bukan
ringkasan riwayat — riwayat lengkapnya ada di dokumen yang dirujuk di bawah.

---

## 0. Baca ini dulu (urut)

| Dokumen | Isinya |
|---|---|
| `docs/HANDOFF_FaseG.md` | Fase G (Campaign Kreator MEA GO) — 18 keputusan TERKUNCI di §5, jebakan wajib di §7, dan bagian **SISA PEKERJAAN** |
| `docs/SCHEMA_DRIFT.md` | Aturan migrasi, cara membandingkan dua database, seluruh drift yang diketahui |
| `docs/GLOSARIUM.md` | "Merchant" berarti dua hal berlawanan; 3 ejaan Accommodation; 3 arti "campaign" |
| `docs/BUILD_PLAN.md` | Tracker progres modul |

Jangan re-litigasi keputusan di `HANDOFF_FaseG.md` §5 — semuanya hasil interview 4 ronde
dan sudah dikunci.

---

## 1. Keadaan sekarang (fakta terverifikasi, bukan asumsi)

**Kode:** `main` = `2c7ad0b`. Migrasi terakhir `0350`. `bash scripts/pg_test_reset.sh`
→ **71 migrasi lolos dari nol**. `npx tsc --noEmit` bersih. `npm run build` bersih.
`node scripts/test_campaign_completion.mjs` → **15/15**.

**Environment Supabase:**
- production `mvcckptntrvzujqaoxxh` — sistem yang hidup, seluruh data operasional
- staging `vgjzvdpxrdoefoncuazw` — **kini setara production** pada kolom, constraint, RLS
  policy, fungsi (106 signature), trigger (147), view (21), enum (158 label), bucket
  Storage (3), job pg_cron (4). Kecuali tiga objek di item 3 daftar kerja bawah.

**Fase G (G.1–G.5):** selesai dibangun, di-apply ke staging + production, lolos unit test —
tapi **0 baris di semua tabel campaign baru**. Belum pernah dipakai dengan data nyata.

**Apa yang baru saja dikerjakan** (commit `c8aa987`, PR #31): staging ternyata melewatkan
**12 migrasi** (`0315`, seluruh `0330`–`0338`, `0342_poi_notes`, `0343_poi_sla_settings`) —
bukan "riwayat migrasi mencatat tapi tabel hilang" seperti dugaan handoff sebelumnya.
Kedua belas diterapkan; drift `ops_name`/`'Fifas'` repo↔production diperbaiki `0350`;
`scripts/schema_fingerprint.sql` ditambahkan supaya drift semacam ini ketahuan sendiri.

---

## 2. Daftar kerja — urut dari yang paling siap

🔒 = **butuh input/keputusan user dulu. Jangan diputuskan sendiri, tanyakan.**

### 1. 🔒 Pindahkan roster kreator staging → production
**Kenapa penting:** production cuma punya 34 kreator (2 di antaranya dummy era QA);
roster asli ~2.248 kreator unik mendarat di **staging** dan tidak pernah dibawa ke
production. Selama begitu, segmentasi kelayakan pendaftar campaign Fase G membaca tabel
yang praktis kosong — fiturnya hidup tapi tidak berguna.

Skripnya **sudah ditulis & di-commit, belum pernah dijalankan**:
`scripts/migrate_creators_staging_to_prod.sh`. Ia memakai pipe `COPY` langsung
antar-database supaya nama kreator (emoji, `&`, tanda kutip) tidak melewati chat.

**Yang dibutuhkan dari user:** connection string mode **Session** kedua project, dari
Supabase Dashboard → Project Settings → Database.
```bash
export STAGING_URL='postgresql://postgres:PASS@db.vgjzvdpxrdoefoncuazw.supabase.co:5432/postgres'
export PROD_URL='postgresql://postgres:PASS@db.mvcckptntrvzujqaoxxh.supabase.co:5432/postgres'
bash scripts/migrate_creators_staging_to_prod.sh --dry-run   # WAJIB dulu
bash scripts/migrate_creators_staging_to_prod.sh
```
**Catatan kebersihan data staging** (skrip sudah menanganinya, tapi hasilnya harus dicek):
1.296 username diawali `@` dari impor kedua, **1.248 di antaranya duplikat** dari versi
bersihnya (`@babyanggiii` vs `babyanggiii`), plus 11 baris uji → hasil bersih ~2.248, bukan
3.505. Ingat juga `status_kontrak` seluruh roster staging bernilai `'kontrak'` hasil
backfill migrasi `0339` — itu **nilai asumsi, bukan fakta bisnis**, dan ikut terbawa.

### 2. 🔒 Jalankan satu campaign end-to-end dengan data nyata
Buat campaign → aktifkan → kreator daftar lewat portal → approve/kurasi → kreator submit
bukti → ingest export TikTok asli → `validate_campaign_posts()` → tutup batch kurasi →
payout muncul di `/finance`. Lalu **verifikasi angkanya masuk akal**, bukan cuma "tidak
error".

**Yang dibutuhkan dari user:** satu campaign sungguhan (atau izin memakai data uji di
production) + file export TikTok **"Content Analysis › Video List"** asli.

Sampai ini dilakukan, status yang jujur adalah "selesai dibangun & lolos unit test",
**bukan** "teruji". Idealnya dikerjakan **sesudah** item 1, supaya ada kreator yang layak
mendaftar. Parser bukti sudah siap & teruji (75 QC assertion ke 2 file export nyata):
`node scripts/qc_content_analysis.mjs <file1.xlsx> <file2.xlsx>`.

### 3. 🔒 Putuskan dua kelompok drift staging-lebih-maju
Objek yang ada di staging, **tidak** ada di production, dan **tidak punya file di repo** —
jadi `db reset` juga tidak memilikinya. Butuh keputusan, bukan sekadar apply:

| Objek | Staging | Production |
|---|---|---|
| `acquisitions` | 18 kolom + policy `acquisitions_delete` | 14 kolom |
| `acquisition_followups` | ada (tabel + 2 policy) | tidak ada |
| `creator_video_gmv` | 23 kolom | 16 kolom |

Asalnya migrasi staging-only `0317_acquisition_extra_fields`,
`0318_acquisition_delete_policy`, `0319_acquisition_followups`,
`0317_gmv_video_weekly_tracking_fix`, `0318_gmv_video_per_creator_week`,
`0320_gmv_video_weekly` — nomornya **bertabrakan** dengan file repo yang isinya berbeda.

**Tanyakan:** fitur Acquisition follow-up & GMV video per-creator-week ini dipakai atau
eksperimen yang ditinggalkan? Kalau dipakai → tulis file migrasi baru di repo (nomor baru,
jangan pakai nomor lama) lalu apply ke production. Kalau tidak → drop dari staging.

### 4. 🔒 Drop `crm_leads` + `crm_transaksi` dari production
0 baris di production, tidak dirujuk satu kali pun di `app/` maupun `lib/` (modul Leads
yang dipakai adalah `leads` M1). Perintahnya sudah siap di bagian bawah
`0339_schema_reconcile.sql`. **Butuh konfirmasi eksplisit** — menghapus objek produksi
tidak bisa dibatalkan. Kalau disetujui, buat file migrasi untuk drop-nya (jangan `execute_sql`
langsung), lalu hapus juga blok "sengaja tidak direkonsiliasi" di `0339`.

### 5. Dua model realisasi bertabrakan (B2/B4) — tidak butuh izin untuk *menyelidiki*
`brand_deals.poin` dihitung trigger `brand_deals_validate()` dari `visit_checked` +
`kreator_realized`, tapi **tidak ada satu baris kode pun** di `app/` atau `lib/` yang
menulis kolom-kolom itu. Yang benar-benar diisi tim adalah `poi_sop_progress.actual_vt`
(form di `app/(app)/bizdev/poi/poi-card.tsx`). Akibatnya skor BD selalu 0 dan
`v_poi_deal_summary` selalu 0.

Fase G.4 menutup masalah ini untuk jalur campaign (realisasi jadi turunan bukti
per-kreator), tapi **jalur POI non-campaign belum**. Menyatukannya = perubahan perilaku →
sajikan opsinya + rekomendasi ke user, jangan pilih sumber kebenaran sendiri.

### 6. 🔒 70 deal "belum lengkap"
Hasil Import Master Deal tanpa `kategori_poi`/brief/PIC/jadwal visit. Nama brand-nya nyata
("Staycationku Premium Villa", "Harris Hotel & Conventions Gubeng") jadi tampak sah, tapi
tak pernah masuk tracker operasional (kedua tracker POI memfilter `kategori_poi`). Sudah
ditandai di UI (stat "Belum Lengkap" di `/deals` + badge amber di nav) dan sudah disaring
dari Portal Kreator (`0340`). **Tanyakan:** dilengkapi manual, import ulang, atau dibiarkan?

### 7. Rekonsiliasi riwayat migrasi production (kebersihan catatan, risiko rendah)
Production punya objek milik `0315_weekly_retention_dedup` & `0312_creator_portal_f2` tanpa
mencatat migrasinya; sebaliknya ia mencatat `0336_ops_name_add_fifas` yang tak punya file
(sudah digantikan `0350`). Strukturnya **sudah** terverifikasi cocok dengan staging, jadi ini
bukan bug — tapi selama begitu, daftar nama migrasi tidak bisa dipakai sebagai satu-satunya
sumber kebenaran. Sengaja belum dikerjakan supaya tidak menyisipkan baris riwayat palsu tanpa
persetujuan.

---

## 3. Jebakan yang WAJIB dihindari

Daftar penuh di `docs/HANDOFF_FaseG.md` §7 (10 poin). Yang paling sering menggigit:

1. **Nomor migrasi berikutnya tidak pernah "aman"** hanya karena file terakhir bernomor N.
   Sesi/PR paralel rutin mengklaim nomor sama: `0341`-`0343` bentrok Fase G vs PR #27, dan
   `0349` diklaim PR #30 **tepat saat sesi 2026-09-04 malam berjalan**. Sebelum memilih
   nomor: cek `git log`, `git branch -r`, **dan** riwayat migrasi kedua environment.
   Waspada khusus untuk nama policy/trigger di `brand_deals` — tabel dengan penulis
   paling ramai di repo ini. Kejadian nyata: dua sisi sama-sama `drop policy + create policy`
   bernama `brand_deals_update`, production sempat berakhir di kebijakan yang salah.
2. **`pg_test_reset.sh` lolos ≠ environment setara.** Untuk paritas, jalankan
   `scripts/schema_fingerprint.sql` di kedua sisi lalu diff (cara pakai di `SCHEMA_DRIFT.md`).
3. **Setiap perubahan skema live WAJIB punya file migrasi** — termasuk perbaikan cepat lewat
   SQL Editor. Tanpa ini, `db reset` & provisioning environment baru mati.
4. **`ALTER TYPE … ADD VALUE` harus migrasi terpisah** (aturan rumah `0300:5-8`).
5. **React 19/Next 15: `name`/`value` tombol submit tidak masuk FormData** — satu `<form>`
   per aksi + hidden input.
6. **`npm run build` JANGAN saat `npm run dev` menyala.**
7. **Jangan pakai `brand_deals.shop_id`** untuk merchant target campaign (partial unique
   index `brand_deals_shop_uniq` + `brand_deals_sync_shop()` menulis `cooperating_shops`
   palsu). Pakai `target_location_id` (TikTok Location ID).
8. **Kunci merchant di file TikTok = `Location ID`**, bukan kolom `Merchant` (itu daftar OTA:
   Agoda/GoFood) dan bukan `Location name` (satu ID bisa 2 ejaan kapitalisasi).
9. **Ingest DILARANG auto-create kreator** — 594 kreator di satu file export vs 34 di
   `mcn_creators` production.

---

## 4. Perintah verifikasi (jalankan sebelum commit apa pun)

```bash
bash scripts/pg_test_reset.sh              # → 71 migrasi lolos dari nol
npx tsc --noEmit                            # → bersih
npm run build                               # → bersih (JANGAN saat dev menyala)
node scripts/test_campaign_completion.mjs   # → 15/15 (logika uang, wajib lolos)
node scripts/qc_content_analysis.mjs <2 file export>   # → 75/75, bila menyentuh parser
```

Paritas dua database:
```bash
psql -h /tmp -p 55432 -U postgres -d msdps_reset -tAq \
  -f scripts/schema_fingerprint.sql | LC_ALL=C sort > /tmp/fp_local.txt
# jalankan isi file yang sama lewat MCP Supabase execute_sql di staging & production
LC_ALL=C diff /tmp/fp_staging.txt /tmp/fp_prod.txt
```

---

## 5. Cara kerja yang diharapkan

- Branch baru per pekerjaan, commit + push, PR, merge — jangan commit langsung ke `main`.
- Migrasi: **file dulu di repo**, baru apply. Apply ke **staging dulu**, verifikasi, baru
  production.
- Kalau menemukan sesuatu yang bertentangan dengan dokumen ini atau `HANDOFF_FaseG.md`:
  **percaya database, lalu perbaiki dokumennya**. Handoff sebelumnya salah mendiagnosis drift
  staging justru karena gejalanya dicatat tanpa dikonfirmasi ke `schema_migrations`.
- Jangan laporkan "selesai" untuk hal yang belum diverifikasi dengan angka.
