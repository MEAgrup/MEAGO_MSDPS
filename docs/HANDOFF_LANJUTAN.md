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
| `docs/RUNBOOK_CAMPAIGN_PERTAMA.md` | Prosedur menjalankan campaign Fase G pertama (item 2) |
| `docs/BUILD_PLAN.md` | Tracker progres modul |

Jangan re-litigasi keputusan di `HANDOFF_FaseG.md` §5 — semuanya hasil interview 4 ronde
dan sudah dikunci.

---

## 1. Keadaan sekarang (fakta terverifikasi, bukan asumsi)

**Kode:** `main` = `984b814`. Migrasi terakhir `0350`. `bash scripts/pg_test_reset.sh`
→ **71 migrasi lolos dari nol**. `npx tsc --noEmit` bersih. `npm run build` bersih.
`node scripts/test_campaign_completion.mjs` → **15/15**.

**Environment Supabase:**
- production `mvcckptntrvzujqaoxxh` — sistem yang hidup, seluruh data operasional
- staging `vgjzvdpxrdoefoncuazw` — setara production pada **kolom, constraint, RLS
  policy, trigger (147), view (21), enum, bucket Storage (3), job pg_cron (4)** —
  ini diverifikasi lewat HASH, bukan jumlah. **TIDAK setara** pada definisi fungsi
  (26 dari 106 berbeda) dan satu index. Lihat item 3b. Klaim "setara ... fungsi (106
  signature)" di handoff sebelumnya membandingkan jumlah, bukan isi.

**Roster kreator:** ada di production — `mcn_creators` **2.250** baris, mencakup seluruh
2.248 roster bersih staging (terverifikasi lewat sidik jari, lihat item 1). Tapi kolom
segmentasi & akun portal masih kosong, jadi jangan simpulkan Fase G otomatis bisa dipakai.

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

### 1. ✅ Pindahkan roster kreator staging → production — **SUDAH SELESAI**
**Status per 2026-09-04:** sudah dijalankan **2026-09-03**, dan sekarang terverifikasi.
Handoff versi sebelumnya salah di sini — ia menulis "production cuma punya 34 kreator"
dan skripnya "belum pernah dijalankan". Keduanya keliru; percaya database.

Angka production hari ini:

| Ukuran | Nilai |
|---|---|
| `mcn_creators` total | **2.250** baris |
| dibuat 2026-07 (era QA) | 34 |
| dibuat 2026-09-03 (impor roster) | 2.216 |
| roster bersih (filter sama dgn skrip) | 2.249 |
| roster bersih di staging | 2.248 |
| kreator staging yang BELUM ada di production | **0** |

**Bukti paritas** (bukan sekadar jumlahnya kebetulan mirip): sidik jari
`scripts/creator_roster_fingerprint.sql` dijalankan di kedua database — 14 dari 16
bucket hash-nya **identik persis**, 2 bucket sisanya (`6b`, `d8`) berbeda hanya karena
production punya 1 baris ekstra masing-masing. Production adalah **superset** roster
staging.

Dua baris ekstra itu sisa era QA, keduanya dari Juli, bukan kreator asli:

| Code | Nama | Username | Catatan |
|---|---|---|---|
| `MCR-0032` | QA Dummy Creator | `qa.dummy.creator` | tersaring filter nama skrip |
| `MCR-0033` | udin | `@udin` | **lolos** filter (namanya tidak mengandung test/dummy/qa/coba); satu-satunya baris production yang username-nya masih diawali `@` |

Bukti independen bahwa skripnya benar-benar jalan lewat `ON CONFLICT DO NOTHING`:
`id_sequences` prefix `MCR` = **2.282** sementara barisnya 2.250. Selisih **32** = kode
yang terbakar trigger untuk baris yang lalu di-skip karena duplikat. Cocok dengan
2.248 − 32 = 2.216 baris yang benar-benar masuk. `code` unik 2.250/2.250, tidak ada
yang null — jadi tidak ada risiko bentrok kode di kemudian hari.

**SISA PEKERJAAN — roster ada, tapi belum tentu berguna.** Ini yang harus dibaca
sebelum menyatakan item ini beres untuk Fase G. `creator_meets_campaign_eligibility()`
(migrasi `0343`) membandingkan kolom `eligible_*` di `brand_deals` langsung ke kolom
kreator. Kolom itu di production **hampir seluruhnya kosong**:

