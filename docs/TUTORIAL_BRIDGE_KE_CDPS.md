# Tutorial — Dari Daftar Deal sampai Diteruskan ke CDPS

> **Untuk tim BD/CM/Finance MEAGO!, bukan developer.** Dibuat 2026-09-16,
> direstruktur 2026-09-16. Status teknis Bridge MSDPS→CDPS Fase 1: ✅ **kode
> selesai & LIVE** di kedua repo — sudah terbukti mengalirkan **satu deal
> nyata** (`DEAL-202609-0078`, merchant "Salad Hut") sampai diterima dan
> dieksekusi tim Account CDPS.
>
> Berkas ini adalah **Bagian 1 & 2** dari tutorial lengkap — sisi MSDPS:
> siapa yang boleh bikin deal, bagaimana caranya, dan apa syaratnya supaya
> bisa diteruskan ke CDPS. **Bagian 3** (apa yang dikerjakan tim CDPS sampai
> pekerjaannya selesai) ada di repo sebelah:
> `AgencyAPP/docs/handoff/RUNBOOK_BRIDGE_MSDPS_OPERASIONAL.md` — dokumen itu
> juga memuat contoh kasus yang sama ("Kopi Kenangan Merdeka") dari awal
> sampai akhir, plus status verifikasi live dan cara melengkapi pemetaan
> "Live Stream" yang masih bolong.

---

## Bagian 1 — Siapa yang bisa membuat deal, dan bagaimana caranya

### 1.1 Siapa

| Peran | Bisa daftarkan deal? |
|---|---|
| BD (divisi `BizDev`) | ✅ |
| CM (divisi `CreatorManagement`) | ✅ |
| OD / Director | ✅ |
| Divisi lain (Ads, Creative, Finance, dst.) | ❌ |

Kalau tombol "Daftarkan Transaksi" tidak muncul di `/deals`, itu berarti
divisi Anda memang bukan salah satu dari tiga di atas.

### 1.2 Prasyarat: Lead harus sudah berstatus Dealing/Renewal

Deal **tidak bisa** didaftarkan dari nol — harus dipilih dari pool Lead
yang sudah berstatus `Dealing` atau `Renewal`. Kalau merchant belum ada di
pool itu:

1. Buat Lead-nya dulu di `/leads` (BD, Marketing, atau Director yang bisa
   membuat).
2. Jalankan pipeline sampai negosiasi selesai, lalu klik **"Update Status
   Leads"** dan pilih `Dealing` (atau `Renewal` untuk perpanjangan klien
   lama).

### 1.3 Langkah mendaftarkan deal — contoh kasus "Kopi Kenangan Merdeka"

Buka `/deals` → **"Daftarkan Transaksi"**. Isi:

| Field | Wajib? | Contoh |
|---|---|---|
| Nama POI/Merchant | ✅ (pilih dari pool Dealing/Renewal) | Kopi Kenangan Merdeka |
| Nama BD | ✅ | Ajeng (auto-terisi dari Lead) |
| Nama OPS | ✅ | — |
| Kategori POI | ✅ | `Dining` |
| Bentuk Kerja Sama | ✅ | `Berbayar` |
| Nama PIC POI + WhatsApp | ✅ | Budi, 628123456789 |
| Tanggal Awal/Akhir Kerjasama | ✅ untuk kategori `Dining` | 2026-09-16 s/d 2027-09-15 |
| Nominal Deals | ✅ | Rp 15.000.000 |
| Benefit | opsional | — |

Submit → sistem membuat `brand_deals` baru dengan kode otomatis
**`DEAL-202609-0099`** (format `DEAL-YYYYMM-NNNN`, immutable, dari nomor
urut bulan berjalan). **Sampai titik ini deal HANYA ada di MSDPS** — belum
ada apa pun terkirim ke CDPS.

---

## Bagian 2 — Apa syarat agar deal bisa diteruskan ke CDPS

Tombol **"Teruskan ke CDPS"** di baris deal tidak akan muncul/berfungsi
sampai dua gerbang berikut lolos — ini gerbang trigger database, bukan
pilihan UI yang bisa dilewati siapa pun, termasuk Director:

