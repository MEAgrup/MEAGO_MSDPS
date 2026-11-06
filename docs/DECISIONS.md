# DECISIONS — sisi MSDPS

Catatan keputusan yang mengubah perilaku sistem MSDPS. Keputusan Bridge
MSDPS→CDPS Fase 1 (D1–D16, 2026-09-10) aslinya dicatat di `docs/DECISIONS.md`
repo `MEAgrup/AgencyAPP` (CDPS); file ini mencatat perubahan yang diputuskan
dari sisi MSDPS. Ringkasan status implementasi tetap di `docs/BUILD_PLAN.md`.

---

## 2026-11-06 — CM Workspace: GMV per kategori, search kreator, Report Kreator Bulanan otomatis

**Sumber:** permintaan Rizal (CM Lead); ACC owner (Yohan) 2026-11-06.

**Audit sebelum coding (supaya tidak dobel):**

- Kartu "Report Kreator" (`/meago/creators`, 0312) sudah ada, tapi isinya cuma
  **upload file manual**. Belum ada report yang disusun otomatis dari data.
- GMV Video (`creator_video_gmv`, 0317 + `/meago/gmv-video`) sudah ada, tapi di
  live belum pernah diisi.
- CM Workspace (Growth W1-W5 + Detail Mingguan) belum punya search.
- **Belum ada sumber data kategori.** Export Creator Analysis & GMV Video tidak
  punya kolom kategori. `mcn_creators.niche` baru terisi di 10 dari 2.262
  kreator, dan `creator_subcat_segment_gmv` (jalur legacy) kosong di live.

**Keputusan:**

1. **GMV per kategori = upload per kategori** (pilihan Yohan). CM mengunduh
   export Creator Analysis yang sudah **difilter per kategori di TikTok**, lalu
   memilih kategorinya di form "Upload Data Mingguan" (All / Dining /
   Accommodation / TTD / LIVE). Sistem **tidak menebak** kategori dari isi file.
   - **All tetap di `creator_period_summary`** (nol perubahan perilaku).
     Dining/Accommodation/TTD/LIVE masuk **tabel terpisah**
     `creator_period_category_summary` (migr. 0383). Alasannya: semua pembaca
     lama (Growth, `perf_drop`, rata-rata GMV master, portal `/kreator/performa`)
     dedupe per (kreator, minggu) dengan "created_at terbaru menang". Kalau
     baris kategori disimpan di tabel yang sama, upload Dining sesudah All akan
     menimpa angka total minggu itu di semua pembaca tersebut.
   - Upload kategori **tidak** menjalankan sync master, alert binding/perf_drop,
     atau auto-fill GMV master, karena semua itu berbasis angka All.
   - Kategori hanya untuk format Creator Analysis. File legacy dengan kategori
     selain All ditolak, tidak disimpan diam-diam sebagai All.
   - Kategori bisa beririsan (mis. LIVE juga Dining), jadi jumlah kategori
     tidak harus sama dengan All. Hal ini ditulis juga di UI.
   - Portal kreator **tidak** diberi akses ke tabel baru karena belum diminta.
2. **Search kreator** di CM Workspace: satu kotak search (username / nama /
   kode, "@" diabaikan) yang berlaku untuk Growth, Detail Mingguan, dan
   breakdown kategori. Parameter `q` & `cat` ikut terbawa di navigasi
   bulan/minggu.
3. **Report Kreator Bulanan otomatis** (`/meago/creators/report`) melengkapi
   upload manual, tidak menggantikannya. Isinya disusun dari data yang sudah
   ada: performa All W1-W5, GMV per kategori, GMV Video per minggu + 10 video
   terlaris. Bisa dicetak/PDF atau diunduh Excel. Kalau ingin dibaca kreator di
   portal, CM tinggal mengunggah hasilnya lewat kartu yang sama. Akses sama
   dengan kartu Report Kreator: CM + management. Staff CM hanya bisa membuka
   kreator miliknya.