| Kolom kreator | Filter campaign yang memakainya | Terisi |
|---|---|---|
| `niche` | `eligible_industries` | **1** / 2.250 |
| `city` | `eligible_cities` | 33 / 2.250 |
| `creator_level` | `eligible_levels` | 32 / 2.250 |
| `jenis_creator` | `eligible_creator_types` | **1** / 2.250 |
| `live_roster` | `eligible_roster_status` | 5 bernilai true |
| `status_kontrak` | `eligible_status_kontrak` | 2.250 — **semua `'kontrak'`** |
| `creator_period_summary` | `min_gmv` | 63 baris untuk 2.250 kreator |
| `auth_user_id` | (login portal) | **1** / 2.250 |

Konsekuensinya, dan ini bukan bug melainkan data yang memang belum ada:
1. Campaign yang mengisi `eligible_industries` / `cities` / `levels` /
   `creator_types` / `min_gmv` akan meloloskan **nyaris nol** kreator. Yang bisa
   dipakai sekarang hanya campaign yang membiarkan kolom `eligible_*` **NULL**
   (= tanpa filter).
2. `status_kontrak` seragam `'kontrak'` adalah **nilai asumsi hasil backfill `0339`**,
   bukan fakta bisnis. Memfilter dengan kolom ini sekarang meloloskan semua orang,
   jadi filternya terasa "jalan" padahal tidak menyaring apa pun.
3. **Hanya 1 kreator yang punya `auth_user_id`**, jadi praktis tidak ada yang bisa
   login ke Portal Kreator. Akun portal dibuat satu per satu oleh admin lewat
   `createCreatorAccount` (`lib/actions/portal.ts`) yang butuh **email per kreator** —
   dan roster ini tidak membawa email sama sekali. Ini **blocker sesungguhnya untuk
   item 2**, bukan jumlah kreatornya.

**Keputusan user 2026-09-04 — sudah diambil, jangan tanyakan ulang:**

| Pertanyaan | Keputusan |
|---|---|
| `MCR-0032` + `MCR-0033` dihapus? | **Tidak — biarkan.** Tidak mengganggu selama campaign tidak memfilter. Konsekuensinya kedua baris ikut terhitung di statistik `/meago/creators` dan tampil di daftar. Kalau suatu saat mau dibersihkan, lewat file migrasi, bukan `execute_sql` langsung. |
| Sumber email akun portal | **Belum ada — portal dibuka bertahap.** Email dikumpulkan manual per kreator, akunnya dibuat satu per satu lewat UI `/meago/creators`. Tidak ada impor massal. |
| Kolom segmentasi kosong | **Campaign pertama dijalankan tanpa filter** — seluruh kolom `eligible_*` dibiarkan NULL. Pengisian `niche`/`city`/`level`/`jenis_creator` diurus belakangan. |

**Akibat keputusan "buka bertahap" — sudah dikerjakan.** Card "Akun Portal Kreator" di
`/meago/creators` dulu merender `creators.map` tanpa batas. Dengan 34 kreator itu wajar;
dengan 2.250 kreator itu berarti **2.250 form email+password dalam satu halaman**, jadi
jalur "buat akun satu per satu lewat UI" praktis mustahil. Card itu sekarang punya kotak
pencarian (`?akun=`, filter server-side atas nama/username/kode, batas 50 hasil), dan
kreator yang sudah punya akun selalu tampil. Lookup email service-role juga tidak lagi
menyapu seluruh roster. Perubahannya di `app/(app)/meago/creators/page.tsx`.

**Cara memeriksa ulang kapan saja** — tanpa menarik nama kreator ke chat:
```bash
psql "$STAGING_URL" -tAqF'|' -f scripts/creator_roster_fingerprint.sql \
  | LC_ALL=C sort > /tmp/roster_staging.txt
psql "$PROD_URL"    -tAqF'|' -f scripts/creator_roster_fingerprint.sql \
  | LC_ALL=C sort > /tmp/roster_prod.txt
LC_ALL=C diff /tmp/roster_staging.txt /tmp/roster_prod.txt
```
Tanpa psql: tempel isi file itu ke MCP Supabase `execute_sql` di kedua project.

`scripts/migrate_creators_staging_to_prod.sh` **jangan dijalankan lagi** kecuali
sidik jari di atas menunjukkan ada yang hilang. Ia idempoten (`ON CONFLICT DO NOTHING`,
tidak menimpa apa pun), tapi setiap kali jalan ia tetap membakar nomor `id_sequences`
untuk baris yang di-skip.

