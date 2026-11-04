# Handoff ke CDPS — Bridge MSDPS→CDPS otomatis sejak DP (migrasi MSDPS 0377)

Tanggal: 2026-11-04 · Sisi MSDPS: PR #56 (merged `7c548e6`), migrasi 0377 sudah
diterapkan ke staging `vgjzvdpxrdoefoncuazw` dan production `mvcckptntrvzujqaoxxh`.

Dokumen ini berisi **prompt siap-tempel** untuk sesi Claude Code di repo
`MEAgrup/AgencyAPP` (CDPS), plus konteks yang dipakai untuk menyusunnya.

---

## Konteks singkat (apa yang berubah di MSDPS)

| | Sebelum | Sesudah (0377) |
|---|---|---|
| Pemicu kirim | BD klik "Teruskan ke CDPS" sesudah Finance approve | **Otomatis** begitu Finance memverifikasi pembayaran pertama |
| Syarat bayar | Terverifikasi (secara praktik: lunas) | **DP pun cukup** (`transactions.released_to_account_at` terisi) |
| Info bayar | Tidak ada | Persentase DP ditambahkan ke **`lines[].catatan`** setiap baris |
| Pilihan layanan | Di modal sesudah bayar | Saat deal didaftarkan (atau "Tidak perlu CDPS") |
| Bentuk payload | v1 | **Tetap v1** — nol kunci baru, `payload_versi` tetap 1 |

Contoh `catatan` baru:

```
"paket 3 bulan [Pembayaran klien saat diteruskan: DP 30% — Rp 4.500.000 dari Rp 15.000.000]"
"[Pembayaran klien: LUNAS 100% — Rp 15.000.000]"            ← baris tanpa catatan asli, lunas
```

- Persen dibulatkan **ke bawah** 1 desimal, pemisah desimal koma (`33,3%`).
- `attestation.nilai` tetap **nilai total kontrak**, bukan yang sudah dibayar.
- `attestation.diverifikasi_pada` = waktu verifikasi pembayaran **pertama** (bisa DP).
- Snapshot: info DP adalah kondisi saat diantre. Pelunasan berikutnya **tidak**
  dikirim ulang (Fase 1 satu arah, satu order per deal, idempotency `<DEAL>:1`).

## Kondisi CDPS production (`egddxfcnrtecheiykhlf`, dibaca 2026-11-04)

- `external_orders`: 5 `[Diterima]`, 4 `[Masuk]` (menunggu keputusan manusia).
- `external_service_map` aktif: Account, Ads, Creative, Store Operation,
  KOL-Non-Roster. **Tidak ada `Live Stream`** — padahal sejak MSDPS 0362
  (2026-09-12) `Live Stream` adalah jenis bridge sah, dan form MSDPS menawarkannya.
- `client_external_billing` menyimpan `nilai` + `nilai_cross_charge`, **tanpa**
  kolom jumlah/persen yang sudah dibayar.

Di MSDPS production saat ini: 30 deal Berbayar — 7 sudah di CDPS, 2 sudah
terverifikasi tapi belum diteruskan (menunggu BD mengisi "Layanan CDPS"),
21 belum punya transaksi Finance.

---

## PROMPT — tempel ke sesi Claude Code di repo `MEAgrup/AgencyAPP`

