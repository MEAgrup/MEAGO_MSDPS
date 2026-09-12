# Handoff — Pensiun "Account & Service" (2026-09-12)

Dokumen sambungan untuk sesi berikutnya. Baca ini **sebelum** menyentuh apa pun
yang berhubungan dengan M6–M15, bridge, atau OKR di MSDPS.

Repo: `MEAgrup/MEAGO_MSDPS` · Branch: `claude/funny-bohr-f5qk12` · Commit: `5066e5f`
Repo `MEAgrup/AgencyAPP` (CDPS): **tidak disentuh sama sekali** di pekerjaan ini.

---

## 1. Kenapa pekerjaan ini ada

MEAGO! menutup deal dengan merchant POI, tapi tim yang mengerjakan pekerjaan
operasionalnya — Account, Ads, Creative, Store Operation — **tidak ada di MEAGO**;
semuanya duduk di MEA Agency dan bekerja di CDPS. MSDPS M6–M10 (beserta turunannya
M11–M15) dibangun lengkap sebagai mesin eksekusi kedua **dan tidak pernah
berpenghuni**.

Bridge MSDPS→CDPS Fase 1 (migr. `0360`, 2026-09-11) memindahkan penyerahannya:
deal Berbayar yang terverifikasi Finance diteruskan sebagai satu order `ORD-` ke
inbox CDPS, diterima manusia, lalu jadi `CLI-`/`SVC-`/`BRF-` dan dieksekusi di sana.

Jembatannya sudah berdiri ⇒ mesin eksekusi kedua di MSDPS tinggal beban: nav yang
menyesatkan, server action yang masih bisa menulis, dan tiga pg_cron yang tiap
Minggu mencetak skor dari tabel yang tidak diisi siapa pun lagi.

---

## 2. Keputusan pemilik yang sudah final — JANGAN dilitigasi ulang

| # | Keputusan |
|---|---|
| 1 | Pensiun **hanya di MSDPS**. CDPS tidak disentuh — nol kode, nol dokumentasi. |
| 2 | **Soft-retire**: nav mati + halaman nisan. Tabel, RLS, trigger, seluruh data historis **TETAP**. Nol `DROP`. |
| 3 | Ikut pensiun: `/account` (M6), `/ecommerce` (M7), `/ads` (M8), `/kol` (M9), `/livestream` (M10), `/board` (M11), **plus turunannya** `/portal` (M15+M12) dan `/management` (M13+M14). |
| 4 | **Tetap hidup**: `/merchants` (M4) dan `/campaigns` (M3). |
| 5 | Halaman nisan + pesan BI dalam kurung siku, nol query DB. |
| 6 | `cron.unschedule` tiga job M13/M14. Nol data dihapus. |
| 7 | `/okr` tetap hidup, difokuskan ke divisi non-operasional, **dengan view attainment baru** yang lepas dari mesin M14. |

Tambahan yang mengikat, dari `docs/BUILD_PLAN.md` §Locked decisions:

- Pensiun M6–M15 bersifat **LUNAK**. Mengusulkan `DROP` tabel/kolom modul itu =
  keputusan baru, bukan kelanjutan keputusan ini.
- OKR MSDPS menilai **divisi non-operasional saja**. `okr_targets` + enum
  `perf_role` **DIBEKUKAN** — target baru ditulis ke `okr_targets_meago`.

---

## 3. Apa yang sudah selesai (commit `5066e5f`)

### UI
- `components/retired.tsx` — halaman nisan bersama. Pesan
  `[modul ini sudah pindah ke CDPS — eksekusi layanan tidak lagi dijalankan di MEAGO]`
  + tombol ke `/deals`. **Nol query DB.**
- 8 `page.tsx` diganti jadi 9 baris yang me-render nisan itu.
- `app/(app)/layout.tsx`: grup "Account & Service" dicabut; menyusut jadi
  **"Merchant & Kampanye"** berisi `/merchants` + `/campaigns`. `/portal` dan
  `/management` dicabut dari grup Umum. `seeMerchants` tidak lagi memuat divisi
  `Account`. Lima flag mati dihapus.