### 2. 🔒 Jalankan satu campaign end-to-end dengan data nyata
> **Prosedur langkah demi langkahnya ada di `docs/RUNBOOK_CAMPAIGN_PERTAMA.md`** —
> sudah disesuaikan dengan tiga keputusan user di item 1 (portal bertahap, campaign
> tanpa filter). Bagian di bawah ini konteksnya saja.

Buat campaign → aktifkan → kreator daftar lewat portal → approve/kurasi → kreator submit
bukti → ingest export TikTok asli → `validate_campaign_posts()` → tutup batch kurasi →
payout muncul di `/finance`. Lalu **verifikasi angkanya masuk akal**, bukan cuma "tidak
error".

**Yang dibutuhkan dari user:** satu campaign sungguhan (atau izin memakai data uji di
production) + file export TikTok **"Content Analysis › Video List"** asli.

Sampai ini dilakukan, status yang jujur adalah "selesai dibangun & lolos unit test",
**bukan** "teruji".

⚠ **Blocker yang baru ketahuan (2026-09-04).** Item 1 sudah selesai — roster 2.248
kreator ada di production — tapi itu **tidak cukup** untuk menjalankan alur ini. Hanya
**1 dari 2.250** kreator yang punya `auth_user_id`, jadi langkah "kreator daftar lewat
portal" belum bisa dilakukan siapa pun. Akun portal dibuat per kreator oleh admin lewat
`createCreatorAccount` dan butuh **email**, yang tidak ikut terbawa di roster. Selain itu
seluruh kolom segmentasi (`niche`, `city`, `creator_level`, `jenis_creator`) kosong, jadi
campaign uji pertama **harus** membiarkan kolom `eligible_*` NULL. Rinciannya di item 1. Parser bukti sudah siap & teruji (75 QC assertion ke 2 file export nyata):
`node scripts/qc_content_analysis.mjs <file1.xlsx> <file2.xlsx>`.

### 3. ✅ Dua kelompok drift staging-lebih-maju — **SELESAI** (migrasi `0351`)
Diselidiki, diputuskan user, dan diterapkan 2026-09-04. Framing handoff lama keliru
untuk salah satunya.

**Kelompok A — `creator_video_gmv`: bukan "staging lebih maju", tapi beda grain.**
Handoff lama menulis "staging 23 kolom vs production 16", seolah superset. Nyatanya:

| | Bentuk | Kunci |
|---|---|---|
| repo `0317` + production | **per-video** | `video_id not null`, unique `(creator_id, video_id, period_start)` |
| staging | **per-kreator-per-minggu** | **tidak punya `video_id` sama sekali** |

Kode wajib bentuk per-video (`lib/actions/video-ingest.ts` menulis
`video_id/likes/comments/shares/conversion_rate`; `app/(app)/meago/gmv-video/page.tsx`
men-`select` `video_id, views, likes`). Jadi **aplikasi error bila dijalankan terhadap
staging** — yang menyimpang staging, bukan production. Kedua sisi 0 baris.

**Kelompok B — `acquisitions` + `acquisition_followups`: eksperimen SQL Editor.**
`git log -S` membuktikan `binding_end_date`, `kreator_kontrak`, dan
`acquisition_followups` **tidak pernah ada di repo** (jebakan §3 poin 3).
`lib/actions/acquisition.ts` hanya menulis 7 kolom dan tak pernah menyentuh keempatnya.

**Keputusan user:** keduanya **dibuang**, staging dikembalikan setara repo.

**Yang dikerjakan:** `0351_drop_staging_only_drift.sql` — drop 4 kolom + policy
`acquisitions_delete` + tabel `acquisition_followups`, dan bangun ulang
`creator_video_gmv` **hanya bila bentuknya salah** (dijaga: gagal keras kalau tabelnya
ternyata berisi data). Di production & `db reset` seluruhnya no-op.

**Terverifikasi:** `pg_test_reset.sh` → **72 migrasi lolos dari nol**; di database bersih
`0351` tidak mengubah apa pun. Staging sesudah apply: `acquisitions` 14 kolom (4 baris
utuh), `acquisition_followups` hilang, `creator_video_gmv` 16 kolom/3 policy/5 index/1
trigger — identik dengan database bersih. Production sesudah apply: **tidak berubah**
(14 kolom, 1 baris, `creator_video_gmv` tetap per-video, 2.250 kreator aman).

