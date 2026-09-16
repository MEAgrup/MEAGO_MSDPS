# Tutorial — Meneruskan Deal ke CDPS lewat "Teruskan ke CDPS"

> **Untuk tim BD/CM/Finance MEAGO!, bukan developer.** Dibuat 2026-09-16.
> Status teknis Bridge MSDPS→CDPS Fase 1: ✅ **kode selesai & LIVE** di kedua
> repo — sudah terbukti mengalirkan **satu deal nyata** (`DEAL-202609-0078`)
> sampai diterima dan dieksekusi tim Account CDPS. Dokumen status + tutorial
> lengkap (kedua sisi) ada di
> `AgencyAPP/docs/handoff/RUNBOOK_BRIDGE_MSDPS_OPERASIONAL.md` — baca itu
> kalau butuh detail sisi CDPS atau ingin tahu kenapa satu jenis pekerjaan
> ("Live Stream") masih bisa gagal diterima. Berkas ini hanya bagian
> **sisi MSDPS**: apa yang perlu Anda lakukan di `/deals`.

---

## 1. Kenapa fitur ini ada

MEAGO! menutup deal dengan merchant POI (Dining, Hotel, dst), tapi pekerjaan
eksekusinya — Account, Ads, Creative, Store Operation, Live Stream,
KOL-Non-Roster — dikerjakan tim MEA Agency di CDPS, bukan di MEAGO. Dulu
penyerahannya diketik ulang manual. Sekarang tombol **"Teruskan ke CDPS"**
di `/deals` mengirim deal itu sebagai satu "order" ke inbox CDPS, dan tim
Account di sana yang menerima + mengeksekusi.

**Ini SATU ARAH.** Begitu terkirim dan diterima, statusnya tidak dilaporkan
balik otomatis ke MSDPS (Fase 2, belum dibangun). Kalau perlu tahu progres
eksekusinya, tanya langsung ke tim Account CDPS.

## 2. Kapan tombolnya muncul dan berfungsi

Deal harus memenuhi **dua syarat**, keduanya dipaksa sistem (bukan pilihan):

1. **`bentuk_kerjasama = 'Berbayar'`** — deal Free/Barter tidak pernah bisa
   dibridge.
2. **Sudah punya transaksi Finance yang terverifikasi** — kalau deal belum
   punya transaksi sama sekali, baris deal itu akan menampilkan tombol
   **"Buat Transaksi Finance"** dulu. Klik itu lebih dulu (sekali saja per
   deal — tombolnya hilang begitu transaksi dibuat).

Kalau salah satu syarat belum terpenuhi, tombol "Teruskan ke CDPS" **tidak
akan muncul atau akan ditolak** — ini bukan bug, ini gerbang pembayaran yang
memang disengaja (deal yang belum dibayar/diverifikasi tidak boleh sampai ke
tim eksekusi).

## 3. Langkah mengirim

1. Buka `/deals`, cari deal yang sudah memenuhi §2.
2. Klik **"Teruskan ke CDPS"** di baris deal itu.
3. Di modal yang terbuka, tambahkan satu atau lebih **baris jenis
   pekerjaan** — pilih dari:
   - `Account`
   - `Ads`
   - `Creative`
   - `Store Operation`
   - `KOL-Non-Roster`
   - `Live Stream`

   Satu deal bisa punya beberapa baris jenis berbeda kalau paketnya
   membundel beberapa pekerjaan (mis. deal yang mencakup Account **dan**
   Creative — buat dua baris).
4. Per baris, isi:
   - **Qty** (jumlah).
   - **Catatan** (opsional, bebas teks).
   - **Nilai cross-charge** (opsional) — panel referensi harga di modal
     membantu Anda **melihat** harga standar untuk membantu mengetik angka
     ini, tapi **tidak mengisi otomatis**. Ketik sendiri nilainya.
   - **Alasan non-roster** — **WAJIB diisi** kalau jenisnya
     `KOL-Non-Roster`. Modal menolak submit tanpa ini.
5. Klik **"Teruskan ke CDPS"** untuk submit.

## 4. Sesudah submit — apa yang terjadi

- Baris yang Anda isi tersimpan dulu di MSDPS (`deal_bridge_lines`). Belum
  langsung terkirim ke CDPS saat itu juga.
- Ada job pengiriman otomatis yang jalan **tiap 10 menit**. Begitu jalan
  giliran deal Anda, ia dikirim ke CDPS dan badge status di baris deal
  berubah.
- Kalau pengiriman gagal (mis. CDPS sedang down), sistem **mencoba ulang
  otomatis** dengan jeda yang makin panjang, sampai 5 kali. Kalau tetap
  gagal sesudah 5 kali, itu masuk daftar "dead-letter" dan perlu diperiksa
  tim teknis — hubungi mereka dengan kode deal-nya (`DEAL-...`).
- **Satu order per deal, seumur Fase 1.** Kalau Anda submit lagi untuk deal
  yang **sama**, sistem tidak akan membuat order kedua (Anda akan melihat
  order/badge yang sama, bukan baris baru). Kalau Anda perlu menambah
  jenis pekerjaan baru untuk deal yang sudah pernah dikirim, **hubungi tim
  CDPS dulu** sebelum mencoba lagi — Fase 1 belum punya cara resmi untuk
  menambah baris ke order yang sudah terkirim.

## 5. Yang TIDAK ikut dikirim

Supaya tidak salah ekspektasi — hal-hal berikut **tetap sepenuhnya di
MEAGO/MCN MEA**, tidak pernah dikirim lewat bridge ini:

- Kebutuhan kreator/konten (jumlah kreator, jumlah konten).
- Jadwal visit / kunjungan.
- Laporan VT (visit tracking).

Kalau ada yang menanyakan salah satu dari ini soal deal yang sudah
di-bridge, jawabannya tetap dikerjakan di sistem MEAGO seperti biasa —
bridge ini murni serah-terima pekerjaan eksekusi Account/Ads/Creative/dst.

## 6. Kalau ada yang aneh

- **Tombol tidak muncul** → cek §2 (Berbayar + transaksi terverifikasi).
- **Submit ditolak dengan pesan soal `alasan_non_roster`** → wajib diisi
  untuk jenis `KOL-Non-Roster`, lihat §3 langkah 4.
- **Sudah terkirim tapi tim CDPS bilang "belum masuk" atau gagal diterima
  dengan pesan soal "belum dipetakan ke Master Service List"** → itu bukan
  masalah di sisi MSDPS. Artinya jenis pekerjaan yang Anda kirim belum
  punya padanan paket di CDPS (paling sering terjadi untuk jenis
  `Live Stream` — lihat catatan status di
  `AgencyAPP/docs/handoff/RUNBOOK_BRIDGE_MSDPS_OPERASIONAL.md` §2). Arahkan
  ke Director/tim Account CDPS untuk melengkapinya — order Anda tetap
  tersimpan menunggu, tidak hilang.
- **Order stuck lama tanpa status berubah** → cek dengan tim teknis apakah
  masuk dead-letter (§4).

---

Referensi teknis lengkap (kontrak payload, kedua sisi kode): lihat
`docs/BUILD_PLAN.md` baris "Bridge MSDPS→CDPS Fase 1" dan
`AgencyAPP/docs/BRIDGE_MSDPS_CONTRACT.md`.