**Status migrasi 0383:** file saja, **belum di-apply** ke staging/live. Sebelum
di-apply, tab kategori tampil "—" dan upload kategori gagal dengan pesan error,
sementara jalur All tidak terpengaruh.

**Tes:** `scripts/qc_creator_category_report.mjs` (40 assertion lib),
`scripts/test_creator_category_summary.sql` (14 assertion RLS/CHECK/retensi),
`scripts/pg_test_reset.sh` (102 migrasi lolos dari nol).


---

## 2026-11-06 — Akuisisi: dashboard performa, field binding, PIC CM ditetapkan Akuisisi (0382)

**Sumber:** laporan Siti (tim Akuisisi); ACC owner (Yohan) 2026-11-06.

**Sebelum dikerjakan dicek yang sudah ada** supaya tidak dobel:

| Diminta | Kondisi sebelumnya | Keputusan |
|---|---|---|
| Dashboard performa akuisisi | Belum ada (hanya daftar di `/acquisition` + OKR "kreator binding / kuartal") | Halaman baru `/acquisition/dashboard` |
| UID, WA, GMV Potential, Tgl Binding Akhir | Tidak ada di skema resmi (versi staging-only dibuang 0351) | Kolom baru di `acquisitions` (0382), nullable |
| Jenis Kontrak | **Sudah ada**: `mcn_creators.status_kontrak` ('kontrak' / 'non kontrak', 0316) | **Dipakai ulang**, diisi dari form binding |
| PIC CM | **Sudah ada**: `mcn_creators.owner_cpm_id` (handoff & scope CM) | **Dipakai ulang**, diisi dari form binding |
| Assignment PIC CM | Hanya CM Lead/mgmt (`assignOwner`, cek di aplikasi; RLS 0302 sudah mengizinkan Acquisition) | Akuisisi boleh menetapkan — lihat di bawah |

**Field binding (form "Catat Akuisisi (Binding)" dan form akuisisi di modal Prospek Kreator):**

- Keenam field **wajib untuk binding baru**, ditegakkan di `recordAcquisition`
  (`lib/mcn/binding-fields.ts`), **bukan** `NOT NULL` — baris lama tidak punya nilainya.
- UID = angka 5–25 digit; WA dinormalisasi `62xxxx` (aplikasi + trigger DB
  `normalize_phone_62`); GMV Potential ≥ 0, format rupiah ditoleransi;
  Tgl Binding Akhir ≥ Tgl Binding. CHECK constraint di DB sebagai jaring terakhir.
- WA disimpan di `acquisitions`, **bukan** `mcn_creators` — konsisten dengan
  keputusan 2026-10-19 (kontak kreator tidak masuk master kreator). Di modal
  Prospek, WA terisi otomatis dari nomor pendaftar.
- Nilai Jenis Kontrak memakai dua nilai yang sudah ada (`kontrak` / `non kontrak`).
  Bila tim butuh kategori lain (mis. eksklusif), itu perubahan CHECK 0316 terpisah.

**PIC CM oleh Akuisisi:**

- Saat binding, Akuisisi **wajib** memilih PIC CM (karyawan Creator Management
  aktif) → `mcn_creators.owner_cpm_id`. Tombol "Handoff Selesai" tidak lagi
  menunggu CM Lead.
- Selama handoff **belum** selesai, Akuisisi bisa mengganti PIC CM dari tabel
  Daftar Akuisisi (`assignPicCm`). **Sesudah** handoff, penugasan ulang kembali ke
  CM Lead lewat Data Kreator (`assignOwner`, tidak berubah).
- Tidak ada perubahan RLS: update `mcn_creators` oleh Acquisition sudah diizinkan sejak 0302.

**Definisi metrik dashboard** (`lib/mcn/acquisition-stats.ts`, filter: periode, PIC, sumber lead):

- **Scouting** = prospek baru di periode (tanggal WIB): `creator_prospects` →
  PIC prospek (`owner_id`, tanpa PIC tampil sebagai "Belum ada PIC"), plus
  kreator yang didaftarkan manual oleh staf Acquisition ("Daftarkan Prospek",
  `mcn_creators.created_by`) — kreator hasil tautan prospek tidak dihitung dua kali.