---

### 3b. 🔒 Drift definisi fungsi & index yang BARU KETAHUAN (2026-09-04)
Ditemukan saat memverifikasi paritas item 3 dengan `scripts/schema_fingerprint.sql`.
Dinomori `3b` karena ini temuan turunan item 3, bukan pekerjaan yang direncanakan.
**Handoff lama menyatakan staging "kini setara production ... fungsi (106 signature)" —
itu membandingkan JUMLAH, bukan definisi.** Jumlahnya memang sama; isinya tidak.

Hasil sidik jari staging ↔ production sesudah `0351`: **9 dari 11 kategori hash-nya
identik** (kolom, constraint, policy, RLS, trigger, view, enum, bucket, cron job).
Dua yang tidak:

**a. Index — 1 selisih.** Production punya `mcn_creators_status_kontrak_idx`, staging
tidak, dan **repo tidak membuatnya sama sekali**. Asalnya commit `e9d2817` yang membuat
index itu di `0316`; file `0316` kemudian ditulis ulang dan index-nya hilang dari repo.
Production menjalankan versi lama. Index ini praktis mati — `status_kontrak` cuma punya
**1 nilai berbeda** di 2.250 baris.

**b. Fungsi — 26 dari 106 berbeda definisinya.** Dibandingkan ke database bersih dari
repo:

| Kelompok | Jumlah | Contoh |
|---|---|---|
| staging menyimpang, **production cocok repo** | ~19 | `acquisitions_validate`, `close_deal`, `briefs_validate`, `mcn_purge_expired_weekly_data` |
| **production menyimpang dari repo** | 4 | `leads_validate`, `payouts_validate`, `transactions_validate`, `generate_health_monthly` |
| **staging & production dua-duanya beda dari repo** | 2 | `brand_deals_validate`, `enforce_status_transition` |
| ada di kedua environment, **tak ada di repo**, tak dipakai kode | 1 | `create_poi_finance(uuid, payment_intent)` |

Yang paling serius kelompok kedua dan ketiga: `leads_validate`, `payouts_validate`,
`transactions_validate` adalah validator uang/bisnis. **Production menjalankan logika
yang tidak bisa direproduksi `db reset`.** Dan `brand_deals_validate` berbeda di
ketiga tempat — cocok dengan peringatan jebakan §3 poin 1 bahwa `brand_deals` adalah
tabel dengan penulis paling ramai.

**Belum diperbaiki — sengaja.** Menyamakan fungsi berarti mengubah perilaku live, dan
untuk 6 fungsi itu belum jelas versi mana yang benar secara bisnis. **Tanyakan ke user
per fungsi**, jangan pilih sendiri. Untuk ~19 fungsi kelompok pertama, arahnya jelas
(staging disamakan ke repo) dan risikonya rendah karena staging bukan sistem hidup.

**Cara mengulang pemeriksaannya:** jalankan `scripts/schema_fingerprint.sql` di kedua
sisi lalu diff (§4). Untuk melokalisasi tanpa menarik semua definisi, kelompokkan per
`substr(md5(name),1,1)` dulu, baru turun ke bucket yang berbeda.

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
   **Dan bandingkan HASH, jangan JUMLAH.** Handoff 2026-09-04 menyatakan staging setara
   production karena kedua sisi punya "106 signature" fungsi — jumlahnya memang sama,
   tapi **26 di antaranya berbeda isi** dan baru ketahuan sehari kemudian (item 3b).
   Jumlah objek yang sama adalah bukti yang sangat lemah.
   Bandingkan juga ke **database bersih dari repo**, bukan hanya dua environment satu
   sama lain: kalau keduanya sama-sama menyimpang dari repo, diff antar-environment
   akan terlihat bersih dan menipu.
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

Paritas roster kreator staging ↔ production (sesudah menyentuh roster/ingest kreator):
```bash
psql "$STAGING_URL" -tAqF'|' -f scripts/creator_roster_fingerprint.sql \
  | LC_ALL=C sort > /tmp/roster_staging.txt
psql "$PROD_URL"    -tAqF'|' -f scripts/creator_roster_fingerprint.sql \
  | LC_ALL=C sort > /tmp/roster_prod.txt
LC_ALL=C diff /tmp/roster_staging.txt /tmp/roster_prod.txt
```

Paritas skema dua database:
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