### ⚠️ Yang SENGAJA tidak dihapus — jangan "dirapikan"
`forms.tsx` dan `lib/actions/{account,ecommerce,ads,kol,livestream,blocks}.ts`
**dibiarkan yatim di disk**. Itu bukan kelalaian, itu mekanismenya: Next.js hanya
mendaftarkan endpoint Server Action untuk action yang terjangkau dari module graph
route yang di-render. Begitu `page.tsx` berhenti meng-import `forms.tsx`, seluruh
action modul itu tidak ter-bundle dan **tidak bisa dipanggil lagi** — jalur tulisnya
tertutup tanpa menghapus satu baris riwayat pun, dan satu `git revert` mengembalikan
seluruh UI.

**Diverifikasi di build**, bukan diasumsikan:

```
lib/actions/account.ts     -> 0 referensi di .next/server/server-reference-manifest.json
lib/actions/ecommerce.ts   -> 0
lib/actions/ads.ts         -> 0
lib/actions/kol.ts         -> 0
lib/actions/livestream.ts  -> 0
lib/actions/blocks.ts      -> 0
lib/actions/okr.ts         -> 2   (selamat, tetap terdaftar)
lib/actions/bridge.ts      -> 1   (selamat)
lib/actions/finance.ts     -> 3   (selamat)
```

Alasannya juga ditulis di header `components/retired.tsx`.

### DB — migrasi `0361_pensiun_account_service.sql`
- `cron.unschedule` (ber-guard `if exists`, idempoten): `msdps_health_weekly`,
  `msdps_health_monthly` (0208), `msdps_perf_weekly` (0209).
  `msdps_retention_monthly` (0315) **sengaja dibiarkan jalan**.
- `okr_targets_meago` — tabel aditif (`division text` + CHECK 5 divisi), unique
  parsial saat `active`, `capture_audit('okr_target_meago')`, RLS cermin `0007`.
- `v_okr_attainment_meago` — pola tiga lapis `0314`
  (`_internal` definer → `_rows()` → view `security_invoker`).
- **Nol `drop` / `delete` / `truncate`.** Diverifikasi dengan grep.

**Kenapa tabel baru, bukan memperluas `okr_targets`:** `okr_targets.role` bertipe
enum `perf_role` (`0007:21`). `alter type ... add value` (a) tidak boleh dipakai di
transaksi yang sama dengan penambahannya, (b) **tidak bisa dibatalkan** — Postgres
tidak punya `drop value`, jadi "pensiun yang reversibel" jadi berbohong di level
tipe, dan (c) diam-diam membuat `generate_performance_scores` (`0209:94`,
`e.division::text::perf_role`) mulai menghasilkan angka untuk divisi yang mesinnya
baru saja dihentikan.

### OKR — 7 metrik baru
| Divisi | Metrik | Sumber | Default sementara |
|---|---|---|---|
| BizDev | Deal Berbayar baru / kuartal | `brand_deals` (`created_at`, `kategori_poi is not null`) | 12 |
| BizDev | Deal diteruskan ke CDPS / kuartal | `cdps_outbox` (`status='sent'`, `sent_at`) | 10 |
| Creator Management | GMV affiliate kreator / kuartal | `creator_period_summary.affiliate_gmv` **(dedup)** | Rp 500 jt |
| Akuisisi | Kreator baru binding / kuartal | `acquisitions.binding_date` | 30 |
| Marketing | ROAS (ditimbang) | `v_marketing_metrics` × `campaigns.start_date` | 4× |
| Marketing | Cost per Lead (ditimbang) | idem, `lte` | Rp 75.000 |
| Keuangan | Nilai terverifikasi / kuartal | delta `amount_verified` dari `audit_log` | Rp 300 jt |

Tiga koreksi yang lahir dari membaca skema asli (rencana awal salah):

1. **`installments` ternyata tabel mati.** `verify_payment()` (`0103:234`) hanya
   menambah `transactions.amount_verified` dan tidak pernah menyentuh
   `installments`; nol pemanggil di seluruh repo, status-nya selamanya
   `[Menunggu Verifikasi]`. Rumus Finance dipindah ke rekonstruksi delta dari
   `audit_log` (`trg_transactions_audit`, `0103:91`).
2. **GMV kreator wajib dedup.** Kunci unik `creator_period_summary` memuat
   `upload_batch`, jadi satu re-upload minggu yang sama **menggandakan GMV**.
   Dipakai `distinct on (mcn_creator_id, period_start) … order by created_at desc`,
   pola persis `v_project_summary` (`0308:124`).
