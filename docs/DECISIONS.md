# DECISIONS — sisi MSDPS

Catatan keputusan yang mengubah perilaku sistem MSDPS. Keputusan Bridge
MSDPS→CDPS Fase 1 (D1–D16, 2026-09-10) aslinya dicatat di `docs/DECISIONS.md`
repo `MEAgrup/AgencyAPP` (CDPS); file ini mencatat perubahan yang diputuskan
dari sisi MSDPS. Ringkasan status implementasi tetap di `docs/BUILD_PLAN.md`.

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