### 2.1 Gerbang 1 — Bentuk Kerjasama harus `Berbayar`

Deal `Free/Barter` tidak pernah bisa dibridge.

### 2.2 Gerbang 2 — Transaksi Finance dibuat DAN diverifikasi

1. Kalau deal belum punya transaksi, klik tombol **"Buat Transaksi
   Finance"** di baris deal itu (memanggil `create_poi_finance()`) — hasil
   `TRX-202609-00xx`. Tombolnya hilang sesudahnya (satu transaksi per deal;
   mencoba dobel ditolak dengan `[transaksi untuk deal ini sudah dibuat]`).
2. Tim **Finance** memverifikasi transaksi itu seperti biasa. Begitu
   terverifikasi, gerbang ini lolos.

### 2.3 Langkah mengirim

1. Klik **"Teruskan ke CDPS"**.
2. Tambahkan satu baris per **jenis pekerjaan**. Untuk "Kopi Kenangan
   Merdeka": `Account` (1 baris) + `Ads` (1 baris) — satu deal boleh
   beberapa jenis kalau paketnya membundel beberapa pekerjaan.

   Jenis yang tersedia: `Account`, `Ads`, `Creative`, `Store Operation`,
   `KOL-Non-Roster` (wajib isi `alasan_non_roster`), `Live Stream`. Per
   baris bisa isi `qty`, `catatan` (opsional), `nilai_cross_charge`
   (opsional — panel referensi harga membantu **melihat**, tidak mengisi
   otomatis).
3. Submit. Pengiriman ke CDPS **tidak instan** — job jalan tiap **10
   menit**. Badge status di baris deal berubah begitu terkirim.
4. Gagal kirim → retry otomatis (backoff), sampai 5 kali → dead-letter di
   `platform_alerts` (hubungi tim teknis, bawa kode deal).
5. **Satu order per deal seumur Fase 1.** Perlu menambah jenis pekerjaan
   baru untuk deal yang sudah pernah dikirim → hubungi tim CDPS dulu,
   Fase 1 belum punya jalur resmi untuk itu.

### 2.4 Yang TIDAK ikut dikirim

Supaya tidak salah ekspektasi — tetap sepenuhnya di MEAGO/MCN MEA, tidak
pernah dikirim lewat bridge ini: kebutuhan kreator/konten, jadwal visit,
laporan VT. Kalau ada yang menanyakan salah satu ini untuk deal yang sudah
di-bridge, itu tetap dikerjakan di sistem MEAGO seperti biasa.

---

## Bagian 3 — apa yang terjadi sesudahnya

Sesudah terkirim, order `ORD-` duduk di inbox CDPS. **Selebihnya (terima,
assign AM, onboarding, sampai pekerjaan benar-benar berjalan) adalah kerja
tim CDPS** — detail lengkap + lanjutan contoh kasus "Kopi Kenangan
Merdeka" ada di
`AgencyAPP/docs/handoff/RUNBOOK_BRIDGE_MSDPS_OPERASIONAL.md` Bagian 3.

## Kalau ada yang aneh

- **Tombol "Daftarkan Transaksi" tidak muncul** → cek §1.1, divisi Anda.
- **Merchant tidak ada di dropdown saat daftar deal** → Lead-nya belum
  `Dealing`/`Renewal`, lihat §1.2.
- **Tombol "Teruskan ke CDPS" tidak muncul/gagal** → cek §2.1–2.2.
- **Submit ditolak soal `alasan_non_roster`** → wajib untuk jenis
  `KOL-Non-Roster`.
- **Sudah terkirim tapi tim CDPS bilang gagal diterima dengan pesan soal
  "belum dipetakan ke Master Service List"** → bukan masalah sisi MSDPS
  (paling sering untuk jenis `Live Stream`) — arahkan ke Director/tim
  Account CDPS, order tetap tersimpan menunggu.
- **Order stuck lama** → cek dengan tim teknis apakah masuk dead-letter.

---

Referensi teknis lengkap: `docs/BUILD_PLAN.md` baris "Bridge MSDPS→CDPS
Fase 1" dan `AgencyAPP/docs/BRIDGE_MSDPS_CONTRACT.md`.
