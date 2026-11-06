# Tutorial MEAGO MSDPS — Lanjutan 6 Nov 2026

Salinan markdown dari bagian tambahan di Google Doc **Tutorial MEAGO MSDPS**
(https://docs.google.com/document/d/152LM9WUZbkwpt6jEUOVSVato017C0fp-gxBo2n-CNZo/edit).
Google Doc tetap menjadi sumber utama untuk user. File ini hanya berisi bagian yang
**ditambahkan** pada 6 Nov 2026. Isi lama di Google Doc tidak diubah.

## Changelog

Baris terbaru ada di paling atas. Kolom yang sama dengan tabel Changelog di Google Doc.

| Tanggal | Fitur | Peminta | Status |
|---|---|---|---|
| 6 Nov 2026 | Tutorial lanjutan: Upload GMV Video format baru + kartu Creator Analysis pindah ke GMV Video; Report Kreator Bulanan, search kreator & GMV per kategori; Dashboard Akuisisi + field binding; Baseline BD terkirim ke CDPS; laporan merchant besar tidak timeout lagi (internal: PR #62, #63, #64, #66, c8e44bd; migrasi 0382, 0383, 0384) | Rizal (CM Lead), Siti (Akuisisi), Yulianti (CMA), Yohan | Live prod sejak 6 Nov 2026; kirim Baseline ke CDPS menunggu flag di Vercel dinyalakan |

---

## A. Upload GMV Video Mingguan format baru & kartu Creator Analysis pindah ke halaman GMV Video (6 Nov 2026)

**Untuk siapa:** CM (Creator Management) staff & Lead, Director/OD. Halaman GMV Video Mingguan juga terbuka untuk BizDev.

**Tujuan:** Semua upload data mingguan kreator sekarang ada di **satu halaman**. Upload GMV per video menerima file export TikTok GO terbaru, bisa juga lewat tempel dari Excel atau Template Baku.

> **Penting, ini mengganti panduan 2 Nov:** kartu **Upload Data Mingguan** (Creator Analysis) **sudah tidak ada lagi** di CM Workspace dan Data Kreator. Kartu itu dipindah ke halaman **GMV Video Mingguan** dengan nama **1. Upload Creator Analysis Mingguan**. Cara kerjanya tidak berubah.

### Langkah klik — Creator Analysis (1 baris = 1 kreator per minggu)

1. Sidebar **CM Kreator → GMV Video Mingguan**.
2. Di kartu **1. Upload Creator Analysis Mingguan**, klik **File Performa (CSV/XLSX)** lalu pilih file export Creator Analysis dari TikTok.
3. **Kategori export:** biarkan **All** untuk data utama. Pilih Dining / Accommodation / Things to Do (TTD) / LIVE hanya kalau file di-export dengan filter kategori itu (lihat bagian B).
4. Klik **Upload & Proses**, lalu tunggu sampai muncul pesan hijau (berhasil) atau merah (gagal).
5. Cek hasilnya di **CM Workspace → Growth W1–W5 / Detail Mingguan**.

### Langkah klik — GMV per video (1 baris = 1 video)

1. Masih di halaman **GMV Video Mingguan**, buka kartu **2. Upload GMV Video Mingguan**.
2. Pilih salah satu cara:
   - **Unggah File**: pilih file export TikTok GO **Content Analysis › Video List** (nama file biasanya `ContentAnalysis_VideoList_….xlsx`) **atau** file Template Baku MSDPS.
   - **Tempel dari Excel**: isi **Periode Mulai** dan **Periode Selesai**, blok tabel di Excel **termasuk baris judul kolom**, salin (Ctrl+C), lalu tempel (Ctrl+V) di kotak **Data dari Excel**.
   - **Unduh Template Baku**: unduh template, isi sheet *Filter* (tanggal awal & akhir, format `YYYYMMDD`) dan sheet *Data* (1 baris per video), hapus baris contoh, lalu unggah lewat **Unggah File**.
3. Klik **Upload & Proses**.
4. Baca ringkasan hasil: jumlah baris, kreator, dan video. Ringkasan juga mencatat kreator baru yang dibuat otomatis dan baris yang dilewati.
5. Cek tabel **Riwayat Mingguan** di bawah. Minggu baru tidak menimpa minggu sebelumnya.

### Arti field penting

| Field | Arti |
|---|---|
| Periode / window W1–W5 | Satu minggu kalender: W1 = tgl 1–7, W2 = 8–14, W3 = 15–21, W4 = 22–28, W5 = 29–akhir bulan. File harus tepat satu window dan tidak boleh lintas bulan. |
| Creator ID (Template Baku) | Username TikTok kreator, bukan angka UID. |
| Video GMV (Template Baku) | Angka polos tanpa "Rp" dan tanpa titik ribuan. |
| Proses ulang jika file duplikat | Centang hanya bila memang ingin menimpa data periode yang sama dengan file yang sama. |
| Kolom Video (Riwayat) | Jumlah video kreator itu di minggu tersebut. |

### Kesalahan umum / tips

- **"Format file tidak dikenali"**: file bukan export Video List atau Template Baku. Jangan upload file Creator Analysis di kartu 2, karena Creator Analysis tempatnya di kartu 1.
- **Periode ditolak**: rentang tanggal export bukan satu window W1–W5. Export ulang per minggu sesuai window.
- **"File identik sudah diproses sebelumnya"**: file yang sama sudah masuk. Tidak perlu upload lagi. Centang *Proses ulang* hanya kalau memang perlu menimpa.
- Export Video List dari TikTok GO tidak berisi angka likes/komentar/share absolut, jadi kolom itu kosong. Ini normal, bukan error.
- Kalau format export TikTok berubah dan ditolak, pakai **Template Baku** atau **Tempel dari Excel**.

**Status:** Live sejak 6 Nov 2026.

---

## B. Report Kreator Bulanan otomatis, search kreator di CM Workspace & GMV per kategori (6 Nov 2026)

**Untuk siapa:** CM staff & CM Lead, Director/OD.

**Tujuan:** (1) Membuat report bulanan per kreator otomatis dari data yang sudah diunggah, tanpa rekap manual. (2) Mencari kreator dengan cepat di CM Workspace. (3) Melihat GMV per kategori: All, Dining, Accommodation, TTD, dan LIVE.

### B1. Upload GMV per kategori

1. Di TikTok, export **Creator Analysis** dengan filter kategori (mis. Dining) untuk satu minggu.
2. Sidebar **GMV Video Mingguan** → kartu **1. Upload Creator Analysis Mingguan**.
3. Pilih file, lalu pada **Kategori export** pilih kategori **yang sama** dengan filter saat export (Dining / Accommodation / Things to Do (TTD) / LIVE).
4. Klik **Upload & Proses**.
5. Ulangi untuk kategori lain. File **All** tetap wajib diunggah seperti biasa karena menjadi data utama Growth.

### B2. Search kreator & tab kategori di CM Workspace

1. Sidebar **CM Kreator → CM Workspace**.
2. Di kartu **Cari Kreator & Kategori GMV**, ketik username / nama / kode kreator (boleh pakai "@" di depan), lalu klik **Cari**.
3. Hasil pencarian berlaku untuk tabel **Growth**, **Detail Mingguan**, dan **Breakdown GMV per Kategori**. Klik **Reset** untuk kembali ke semua kreator.
4. Klik tab **All / Dining / Accommodation / Things to Do (TTD) / LIVE** untuk mengganti sumber angka di tabel Growth & Detail Mingguan.
5. Tabel **Breakdown GMV per Kategori** menampilkan GMV W1–W5 dan Total Bulan per kategori.
6. Ganti bulan dengan tombol bulan sebelumnya / berikutnya di atas halaman. Pencarian & tab tetap terbawa.

### B3. Report Kreator Bulanan

1. Sidebar **CM Kreator → Data Kreator**.
2. Gulir ke kartu **Report Kreator** → bagian **Report Bulanan Otomatis**.
3. Pilih **Kreator** dan **Bulan**, lalu klik **Lihat Report**.
4. Report berisi: **Ringkasan Bulan** (GMV All, Orders, AOV, Redemption, Post baru/ber-sales, LIVE, GMV Video), **Detail Mingguan (W1–W5)**, **GMV per Kategori**, **GMV Video** dan **Video Terlaris Bulan Ini**.
5. Pindah bulan dengan tombol **← bulan sebelumnya** / **bulan berikutnya →**.
6. Klik **Cetak / Simpan PDF** (pilih "Save as PDF" di dialog cetak) atau **Unduh Excel**.
7. Bila report perlu dibaca kreator di portal: unggah file PDF/Excel tadi lewat form unggah report di kartu yang sama, seperti biasa.

### Arti field penting

| Field | Arti |
|---|---|
| — (strip) | Data minggu/kategori itu **belum diunggah**. Strip bukan berarti nol. |
| GMV (All) | Total GMV semua kategori, dari upload Creator Analysis kategori All. |
| Kategori beririsan | Satu transaksi bisa masuk dua kategori (mis. LIVE sekaligus Dining). Jumlah semua kategori **tidak harus sama** dengan All. |
| Minggu terisi | Berapa minggu dari W1–W5 yang sudah punya data di bulan itu. |
| AOV bulan | GMV ÷ Orders bulan itu. |

### Kesalahan umum / tips

- Salah pilih kategori saat upload membuat angka masuk ke kategori yang salah. Upload ulang file yang benar dengan kategori yang benar, lalu centang *Proses ulang* bila diminta.
- Upload kategori hanya untuk file export **Creator Analysis** (yang punya sheet *Filter* + *Data*). Format lama ditolak.
- Upload kategori **tidak mengubah** angka All, alert, atau GMV master kreator.
- CM staff hanya melihat kreator yang dipegangnya. CM Lead dan Director/OD melihat semua kreator.
- Report kosong atau banyak strip? Pastikan upload mingguan bulan itu sudah lengkap di halaman GMV Video Mingguan.

**Status:** Live sejak 6 Nov 2026.

---

## C. Dashboard Akuisisi & field binding baru (6 Nov 2026)

**Untuk siapa:** Tim Akuisisi (staff & Lead), Director/OD. CM juga bisa membuka Dashboard Akuisisi.

**Tujuan:** Melihat performa scouting → binding tim dan per orang. Data binding sekarang lengkap (UID, WA, GMV potential, tanggal binding akhir, jenis kontrak, PIC CM), sehingga handoff ke CM tidak perlu menunggu CM Lead.

### C1. Mencatat binding dengan field baru

1. Sidebar **Akuisisi Kreator → Akuisisi Kreator**, kartu **Catat Akuisisi (Binding)**.
   *Atau* lewat **Prospek Kreator** → buka prospek → form akuisisi di jendela detail. Di sini No. WhatsApp sudah terisi otomatis dari nomor pendaftar.
2. Pilih **Kreator (prospek)** dan **Tanggal Binding**.
3. Isi enam field wajib (lihat tabel di bawah).
4. Isi **Sumber Lead** dan **Catatan** bila ada, lalu klik simpan.
5. Cek baris baru di **Daftar Akuisisi**: UID dan WA tampil di bawah nama kreator (WA bisa diklik ke WhatsApp), tanggal "s/d" tampil di bawah Tanggal Binding, ditambah kolom **Kontrak**, **PIC CM**, dan **GMV Potential**.
6. Selama **Handoff Selesai** belum diklik, PIC CM bisa diganti langsung di kolom **PIC CM** (pilih nama → **Simpan**). Setelah handoff, penggantian PIC dilakukan CM Lead lewat Data Kreator.

### C2. Membaca Dashboard Akuisisi

1. Sidebar **Akuisisi Kreator → Dashboard Akuisisi**.
2. Atur filter **Dari**, **Sampai**, **PIC Akuisisi** (atau "Semua (tim)"), dan **Sumber Lead**, lalu klik **Tampilkan**.
3. Baca kotak angka tim di atas, lalu tabel **Per Individu** di bawahnya.

### Arti field penting

| Field | Arti |
|---|---|
| UID TikTok | ID angka akun TikTok kreator (5–25 digit), **bukan** username. |
| No. WhatsApp | Boleh ditulis 08xx atau 62xx. Sistem menyimpannya sebagai 62xx. |
| GMV Potential / bulan | Perkiraan GMV kreator per bulan (Rp). Boleh ditulis 25.000.000. |
| Tanggal Binding Akhir | Tanggal kontrak/binding berakhir. Tidak boleh sebelum Tanggal Binding. |
| Jenis Kontrak | `kontrak` atau `non kontrak`. Tersimpan ke master kreator. |
| PIC CM | Karyawan Creator Management aktif yang akan memegang kreator. Tersimpan sebagai owner CM di master kreator. |
| Scouting | Jumlah prospek baru di periode, dihitung untuk PIC prospeknya. |
| Binding | Jumlah akuisisi dengan Tanggal Binding di periode. |
| CR | Binding ÷ Scouting pada periode yang sama. |
| GMV Post-Join | GMV aktual setelah bergabung (terisi lewat tombol **Refresh GMV**). |

### Kesalahan umum / tips

- **"[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]"**: ada field wajib yang kosong.
- **"[UID TikTok harus berupa angka]"**: yang diisi username. Ambil UID angka dari profil/export TikTok.
- **"[tanggal binding akhir tidak boleh sebelum tanggal binding]"**: periksa tanggal.
- Filter **Sumber Lead** hanya memengaruhi Binding & GMV, tidak memengaruhi Scouting, karena prospek tidak punya sumber lead.
- Baris akuisisi lama (sebelum 6 Nov) bisa kosong di kolom baru. Ini normal.
- Prospek tanpa PIC tampil sebagai "Belum ada PIC" di dashboard. Tetapkan PIC prospek supaya scouting terhitung ke orang yang benar.

**Status:** Live sejak 6 Nov 2026.

---

## D. Baseline & Target GMV BD ikut terkirim ke CDPS (6 Nov 2026)

**Untuk siapa:** BD (BizDev), Finance, Head/AM di CDPS (Yulianti/CMA), Director/OD.

**Tujuan:** Angka **GMV Baseline, Target GMV, Link Akun Merchant, dan Kategori Merchant** yang diisi BD di form **Daftarkan Transaksi** ikut terkirim ke CDPS bersama order. Head/AM tidak perlu mengetik ulang. Sebelumnya angka ini tidak muncul di CDPS.

### Langkah klik

1. BD: **Merchant Deals → Daftarkan Transaksi**. Isi **Target GMV** (wajib), dan isi **Baseline / Link Akun / Kategori** bila sudah diketahui. Cara isinya sama dengan tutorial "Baseline & Target GMV di Form BD Daftarkan Transaksi".
2. Finance memverifikasi pembayaran seperti biasa. Order lalu otomatis masuk Bridge.
3. Head/AM di CDPS: buka order di halaman **Terima Order**. Baseline, Target GMV, Link Toko, dan Kategori tampil sebagai baca saja.

### Arti field penting

| Di MSDPS (form BD) | Muncul di CDPS sebagai |
|---|---|
| GMV Baseline | GMV Baseline |
| Target GMV | Target GMV |
| Link Akun Merchant | Link Toko |
| Kategori Merchant | Kategori |

### Kesalahan umum / tips

- **Catatan untuk Tim Tech / Director:** pengiriman ke CDPS hanya aktif bila pengaturan `BRIDGE_KIRIM_MERCHANT_TARGET=1` sudah dinyalakan di Vercel (project MSDPS). Bila angka belum muncul di CDPS untuk deal baru, **cek dulu pengaturan ini** (uji di staging dulu).
- Order yang sudah terkirim **sebelum** pengaturan dinyalakan **tidak dikirim ulang**. Untuk deal-deal itu, Head/AM tetap mengisi angka secara manual di CDPS.
- Deal lama tanpa Target GMV tetap terkirim normal, hanya kolomnya kosong.

**Status:** Live sejak 6 Nov 2026 (kode). Angka baru muncul di CDPS setelah pengaturan di Vercel dinyalakan.

---

## E. Laporan Merchant besar sekarang bisa dibuka (perbaikan timeout) (6 Nov 2026)

**Untuk siapa:** Director, OD, BizDev, SPV Creator Management, Campaign Specialist, Account (yang memegang menu Laporan Merchant).

**Tujuan:** Laporan merchant dengan data besar (contoh: **Sushi Yay**, ribuan baris post × outlet) sebelumnya gagal dibuka karena timeout. Sekarang sudah diperbaiki dan halaman terbuka normal.

### Langkah klik — membuka ulang laporan besar

1. Sidebar **Campaign MEA GO → Laporan Merchant**.
2. Di tabel **Merchant dengan data**, cari **Sushi Yay — LEAD-202609-0018**, lalu klik **Buka laporan →**.
3. Tunggu sampai laporan selesai dimuat. Data besar bisa memakan beberapa detik, jadi **jangan klik berulang-ulang**.
4. Untuk periode lain: atur **Dari** dan **Sampai**, lalu klik **Generate**.
5. Bila sebelumnya Anda melihat kartu merah *Terjadi kesalahan* di laporan ini, cukup buka ulang. **Tidak perlu upload ulang data**, karena data yang sudah masuk tetap aman.

### Arti field penting

Sama seperti tutorial *Laporan Performa Merchant: Generate Report Otomatis*. Tidak ada field baru.

### Kesalahan umum / tips

- Masih muncul error setelah dibuka ulang? Muat ulang halaman satu kali. Bila tetap error, catat **Kode kesalahan**, nama merchant, periode Dari–Sampai, dan jam kejadian, lalu laporkan sesuai checklist Bab 10.
- Jangan menghapus atau mengupload ulang data hanya karena laporan lambat.
- Rentang periode yang sangat panjang lebih lama dimuat. Mulai dari 2 bulan, lalu perluas bila perlu.

**Status:** Live sejak 6 Nov 2026.