3. **ROAS/CPL ditimbang (`sum/sum`), bukan rata-rata rasio** — `avg()` memberi
   kampanye Rp 1 juta bobot yang sama dengan kampanye Rp 100 juta.

Attainment tampil di `/okr` sendiri (pengganti `/management`), lengkap dengan
**pace** terhadap porsi kuartal yang sudah berlalu — tanpa itu tiap target
kumulatif selalu terbaca merah di minggu kedua.

### Verifikasi yang sudah dijalankan
- `scripts/pg_test_reset.sh` → **82 migrasi lolos dari nol**.
- `select jobname from cron.job` sesudah reset → **hanya** `msdps_retention_monthly`.
- View diuji dengan impersonasi (`request.jwt.claim.sub`, pola
  `test_bridge_gates.sql:97`): gerbang peran per divisi terbukti (lead Akuisisi
  hanya melihat barisnya sendiri), batas kuartal terbukti (binding di
  `quarter_start - 1` tidak terhitung), dedup terbukti (dua `upload_batch` →
  dihitung sekali).
- `npx tsc --noEmit` bersih · `next build` bersih.
- Bridge **50 + 16 + 25** assertion hijau · campaign-access **29** ·
  POI skor **8 skenario** · content-analysis **55** · campaign-completion **15**.

### Dokumentasi yang diperbarui (MSDPS saja)
`docs/BUILD_PLAN.md` (baris pensiun + 12 baris modul ditandai + 2 locked decision),
`docs/GLOSARIUM.md` (2 seksi baru), `docs/MCN_MEA_PLAN.md` +
`docs/MCN_MEA_CONCEPT.md` (koreksi bertanggal, kalimat asli disimpan),
`docs/SCHEMA_DRIFT.md` (delta 3 cron job = disengaja, bukan drift).

---

## 4. BELUM dikerjakan — langkah berikutnya

1. **Migrasi `0361` belum di-apply ke live** (`mvcckptntrvzujqaoxxh`). Sudah lolos
   dari nol di Postgres bersih, belum menyentuh production.
2. **UAT peramban** belum dijalankan: login per divisi yang selamat, buka 8 URL
   pensiun, pastikan `/deals` → "Teruskan ke CDPS" masih berfungsi penuh.
3. **Bukti data utuh di live** — jalankan sebelum & sesudah apply, angkanya harus
   identik:
   ```sql
   select
     (select count(*) from briefs)                     as briefs,
     (select count(*) from strategies)                 as strategies,
     (select count(*) from complaints)                 as complaints,
     (select count(*) from sku_work_units)             as sku,
     (select count(*) from ad_campaign_records)        as adc,
     (select count(*) from creator_bookings)           as bookings,
     (select count(*) from live_stream_results)        as lsr,
     (select count(*) from merchant_health_snapshots)  as health,
     (select count(*) from performance_scores)         as perf;
   ```
4. **Target OKR nyata** belum ditetapkan Director — 7 angka di tabel §3 masih
   default tebakan.

---

## 5. Pertanyaan yang butuh keputusan pemilik

> Nomor 1 dan 2 memblokir; sisanya tidak.

**P1. Live Stream (M10) pensiun tanpa pengganti di CDPS.** Keputusan bridge D2
menetapkan Live Stream **tidak pernah di-bridge**, dan `jenis` baris bridge hanya
`Account | Ads | Creative | Store Operation | KOL-Non-Roster`. Jadi `/livestream`
(forward ke vendor, Template Baku, GMV otoritatif) mati tanpa tujuan baru.
*Catatan: ini BUKAN "Jadwal Live" MCN (`/meago/schedule`, `live_schedule_slots`)
yang tetap hidup — dua hal berbeda.* **Ke mana pekerjaan live-stream merchant
MEAGO sekarang?** Kalau jawabannya "masih dikerjakan di MSDPS", `/livestream`
harus dikeluarkan dari daftar pensiun.

**P2. Bridge belum melewati kriteria keluar Fase 1-nya** (*5–10 deal nyata
mengalir `DEAL-` → `ORD-` → `CLI-`/`SVC-`/`BRF-`*), dan pengukuran production
terakhir menemukan gerbang D13 menolak **100% deal** (nol `transaction_id` terisi
dari 82 deal, 17 Berbayar). **Apply `0361` ke live sekarang, atau tunggu satu deal
benar-benar mengalir dulu?** Pensiunnya reversibel penuh, jadi keduanya aman —
ini soal urutan, bukan risiko.