```text
Konteks: MSDPS (repo MEAgrup/MEAGO_MSDPS) baru mengubah Bridge MSDPS→CDPS Fase 1
menjadi OTOMATIS (migrasi MSDPS 0377, PR MEAGO_MSDPS#56, sudah live di production
sejak 2026-11-04). Order sekarang masuk ke endpoint kita
POST /api/v1/internal/bridge/orders tanpa BD menekan tombol, begitu Finance MSDPS
memverifikasi pembayaran PERTAMA — DP pun cukup. Bentuk payload TETAP kontrak v1
(docs/BRIDGE_MSDPS_CONTRACT.md + docs/fixtures/bridge_order_v1.json, payload_versi=1,
nol kunci baru). Satu-satunya perbedaan isi: setiap lines[].catatan kini diakhiri
ringkasan pembayaran, contoh:
  "paket 3 bulan [Pembayaran klien saat diteruskan: DP 30% — Rp 4.500.000 dari Rp 15.000.000]"
  "[Pembayaran klien: LUNAS 100% — Rp 15.000.000]"   (baris yang catatan aslinya kosong)
attestation.nilai tetap total kontrak; attestation.diverifikasi_pada = verifikasi
pembayaran pertama (bisa DP). Pelunasan berikutnya TIDAK dikirim ulang (satu arah,
satu order per deal, Idempotency-Key "<DEAL code>:1").

Tugasmu di sisi CDPS. Baca dulu docs/DECISIONS.md (entri 2026-09-10 "Bridge MSDPS→CDPS
Fase 1" + amandemen D2 2026-09-12), docs/BRIDGE_MSDPS_CONTRACT.md,
packages/domain/src/bridge.ts, dan handler route bridge di apps/api. Jangan menebak
bentuk dari kode MSDPS — kontrak adalah sumber kebenaran.

1. VERIFIKASI VALIDATOR (wajib, paling dulu).
   Pastikan validator payload bridge menerima `lines[].catatan` yang lebih panjang
   dan berisi karakter "—", "%", "[", "]", ",". Cek batas panjang (max length) di
   schema/zod/CHECK DB untuk catatan. Tambah tes yang mem-POST fixture v1 dengan
   catatan berformat baru di atas (DP dan LUNAS) dan membuktikan order masuk
   [Masuk]. Kalau ada batas yang membuat payload ditolak, longgarkan seperlunya
   (cukup untuk catatan asli ≤ 500 karakter + ringkasan ±90 karakter) dan catat
   alasannya. MSDPS menandai order 'dead' setelah 5x gagal + alert ke BD, jadi
   penolakan diam-diam di sini = order hilang.

2. TAMBAH PEMETAAN 'Live Stream' (data, bukan migrasi skema).
   external_service_map production saat ini hanya punya Account, Ads, Creative,
   Store Operation, KOL-Non-Roster. Sejak amandemen D2 (2026-09-12) 'Live Stream'
   adalah jenis bridge sah dan form MSDPS menawarkannya — order dengan baris Live
   Stream tidak bisa di-accept tanpa pemetaan ini. Langkah:
   a) Cek Master Service List: apakah paket MEAGO Live Stream sudah ada
      (MSV-…). Kalau belum, JANGAN membuat sendiri — laporkan ke saya nama paket
      yang dibutuhkan, karena isi Master Service List keputusan bisnis.
   b) Kalau sudah ada, siapkan satu baris external_service_map
      (sumber='MSDPS', external_service_type='Live Stream', master_service_id=<MSV>,
      aktif=true) lewat jalur admin yang biasa dipakai (UI admin / seed resmi),
      staging dulu lalu production. Tunjukkan SQL/aksinya ke saya sebelum production.

3. TAMPILKAN INFO DP DI ANTRIAN ORDER.
   Tim yang memutuskan accept/reject harus melihat sekilas bahwa klien baru bayar
   sebagian. Di halaman antrian/detail external_orders:
   - Parse ringkasan pembayaran dari lines[].catatan (pola "[Pembayaran klien …]"),
     tampilkan sebagai badge "DP 30%" / "Lunas" + tooltip nominalnya.
   - Parser harus toleran: catatan tanpa pola itu (order lama sebelum 2026-11-04)
     tampil tanpa badge, bukan error.
   - Jangan ubah payload yang tersimpan (payload immutable).
   Opsional bila sederhana: simpan juga persen hasil parse di
   client_external_billing saat accept (kolom baru nullable, mis.
   persen_terbayar_saat_diteruskan numeric) — tapi itu perubahan skema, ajukan
   dulu ke saya sebelum dibuat.

4. KEBIJAKAN ACCEPT UNTUK ORDER DP (butuh keputusan saya — tanyakan, jangan asumsikan).
   Usulkan opsi singkat: (a) accept seperti biasa, DP hanya info; (b) accept tapi
   tandai klien "belum lunas" untuk follow-up Finance; (c) tahan sampai lunas.
   MSDPS Fase 1 TIDAK mengirim update pelunasan, jadi opsi (c) butuh callback
   Fase 2 yang belum ada — sebutkan itu.

5. DOKUMENTASI.
   Tambah entri baru di docs/DECISIONS.md: "2026-11-03 — Amandemen Bridge Fase 1:
   order otomatis sejak DP (MSDPS 0377)", berisi: pemicu kini otomatis di sisi
   MSDPS; DP cukup; info DP di lines[].catatan tanpa perubahan kontrak; status
   pemetaan Live Stream; kebijakan accept DP (setelah saya putuskan). Perbarui
   docs/BRIDGE_MSDPS_CONTRACT.md hanya dengan CATATAN (bukan perubahan field)
   bahwa catatan bisa berisi ringkasan pembayaran berformat di atas.

Aturan: jangan ubah bentuk kontrak v1 atau payload_versi; jangan sentuh order yang
sudah ada; staging dulu sebelum production; laporkan hasil tes (perintah + output)
dan apa saja yang menunggu keputusan saya. Buat branch + PR draft untuk perubahan kode.
```

---

## Yang tetap perlu dikerjakan di sisi MSDPS (bukan CDPS)

- 2 deal production yang sudah terverifikasi tapi belum di CDPS → BD perlu
  mengisi "Layanan CDPS" (atau "Tidak perlu CDPS") di /deals; begitu disimpan,
  langsung diantre.
- 21 deal Berbayar lama tanpa transaksi Finance → otomatisasi transaksi hanya
  berlaku untuk deal baru / yang diedit; deal lama tetap lewat tombol cadangan
  "Buat Transaksi Finance".
- Jangan tawarkan/isi baris `Live Stream` untuk order nyata sampai poin 2 di
  atas beres di CDPS.
