# DECISIONS — sisi MSDPS

Catatan keputusan yang mengubah perilaku sistem MSDPS. Keputusan Bridge
MSDPS→CDPS Fase 1 (D1–D16, 2026-09-10) aslinya dicatat di `docs/DECISIONS.md`
repo `MEAgrup/AgencyAPP` (CDPS); file ini mencatat perubahan yang diputuskan
dari sisi MSDPS. Ringkasan status implementasi tetap di `docs/BUILD_PLAN.md`.

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


## 2026-11-06 — Upload mingguan CM dipusatkan di /meago/gmv-video

**Sumber:** laporan Rizal (CM Lead); ACC Yohan 2026-11-06.

- Kartu **Upload Creator Analysis Mingguan** (`IngestForm` → `runIngest`) dipindah
  ke `/meago/gmv-video`; dihapus dari CM Workspace & Data Kreator. Ingest & tabelnya
  tidak berubah — hanya lokasi. Gate halaman sama dengan Data Kreator.
- **Upload GMV Video Mingguan** menerima export TikTok GO terkini
  "Content Analysis › Video List" (parser `content-analysis.ts` dipakai ulang; window
  wajib W1–W5) **atau** Template Baku MSDPS (format lama Filter+Data: Creator ID /
  Video ID / Video GMV). Tiga metode — Unggah File, Tempel dari Excel (+ periode form),
  Unduh Template — semuanya lewat `parseVideoGmvAny`; tidak ada jalur ingest kedua.
- Export Content Analysis tidak punya likes/comments/shares absolut → disimpan 0
  (default kolom), tidak ditebak dari rate.

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

**Bentuk data untuk CDPS Bridge** (pola sama dengan info DP 0377 — aditif,
`payload_versi` tetap 1, tanpa input ⇒ output identik fixture v1):

```json
"merchant_target": {
  "gmv_baseline": "12500000.00",   // string desimal seperti attestation.nilai, atau null
  "target_gmv":   "50000000.00",
  "link_akun":    "https://…",     // atau null
  "kategori":     "F&B"            // atau null
}
```

- Kunci top-level **opsional**; tidak dikirim untuk deal tanpa target (deal lama).
- Hanya dikirim bila env **`BRIDGE_KIRIM_MERCHANT_TARGET=1`**. Default **mati**:
  validator payload CDPS tidak bisa diverifikasi dari repo ini, dan payload yang
  ditolak berakhir `dead` sesudah 5 percobaan. Urutan aktivasi:
  1. CDPS menerima `merchant_target` opsional di validator bridge + menampilkannya
     ke Head/AM (prefill isian D7 saat accept, Head tetap bisa koreksi);
  2. kontrak `docs/BRIDGE_MSDPS_CONTRACT.md` di kedua repo diberi catatan kunci ini;
  3. set env di Vercel MSDPS, uji di staging dulu.
- Order yang sudah terkirim sebelum flag menyala **tidak** dikirim ulang
  (satu order per deal, payload immutable) — untuk deal itu Head tetap mengisi
  di CDPS seperti D7.

**Belum dikerjakan (sengaja, di luar diff ini):** `create_poi_finance()` masih
membuat baris `merchants` baru dengan `gmv_baseline = 0, target_gmv = 0`; bisa
diisi dari kolom deal bila nanti dibutuhkan modul merchant MSDPS.