**P3. Karyawan divisi Account/Ads/KOL/Ecommerce/LiveStream** akan melihat sidebar
nyaris kosong (hanya Dashboard) begitu deploy. Dinonaktifkan, dipindah divisi, atau
dibiarkan dan cukup diumumkan? Saya tidak menyentuh tabel `employees`.

**P4. Tujuh angka target OKR** (§3) — berapa angka nyata dari Director per divisi
untuk kuartal berjalan?

**P5. Tutup jalur tulis manual terakhir?** `generate_health_snapshots`,
`generate_health_monthly`, `generate_performance_scores` masih bisa dipanggil
manual oleh OD/Director walau cron-nya mati. Satu `revoke execute … from
authenticated` menutupnya; reversibel dengan satu `grant`. Ya/tidak.

**P6. Boleh menyentuh dokumen CDPS di sesi berikutnya?** Saat ini
`AgencyAPP/docs/backlog/BRIDGE_MSDPS_BACKLOG.md` masih menulis *"Part B (MSDPS)
belum dimulai"*, padahal Part B rilis 2026-09-11 (`aa5d0a9`, `fb1a10d`). Anda
melarang menyentuh CDPS di pekerjaan ini; larangan itu masih berlaku?

**P7. `okr_targets` lama + `v_okr_attainment` lama dibiarkan hidup** tapi tidak
dibaca siapa pun. Dibiarkan apa adanya (pilihan saat ini), atau ditandai `comment
on` sebagai inert? Tetap **tanpa** `DROP`.

---

## 6. Perlu berapa repo untuk lanjut?

**Tergantung apa yang dikerjakan berikutnya:**

| Pekerjaan berikutnya | Repo |
|---|---|
| Apply `0361` ke live, UAT peramban, set target OKR, metrik OKR tambahan, perbaikan `/deals` | **MSDPS saja** |
| Membuat bridge benar-benar mengalir (kriteria keluar Fase 1) | **DUA repo** |
| Bridge Fase 2 (callback status CDPS → MSDPS) | **DUA repo** |

**Kenapa "membuat bridge mengalir" butuh dua repo:** sisi kirim ada di MSDPS
(`cdps_outbox`, cron delivery, tombol di `/deals`), tapi **sisi terima seluruhnya
di CDPS** — `external_orders`, `bridge.accept()`, `/bridge/inbox`, dan admin
`external_service_map`. Empat prasyarat go-live juga semuanya di CDPS:

1. Paket MEAGO dibuat di Master Service List (Sales Head + Head Account);
2. `external_service_map` diisi — **lahir kosong**, dan selama kosong setiap
   `accept()` gagal dengan `[layanan MEAGO belum dipetakan ke Master Service List]`;
3. Satu employee layanan "MEAGO Bridge" + env `MEAGO_BRIDGE_EMPLOYEE_ID`;
4. Transaksi Finance MSDPS untuk deal pilot diverifikasi.

Artinya: kalau sesi berikutnya hanya membuka MSDPS, order **akan terkirim tapi
nyangkut di inbox CDPS** dan tidak ada yang bisa memperbaikinya dari sisi MSDPS.

---

## 7. Rencana asli (dibawa utuh)

Rencana yang disetujui sebelum implementasi tersimpan sebagai bagian dokumen ini:
bagian **§2 (keputusan)**, **§3 (apa yang dikerjakan)**, dan **§5 (pertanyaan)** di
atas adalah bentuk final rencana itu sesudah dikoreksi oleh skema nyata. Tiga
penyimpangan dari rencana awal dicatat eksplisit di §3 ("tiga koreksi") —
`installments`, dedup GMV, dan ROAS/CPL ditimbang — supaya sesi berikutnya tahu
bahwa versi rencana yang lebih awal (kalau ditemukan di tempat lain) sudah usang
pada tiga titik itu.

## 8. Perintah cepat sesi berikutnya

```bash
cd MEAGO_MSDPS && npm ci
bash scripts/pg_test_reset.sh          # harus: 82 migrasi lolos
npx tsc --noEmit                       # harus bersih
npx next build                         # JANGAN saat `npm run dev` menyala
node scripts/qc_bridge_payload.mjs     # 50
node scripts/test_bridge_delivery.mjs  # 16
```