- **Binding** = `acquisitions.binding_date` di periode → `specialist_id`.
- **CR** = Binding ÷ Scouting **periode yang sama** (rasio aktivitas, bukan kohort).
- **GMV** = Σ `gmv_post_join` (aktual, terisi lewat "Refresh GMV") dan Σ `gmv_potential`.
- Filter sumber lead hanya berlaku ke Binding & GMV (prospek tidak punya `lead_source`).

---



---

## 2026-11-06 — Baseline & Target GMV diisi BD di MSDPS (MEMBALIK Bridge D7)

**Sumber:** email Tim OD 2026-10-30; ACC eksplisit owner (Yohan) 2026-11-06.

**Keputusan lama (D7, 2026-09-10):** GMV Baseline & Target diinput **Head di
CDPS saat menerima (accept) order Bridge**.

**Keputusan baru:** diisi **BD di MSDPS**, di form "Daftarkan Transaksi"
(tab Merchant Deals), lalu dibaca Head/AM di CDPS:

| Isian | Kolom `brand_deals` (migr. 0379) | Wajib? |
|---|---|---|
| GMV Baseline | `merchant_gmv_baseline` (numeric ≥ 0) | opsional |
| Target GMV | `merchant_target_gmv` (numeric > 0) | **wajib untuk deal baru** |
| Link Akun Merchant | `link_akun_merchant` (http/https) | opsional |
| Kategori | `kategori_merchant` (teks bebas ≤ 100) | opsional |

Detail yang diputuskan saat implementasi:

- **Wajib hanya untuk deal baru** — ditegakkan di `registerDealTransaction`,
  bukan `NOT NULL`, karena deal sebelum 0379 dan hasil Import Bulking tidak
  punya nilainya. Edit / approval Director tidak mewajibkan.
- **Prefix `merchant_`** — `brand_deals.target_gmv` sudah ada sejak 0342 dan
  milik campaign MEA GO (target campaign kreator). Makna berbeda, tidak dicampur.
- **"Kategori" ≠ `kategori_poi`** — `kategori_poi` (TTD/Accomodation/Dining)
  tetap seperti semula; `kategori_merchant` adalah kategori bisnis merchant.

**Bentuk data untuk CDPS Bridge** — DIKOREKSI 2026-11-06 (laporan Yulianti/CMA:
angka BD tidak muncul di CDPS). Versi awal PR #61 mengirim blok top-level
`merchant_target` dengan `link_akun`, padahal CDPS (AgencyAPP #563,
`parsePayloadV1` + `docs/BRIDGE_MSDPS_CONTRACT.md`) membaca **4 field opsional di
dalam `merchant`**. Bentuk yang berlaku (aditif, `payload_versi` tetap 1):

```json
"merchant": {
  "...": "field v1 seperti biasa",
  "gmv_baseline": "12500000.00",   // string desimal seperti attestation.nilai, atau null
  "target_gmv":   "50000000.00",   // atau null (deal lama)
  "link_toko":    "https://…",     // ← brand_deals.link_akun_merchant, atau null
  "kategori":     "F&B"            // ← brand_deals.kategori_merchant, atau null
}
```

- Blok top-level `merchant_target` **tidak pernah dikirim** lagi.
- Hanya diisi bila env **`BRIDGE_KIRIM_MERCHANT_TARGET=1`**. Default **mati** ⇒
  `merchant` identik fixture v1. Aktivasi: set env di Vercel MSDPS, uji staging dulu.
- Order yang sudah terkirim sebelum flag menyala / sebelum koreksi ini **tidak**
  dikirim ulang (satu order per deal, payload immutable) — untuk deal itu Head
  tetap mengisi di CDPS seperti D7.

**Belum dikerjakan (sengaja, di luar diff ini):** `create_poi_finance()` masih
membuat baris `merchants` baru dengan `gmv_baseline = 0, target_gmv = 0`; bisa
diisi dari kolom deal bila nanti dibutuhkan modul merchant MSDPS.
