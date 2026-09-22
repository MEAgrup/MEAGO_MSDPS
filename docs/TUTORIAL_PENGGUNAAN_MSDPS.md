# Tutorial Penggunaan MSDPS — Panduan Lengkap Semua User

Aplikasi: **https://app.meago.id**
Staging (untuk uji coba, bukan data asli): **https://meago-msdps-git-staging-meagency.vercel.app**

Dokumen ini adalah panduan pakai untuk **semua pengguna MSDPS** (karyawan MEAGO! dari semua
divisi, SPV/Lead, OD/HR, Director, sampai kreator di Portal Kreator). Isinya murni cara pakai
sehari-hari: siapa boleh apa, cara menjalankan tiap aksi, dan apa yang perlu disiapkan kalau mau
lapor masalah. Untuk rencana pengembangan/status build, lihat `docs/BUILD_PLAN.md` — tidak
dibahas di sini.

> **Tidak ada pendaftaran mandiri.** Semua akun (karyawan maupun kreator) dibuat oleh admin
> (OD/Director, atau SPV/Lead untuk stafnya sendiri saat jendela onboarding dibuka — lihat
> Bagian 3). Kalau belum punya akun, minta OD/HR atau atasan Anda yang membuatkan.

---

## Daftar Isi

1. [Peran & Hak Akses](#1-peran--hak-akses)
2. [Login & Ganti Password](#2-login--ganti-password)
3. [Kelola Karyawan (khusus SPV/Lead, OD/HR, Director)](#3-kelola-karyawan-khusus-spvlead-odhr-director)
4. [Alur Inti: Leads → Deal → Merchant → Keuangan](#4-alur-inti-leads--deal--merchant--keuangan)
5. [Modul MCN MEA GO (ekosistem kreator)](#5-modul-mcn-mea-go-ekosistem-kreator)
6. [Portal Kreator (untuk kreator, bukan karyawan)](#6-portal-kreator-untuk-kreator-bukan-karyawan)
7. [Target OKR](#7-target-okr)
8. [Bridge ke CDPS — batas akhir alur di MSDPS](#8-bridge-ke-cdps--batas-akhir-alur-di-msdps)
9. [Menu yang Sudah Pensiun](#9-menu-yang-sudah-pensiun)
10. [Istilah yang Sering Bikin Salah Paham](#10-istilah-yang-sering-bikin-salah-paham)
11. [Troubleshooting — Apa yang Harus Dilaporkan](#11-troubleshooting--apa-yang-harus-dilaporkan)

---

## 1. Peran & Hak Akses

MSDPS tidak memakai satu label "role" tunggal, tapi kombinasi 3 hal yang melekat di akun Anda:

- **Divisi** — Marketing, BizDev, Finance, Account, Ecommerce, Ads, KOL, LiveStream,
  **Creator Management**, atau **Acquisition**.
- **Level** — `Staff` atau `Lead` (di lapangan disebut juga **SPV** atau **Head** — sama saja).
- **Flag tambahan** — `OD` (Organization Development/HR) dan `Director`, bisa menempel di akun
  siapa pun terlepas dari divisinya.

Kombinasi ini yang menentukan menu apa yang muncul di sidebar Anda dan tombol apa yang aktif.
Kalau menu yang Anda harapkan tidak muncul, cek dulu 3 hal di atas — hampir semua kasus "menu
hilang"/"tombol tidak aktif" akarnya di sini, bukan bug.

### Ringkasan per tingkat

| Tingkat | Contoh | Bisa apa |
|---|---|---|
| **Director** | mis. Yohan Agustian, Ghifari | Akses baca ke semua divisi & semua data; kelola karyawan tanpa batas (tambah/ubah/nonaktifkan/reset password siapa saja); satu-satunya yang boleh **Edit/Hapus transaksi deal** langsung (bukan lewat antrean approval); satu-satunya yang boleh membuka **Setting BizDev & Admin Ops**; ikut memutuskan bridge deal ke CDPS; atur **Target OKR**. |
| **OD / HR** | mis. Rara | Sama dengan Director untuk urusan kelola karyawan (tambah semua divisi/level, reset password siapa saja, buka/tutup jendela onboarding SPV); melihat & mengatur Target OKR. |
| **SPV / Lead** | satu per divisi | Menu & aksi level divisinya (approve pendaftar campaign, assign CM, dsb — lihat modul terkait); **sementara** (hanya saat jendela onboarding dibuka OD/Director) bisa menambah **Staff baru di divisinya sendiri** dengan password sementara; **tidak bisa** menaikkan orang jadi Lead, memberi flag OD/Director, pindah divisi, mengubah, atau menghapus data karyawan siapa pun — termasuk dirinya sendiri. |
| **Staff** | karyawan biasa | Input data & aksi harian di modul divisinya masing-masing. Tidak bisa menambah karyawan. |
| **Kreator (Portal)** | kreator affiliate TikTok MEA GO | Bukan karyawan — login terpisah, hanya bisa mengakses menu di bawah "MCN MEA / Portal Kreator" (Bagian 6). Tidak bisa membuka menu karyawan sama sekali. |

### Peta menu vs siapa yang melihatnya

| Menu | Yang melihat |
|---|---|
| Dashboard | Semua karyawan |
| Leads & Prospek, Dashboard CRM | BizDev, Marketing, OD/Director |
| Merchant Deals, Merchant, Kampanye | BizDev, Finance, Creator Management, Account, OD/Director (rincian aksi per menu di Bagian 4) |
| Keuangan | Finance, OD/Director |
| Data Kreator Meago, CM Workspace, GMV Video Mingguan, Jadwal Live | Creator Management, OD/Director (Data Kreator/GMV/Jadwal juga dilihat BizDev) |
| Campaign MEA GO | Creator Management (khususnya Lead), BizDev, Account (baca/kurasi terbatas), OD/Director |
| BizDev Workspace, POI Accommodation & TTD, POI Dining, Papan Skor BD | BizDev, OD/Director (Leads juga dilihat Marketing) |
| Setting BizDev & Admin Ops | **Director saja** |
| Akuisisi Kreator | Acquisition, OD/Director |
| Special Project | Lead semua divisi terkait (Creator Management, BizDev, Acquisition), OD/Director |
| Target OKR | OD/Director saja |
| Kelola Karyawan | OD/Director selalu; SPV/Lead hanya saat jendela onboarding divisinya sedang dibuka |

---

## 2. Login & Ganti Password

1. Buka **https://app.meago.id**.
2. Masukkan **email** kantor + **password** → **Masuk**. Tidak ada tombol daftar — kalau belum
   punya akun, itu memang belum dibuatkan, hubungi OD/HR atau SPV Anda.
3. Sistem otomatis mengarahkan sesuai jenis akun Anda:
   - Akun karyawan → **Dashboard**.
   - Akun kreator Portal → **Performa Saya**.
   - Kalau akun Anda ternyata tidak terhubung ke data karyawan maupun kreator, Anda akan
     otomatis di-*sign out* dengan pesan "Akun ini tidak terhubung ke karyawan maupun kreator" —
     laporkan ke OD/HR, jangan coba login berulang-ulang.
4. **Login pertama kali pakai password sementara** (format `MEAGO-XXXX-XXXX-XXXX`): begitu
   berhasil masuk, layar **Ganti Password Sementara** langsung muncul otomatis. Isi:
   - **Password Baru** (minimal 8 karakter)
   - **Ulangi Password Baru**

   Klik **Simpan Password** → langsung masuk ke Dashboard. Password sementara langsung tidak
   berlaku lagi setelah ini; selanjutnya login pakai password baru Anda.
5. **Lupa password / password sementara hilang sebelum sempat dipakai?** Anda tidak bisa reset
   sendiri — minta **OD/HR** (bukan SPV) untuk klik **Reset password** di akun Anda (Bagian 3-C).

---

## 3. Kelola Karyawan (khusus SPV/Lead, OD/HR, Director)

> Jendela onboarding SPV/Lead saat ini dibatasi waktu (dapat diperpanjang/ditutup kapan saja oleh
> OD/Director — lihat 3-B). Kalau kartu "Tambah Anggota Tim" tidak lagi muncul di akun SPV Anda,
> berarti jendelanya sudah ditutup; penambahan karyawan selanjutnya hanya lewat OD/HR (3-A).

### 3-A. OD / HR & Director — menambah karyawan (semua divisi & level)

1. Menu **Kelola Karyawan** → kartu **Tambah Karyawan**.
2. Isi **Nama**, **Email**, **Divisi**, **Level**. Centang **OD** / **Director** kalau memang
   perlu diberi flag itu.
3. **Password Awal**: kosongkan supaya sistem membuatkan password sementara secara otomatis.
   Biarkan centang **Password ini sementara** tercentang, supaya pemiliknya wajib menggantinya
   sendiri saat login pertama.
4. Klik **Tambah Karyawan** → salin password sementara yang muncul (hanya tampil sekali) →
   kirim ke yang bersangkutan lewat **chat pribadi**, bukan grup.

### 3-B. OD / HR & Director — mengatur jendela onboarding SPV/Lead

1. **Kelola Karyawan** → kartu **Jendela Onboarding SPV/Lead**.
2. Untuk membuka/memperpanjang: set **Tutup otomatis pada (WIB)** — sistem **mewajibkan** ada
   tanggal/jam tutup, tidak bisa dibiarkan terbuka tanpa batas. Bisa juga dibatasi ke divisi
   tertentu saja. Klik **Simpan Pengaturan Jendela**.
3. Untuk menutup segera: klik **Cabut akses SPV/Lead sekarang**, atau hapus centang lalu simpan.
4. Setelah jendela tutup (otomatis maupun manual), lakukan pengecekan susulan: cocokkan daftar
   karyawan dengan tim riil tiap divisi, ingatkan yang masih "Password: sementara" untuk login
   dan ganti password, pastikan promosi Lead/flag OD hanya terjadi lewat OD/Director (SPV cuma
   bisa membuat Staff), dan nonaktifkan (bukan hapus) akun siapa pun yang batal bergabung.

### 3-C. OD / HR & Director — reset password karyawan

1. **Kelola Karyawan** → cari nama di tabel **Daftar Karyawan**.
2. Klik **Reset password** di kolom **Aksi**.
3. Salin password sementara baru yang muncul, serahkan ke yang bersangkutan lewat jalur pribadi.

SPV/Lead **tidak bisa** melakukan reset ini, meskipun untuk stafnya sendiri.

### 3-D. SPV / Lead — menambah anggota tim (hanya saat jendela dibuka)

1. Login → menu **Kelola Karyawan**.
2. Scroll ke kartu **Tambah Anggota Tim [nama divisi Anda]**.
3. Isi **Nama Lengkap** dan **Email** (email kantor yang dipakai login).
4. Klik **Tambah Anggota Tim** → muncul kotak hijau berisi password sementara
   (`MEAGO-XXXX-XXXX-XXXX`). **Salin sekarang**, hanya tampil sekali.
5. Kirim email + password sementara ke anggota tim lewat **chat pribadi**, bukan grup.
6. Ulangi untuk anggota berikutnya.

Divisi dan level pada karyawan baru **terkunci otomatis** ke divisi Anda + level Staff — SPV
tidak bisa memilih divisi lain atau langsung menjadikan orang Lead. Untuk itu, atau untuk
mengubah/menonaktifkan data karyawan yang sudah ada, harus lewat OD/HR.

### 3-E. Cek status karyawan

Di tabel **Daftar Karyawan**:

| Kolom | Arti |
|---|---|
| **Password: sementara** | Belum login/ganti password sendiri — ingatkan yang bersangkutan untuk segera login. |
| **Password: sendiri** | Sudah aman, sudah pakai password sendiri. |
| **Ditambahkan oleh** | Nama akun yang membuat entri karyawan tersebut. |

### 3-F. Kalau gagal menambah karyawan

| Pesan / kejadian | Yang harus dilakukan |
|---|---|
| "Email sudah terpakai oleh akun lain" | Email itu sudah punya akun — cek dulu di tabel Daftar Karyawan sebelum coba lagi. |
| "Jendela onboarding ditutup" / kartu Tambah Anggota Tim tidak muncul (untuk SPV) | Jendela sudah tutup — minta OD/HR yang menambahkan, atau minta dibuka lagi. |
| Menu **Kelola Karyawan** tidak ada di sidebar | Akun Anda bukan SPV/Lead/OD/Director, atau (untuk SPV) jendelanya sudah tutup. |
| Password sementara terlanjur hilang sebelum diteruskan | Minta OD/HR reset (Bagian 3-C), jangan menebak-nebak password. |
| Error 401/500 saat submit form | Ini bukan kesalahan Anda — kemungkinan besar konfigurasi environment. Klik tombol **"Cek koneksi service-role"** di kartu Tambah Karyawan (kalau Anda OD/Director) dan laporkan hasilnya (Bagian 11). |

---

## 4. Alur Inti: Leads → Deal → Merchant → Keuangan

Ini alur "cari calon merchant → deal → tercatat sebagai transaksi → dibayar/diverifikasi" yang
dijalankan tim BizDev, Marketing, dan Finance.

### 4-A. Kampanye Akuisisi — menu **Kampanye** (marketing)

Dipakai tim Marketing untuk menjalankan kampanye pencarian lead (bukan campaign kreator — lihat
peringatan istilah di Bagian 10).

1. Buka menu **Kampanye** → **Buat Kampanye**.
2. Isi data kampanye. Centang **"Langsung aktifkan"** (default aktif) kalau kampanye siap jalan
   sekarang.
3. Dashboard di halaman ini menampilkan ROAS, CPL (cost per lead), dan CPRL secara langsung,
   dihitung dari lead & closing yang masuk lewat kampanye tersebut.

### 4-B. Leads & Prospek — menu **Leads**

1. **Daftarkan Lead** untuk mencatat calon merchant baru — sistem otomatis mendeteksi duplikat
   berdasarkan nomor telepon (format E.164), jadi lead yang sama tidak akan tercatat dobel.
2. Lead yang belum ada pemiliknya bisa **diklaim** oleh BD mana pun dari pool bersama. Kalau dua
   BD sama-sama mengejar lead yang sama, **yang pertama berhasil closing yang menang** — lead
   lain otomatis berpindah status ke `[Closed - Kalah Kompetisi]`.
3. Alur status: **Approaching → Follow Up → Dealing / Rejected**, dan dari **Dealing** bisa lanjut
   ke **Renewal** kalau kerja sama diperpanjang.
4. Menu **Dashboard CRM** (`/leads/dashboard`) khusus untuk melihat data — funnel pipeline,
   kecepatan approach-ke-deal, performa per BD/wilayah. Tidak ada input data di halaman ini.

### 4-C. Merchant Deals — menu **Merchant Deals**

Mencatat transaksi kerja sama nyata yang lahir dari lead yang sudah Dealing/Renewal.

- **Daftarkan Deal baru** — BizDev, Creator Management, OD/Director.
- **Import CSV massal** — hanya OD/Director/BizDev.
- **Edit / lengkapi data deal** — sesuai peran divisi masing-masing.
- **Hapus / edit transaksi langsung** — **hanya Director**. BizDev/Creator Management yang perlu
  mengubah data mengajukan lewat tombol **"Ajukan Perubahan"**, masuk ke antrean yang direview
  Director, bukan langsung mengubah data.
- **Teruskan ke CDPS** — lihat Bagian 8.

### 4-D. Merchant — menu **Merchant**

Daftar merchant (lahir otomatis begitu sebuah lead di-closing, tidak dibuat manual). Di sini ada
kartu **Closing Deal** yang mencatat penutupan kerja sama sekaligus (membuat data Merchant, Jasa,
dan Transaksi bersamaan, dan otomatis menutup prospek lain yang bersaing untuk merchant yang
sama). Tombol **Closing Deal** hanya aktif untuk **BizDev dan Director**.

### 4-E. Keuangan — menu **Keuangan** (Finance, OD/Director)

- **Antrian Verifikasi** — konfirmasi pembayaran masuk terhadap transaksi. Sistem mencegah
  verifikasi melebihi nilai transaksi (tidak bisa diakali dari UI). Bisa juga menandai transaksi
  **"Jatuh tempo"** atau **"Bermasalah"**.
- **Antrian Disbursement Payout Kreator** — pencairan honor kreator (dipicu otomatis saat kreator
  mencapai milestone, mis. 10 video atau 5 jam live). Nominal sudah ditetapkan sistem, tugas
  Finance hanya menandai sudah ditransfer. Membatalkan payout hanya bisa **Lead Finance, Director,
  atau OD**.
- **Antrian Payout Campaign MEA GO** — pencairan payout dari campaign kreator (terpisah dari
  antrean di atas).
- **Semua Transaksi** — buku besar transaksi lengkap untuk ditinjau.

---

## 5. Modul MCN MEA GO (ekosistem kreator)

Modul ini yang paling aktif dipakai tim Creator Management & BizDev sehari-hari.

### 5-A. Data Kreator Meago — menu **Data Kreator Meago**

- **Upload Data Mingguan** — unggah file XLSX "Creator Analysis" hasil ekspor TikTok, per minggu.
- **Assign CM/CPM** — menentukan Creator Manager yang menangani seorang kreator; hanya **Lead
  Creator Growth** dan OD/Director yang bisa memindah-tugaskan.
- **Akun Portal Kreator** — di sinilah karyawan membuatkan akun login untuk kreator:
  1. Ketik nama/username/kode kreator di kotak pencarian → **Cari**.
  2. Isi **email** + **password** (minimal 8 karakter) pada baris kreator yang dituju → simpan.
  3. Baris berubah jadi badge hijau **"Akun portal aktif"**. Satu kreator hanya boleh punya satu
     akun — kalau sudah ada, form tidak akan muncul lagi untuk kreator tersebut.
  4. Kirim email + password ke kreator lewat jalur pribadi, minta mereka menggantinya saat login
     pertama.
- **Kelola Kreator** — edit lengkap data kreator (profil, batas budget, status kontrak, dll,
  divalidasi di server).
- **Report Kreator** — laporan performa yang bisa dilihat kreator lewat portalnya.

### 5-B. CM Workspace — menu **CM Workspace** (Creator Management)

Upload mingguan, tampilan Growth W1–W5, Detail Mingguan per kreator, daftar alert yang belum
diselesaikan, kotak masuk komplain kreator, kotak masuk permintaan kreator, antrean approval
Director, dan Special Project.

### 5-C. GMV Video Mingguan — menu **GMV Video Mingguan**

Upload satu baris data per kreator per minggu. Data minggu sebelumnya **tidak akan tertimpa**
oleh upload minggu baru.

### 5-D. Jadwal Live — menu **Jadwal Live**

Matriks penjadwalan live streaming (7 hari × roster kreator), boleh lebih dari satu slot per hari.
Slot yang sudah "selesai" otomatis terkunci. Ada tampilan **Verifikasi Hari Ini** dan
**Terlewat** (slot yang lewat tanpa verifikasi), serta tombol **Copy Week** untuk menyalin slot
minggu ini ke minggu target (status di minggu tujuan direset). Kreator yang belum masuk roster
tampil di daftar **Kreator Belum di Roster**.

### 5-E. Campaign MEA GO — menu **Campaign MEA GO**

Sistem campaign/deal untuk kreator (berbeda dari Kampanye Marketing di 4-A — lihat Bagian 10).
Alur lengkapnya:

1. **Buat Campaign** (SPV Creator Management, BizDev, OD, atau Director — AM di Account bisa
   masuk untuk mengurasi tapi tidak membuat campaign/mengubah budget).
2. Isi field wajib: Funding source, Track (video/live), Base fee, Kuota kreator, Creator budget,
   dan **Target Location ID** (Location ID TikTok, bukan nama merchant/`shop_id`).
   Kosongkan seluruh field di kartu **Segmentasi Kelayakan Pendaftar** kecuali memang perlu
   menyaring (data kelayakan di banyak kreator belum lengkap, jadi filter yang diisi sembarangan
   bisa membuat campaign aktif tapi nihil pendaftar).
3. Campaign tersimpan sebagai **Draft** → di kartu **Stage Campaign**, ubah ke **active**. Sistem
   otomatis menolak aktivasi kalau ada field wajib yang masih kosong dan menunjukkan daftarnya.
4. Setelah **active**, campaign muncul di Portal Kreator. Kreator mendaftar sendiri lewat
   portalnya.
5. Kurasi pendaftar di kartu **Pendaftar** — approve/reject satu per satu.
6. Kreator yang di-approve mengirim bukti (link post) lewat portalnya — muncul di kartu **Bukti
   Deliverable**.
7. Ingest file **"Content Analysis / Video List"** asli dari TikTok di halaman detail campaign
   (pencocokan pakai **Location ID**, bukan kolom `Merchant` atau `Location name` — lihat Bagian
   10).
8. Jalankan **Validasi** — tiap submission mendapat alasan otomatis (tidak ditemukan / di luar
   periode / merchant tidak sesuai / bukan milik kreator / ditolak TikTok / duplikat / valid).
   Baca satu per satu sebelum menutup batch.
9. Tutup **Batch Kurasi** → payout yang valid muncul di kartu **Payout** dan di menu **Keuangan**.

### 5-F. BizDev Workspace — menu **BizDev Workspace**

Pelacak permintaan kreator lintas-CM, pipeline deal, routing campaign, ringkasan lead shop → pool
leads, ringkasan laporan brand (GMV per shop yang punya deal), dan Special Project.

### 5-G. POI Accommodation & TTD / POI Dining — menu **POI Accommodation & TTD**, **POI Dining**

Checklist SOP per transaksi dengan langkah dan SLA yang bisa diatur (lihat 5-I). Mencatat tanggal
kunjungan, jumlah kreator/video yang dikirim, dan GMV per POI.

### 5-H. Papan Skor BD — menu **Papan Skor BD**

Ranking BD berdasarkan performa deal, bisa difilter, lengkap dengan rincian per deal.

### 5-I. Setting BizDev & Admin Ops — menu **Setting BizDev & Admin Ops** (Director saja)

Tambah/ubah/hapus langkah SOP dan SLA (dalam hari) untuk dua alur POI di atas. Menghapus langkah
tidak menghapus riwayat yang sudah ada — hanya menyembunyikannya dari alur berikutnya.

### 5-J. Akuisisi Kreator — menu **Akuisisi Kreator** (divisi Acquisition, OD/Director)

Mendaftarkan prospek kreator baru, mencatat akuisisi/binding, mencatat referral antar-kreator,
serah terima ke tim Creator Management, dan Special Project.

### 5-K. Special Project — menu **Special Project**

Membuat & melihat daftar proyek khusus (opsional: target jumlah video, lokasi POI). Terlihat oleh
Lead di Creator Management/BizDev/Acquisition serta OD/Director.

---

## 6. Portal Kreator (untuk kreator, bukan karyawan)

Kreator login di URL yang sama (**https://app.meago.id**) memakai email+password yang dibuatkan
tim Creator Management (Bagian 5-A), dan otomatis mendarat di halamannya sendiri — bukan
dashboard karyawan.

| Menu di Portal Kreator | Fungsi |
|---|---|
| **Performa Saya** | Metrik mingguan (W1–W5) + rata-rata 3 bulan terakhir. Halaman pertama setelah login. |
| **Campaign** | Menelusuri campaign yang memenuhi syarat untuk mereka (disaring server berdasarkan industri/kota/level/tipe/status kontrak/GMV), mendaftar, dan mengirim bukti/link post. |
| **Merchant Deals** (ditampilkan sebagai "Agency Plan") | Daftar deal merchant aktif — hanya untuk dilihat, tidak bisa diubah. |
| **Report** | Laporan yang dibuat tim Creator Management untuk mereka — hanya untuk dilihat. |
| **Request** | Mengajukan permintaan ke agency: Free Meal, Visit, Ads Budget Live, Harga Special Live. |
| **Special Project** | Daftar proyek khusus yang mereka ikuti — hanya untuk dilihat. |
| **Komplain & Feedback** | Mengirim komplain/masukan ke Creator Manager-nya, dan melihat riwayat komplain sendiri. |
| **Profil** | Mengelola data rekening bank untuk pencairan payout. |

Kreator **tidak bisa** mengakses menu karyawan apa pun (Kelola Karyawan, Merchant Deals internal,
Keuangan, dsb) — kalau ada kreator yang melaporkan bisa melihat menu tersebut, itu bug dan wajib
dilaporkan segera (Bagian 11).

---

## 7. Target OKR

Menu **Target OKR** (khusus OD/Director) dipakai untuk menetapkan target kuartalan per divisi
**operasional** (BizDev, Creator Management, Acquisition, Marketing, Finance). Pencapaian
dihitung otomatis setiap kali halaman dibuka (bukan dari proses terjadwal), ditampilkan sebagai
badge: **hijau** (≥100% dari target sesuai progres waktu kuartal), **kuning** (≥70%), **merah**
(di bawah itu). Ada tombol untuk berpindah kuartal (mundur/maju 1 kuartal).

---

## 8. Bridge ke CDPS — batas akhir alur di MSDPS

Sejak pertengahan September 2026, tugas MSDPS untuk sebuah deal merchant berhenti di titik: **Deal
→ transaksi terverifikasi Finance → diteruskan sebagai satu order ke CDPS** (aplikasi terpisah
tempat eksekusi layanan Account/Ads/Creative/Store Operation/KOL/Live Stream sebenarnya berjalan).

Cara menjalankannya:

1. Buka menu **Merchant Deals** → pilih deal yang relevan → klik **"Teruskan ke CDPS"**.
2. Di modal yang muncul: pilih baris yang mau diteruskan, pilih **satu dari enam jenis layanan**
   (Account, Ads, Creative, Store Operation, KOL-Non-Roster, Live Stream) → submit.
3. Sistem mengirim data ke CDPS secara terjadwal di latar belakang; begitu berhasil, deal akan
   mendapat **kode order (`ORD-...`)** dari CDPS yang tersimpan balik ke data deal-nya.

Tombol ini hanya aktif untuk BizDev, Creator Management, Director, dan OD/manajemen — **Finance
sendirian tidak bisa** melakukan bridge.

---

## 9. Menu yang Sudah Pensiun

Menu-menu berikut **sudah tidak ada di sidebar** dan kalau dibuka langsung lewat URL akan
menampilkan pesan "modul ini sudah pensiun, sudah pindah ke CDPS" beserta tombol kembali ke
Merchant Deals:

`/account`, `/ecommerce`, `/ads`, `/kol`, `/livestream`, `/board`, `/portal`, `/management`

Yang perlu diketahui semua user soal ini:

- **Data lama tidak hilang.** Tidak ada satu pun data yang dihapus saat modul-modul ini
  dipensiunkan — hanya pintu masuk (form/halamannya) untuk manusia yang ditutup.
- Kalau Anda tidak sengaja mendarat di salah satu halaman ini (misalnya lewat bookmark lama),
  itu bukan error — cukup klik tombol kembali ke **Merchant Deals**.
- Fungsi yang dulu ada di menu-menu ini sekarang dijalankan di **CDPS** (aplikasi terpisah), atau
  digantikan oleh **Target OKR** (dulunya menu **Management**).

---

## 10. Istilah yang Sering Bikin Salah Paham

Beberapa kata dipakai dengan arti berbeda tergantung konteksnya. Kalau ragu, cek daftar ini dulu
sebelum menyimpulkan sesuatu "aneh" atau "salah":

| Istilah | Arti di MSDPS | Jangan tertukar dengan |
|---|---|---|
| **Merchant** | Brand/POI yang diajak kerja sama BizDev (mis. di menu Merchant, Merchant Deals). | Kolom **`Merchant`** di file ekspor TikTok — itu artinya platform OTA/delivery (Agoda, GoFood, dll), tidak ada hubungannya. Untuk mencocokkan merchant, selalu pakai **Location ID**, bukan kolom `Merchant` atau `Location name` (satu Location ID bisa muncul dengan beberapa variasi ejaan nama). |
| **Campaign** | Ada **tiga** hal berbeda yang sama-sama disebut "campaign": (1) **Kampanye** di menu Marketing (cari lead, tidak ada hubungannya dengan kreator), (2) **Campaign MEA GO** di menu Campaign MEA GO (deal & payout kreator — ini yang paling aktif dipakai), (3) "Campaign request" — fitur lama yang praktis tidak pernah dipakai. | Pastikan Anda dan lawan bicara merujuk campaign yang sama sebelum berdiskusi. |
| **Creator / Kreator** | Ada **dua** master data terpisah dan **tidak saling terhubung**: kreator lama (KOL booking, sudah pensiun) vs **kreator affiliate TikTok MEA GO** (yang aktif, punya akun Portal Kreator). | Kalau mencari data kreator lama untuk keperluan MEA GO, itu tidak akan ketemu — memang beda tabel. |
| **VT** | Sebutan lapangan untuk satu **video/konten** (satu VT = satu baris di ekspor TikTok = satu Post ID). | — |
| **Order / `ORD-...`** | Kode yang diterbitkan **CDPS**, bukan MSDPS, setelah sebuah deal berhasil di-bridge (Bagian 8). | Kode deal MSDPS sendiri disebut `DEAL-...`, dan kode transaksi Finance disebut `TRX-...` — ketiganya berbeda. |
| **"Account & Service" / "eksekusi layanan"** | Kalau Anda membaca dokumen lama yang memakai istilah ini, artinya modul-modul yang sudah **pensiun** (Bagian 9). Sekarang MSDPS berhenti di closing + bridge; eksekusi layanan sesungguhnya berjalan di **CDPS**. | Jangan mencari menu "Account & Service" di MSDPS sekarang — sudah tidak ada. |

---

## 11. Troubleshooting — Apa yang Harus Dilaporkan

Sebelum melapor, coba dulu 2 alat bantu bawaan sistem:

1. **Kartu error merah di layar** — kalau muncul kesalahan tak terduga, sistem menampilkan pesan
   dan (kalau ada) **Kode kesalahan**. **Selalu sertakan kode ini saat melapor** — tim teknis
   memakainya untuk mencocokkan log server. Ada juga tombol **"Coba lagi"**.
2. **"Cek koneksi service-role"** (kartu Tambah Karyawan di menu Kelola Karyawan, hanya terlihat
   OD/Director) — khusus untuk kegagalan pembuatan akun karyawan/kreator. Panel ini melaporkan
   status environment secara otomatis (tanpa menampilkan isi kunci rahasianya) dan hasil
   pemanggilan nyata ke server. Kalau Anda OD/Director dan menemui error saat menambah
   karyawan/membuat akun kreator, coba tombol ini dulu sebelum melapor.

### Checklist yang wajib disiapkan saat melapor masalah apa pun

| # | Yang perlu disiapkan | Kenapa penting |
|---|---|---|
| 1 | **Halaman/menu persis** (URL atau nama menu) dan **aksi/tombol** yang sedang dilakukan | Supaya bisa direproduksi persis |
| 2 | **Pesan error lengkap** yang muncul di layar, dan **Kode kesalahan** kalau ada kartu error merah | Kunci utama untuk mencocokkan log |
| 3 | **Kode data terkait** kalau terlihat di layar (mis. `DEAL-202609-0078`, `TRX-...`, `MER-...`, `CMP-...`, `LEAD-...`) — salin persis, jangan dideskripsikan pakai kata-kata | Lebih cepat dicari di database daripada nama/tanggal |
| 4 | **Identitas & peran Anda saat itu**: nama, divisi, level (Staff/Lead), status OD/Director | Sebagian besar masalah "tombol tidak ada"/"data kosong" ternyata soal hak akses, bukan bug |
| 5 | **Screenshot layar**, usahakan termasuk sidebar (menunjukkan konteks peran Anda) dan pesan error-nya | Konfirmasi visual, sering menangkap detail yang terlewat di deskripsi teks |
| 6 | **Error di console browser** (F12 → tab Console) kalau Anda terbiasa, terutama untuk halaman yang "tidak mau muncul" atau kartu kosong | Membantu diagnosa lebih cepat tanpa perlu buka log server |
| 7 | **Environment**: production (`app.meago.id`) atau staging (`...vercel.app`) | Keduanya memakai database terpisah — jangan sampai salah asumsi |
| 8 | **Waktu kejadian** (jam:menit) | Untuk mencocokkan ke log server |

### Beberapa gejala yang sudah dikenali (kalau ketemu ini, sebutkan saja gejalanya, tidak perlu panik)

| Gejala | Penjelasan singkat |
|---|---|
| `Supabase menolak service-role key (401): Invalid API key` saat Tambah Karyawan | Biasanya konfigurasi environment tertukar antara production dan staging — bukan kesalahan input Anda. Laporkan ke tim teknis dengan hasil "Cek koneksi service-role". |
| Layar error umum ("Internal server error") tanpa keterangan saat Tambah Karyawan / Buat akun portal kreator | Kemungkinan konfigurasi environment di server. Coba lagi setelah beberapa saat; kalau berulang, laporkan dengan Kode kesalahan dari kartu error. |
| Divisi yang Anda cari tidak muncul di dropdown | Seharusnya sudah tidak terjadi lagi (daftar divisi disinkronkan dengan database), tapi kalau masih muncul, laporkan nama divisi yang hilang persis. |
| File yang sudah diupload (mingguan/GMV) "hilang" dan tidak bisa didownload lagi | Sistem memang tidak menyimpan file mentahnya setelah diproses — yang tersimpan adalah hasil olahannya di tabel data. Ini perilaku normal, bukan bug; kalau perlu file aslinya lagi, harus upload ulang dari sumbernya. |

Laporkan ke penanggung jawab teknis/tim yang mengelola MSDPS dengan checklist di atas — semakin
lengkap 8 poin tersebut, semakin cepat masalahnya bisa ditelusuri tanpa bolak-balik bertanya.
