# Onboarding Karyawan MSDPS — siapa boleh menambah siapa

Dokumen operasional untuk OD/HR dan Director. Rancangan teknisnya ada di
migrasi `supabase/migrations/0367_employee_onboarding_window.sql`.

## 1. Matriks wewenang

| Peran | Menambah karyawan | Batasan |
|---|---|---|
| **Director** (`is_director`) | ya, selalu | tanpa batas |
| **OD / HR** (`is_od`) | ya, selalu | tanpa batas |
| **SPV / Lead** (`rank='lead'`) | **hanya selama jendela onboarding terbuka** | hanya **Staff**, hanya **divisinya sendiri**, tanpa peran OD/Director, password **wajib sementara** |
| **Staff** | tidak | — |
| **Kreator** (portal) | tidak | bukan karyawan |

Peran di MSDPS bukan daftar jabatan, melainkan pasangan **(divisi, level)** +
dua flag berlapis:

- **Divisi** (10): Marketing, BizDev, Finance, Account, Ecommerce, Ads, KOL,
  LiveStream, CreatorManagement, Acquisition.
- **Level**: `staff` atau `lead` (Lead = Head = SPV, satu nilai yang sama).
- **Flag**: `is_od` (fungsi HR/Org Development), `is_director`.

Yang **tidak pernah** boleh dilakukan SPV/Lead, bahkan saat jendela terbuka:

- mengangkat Lead/SPV baru;
- memberi flag OD atau Director;
- menambah orang ke divisi lain;
- menerbitkan password permanen;
- mengubah, menonaktifkan, atau menghapus data karyawan (termasuk data dirinya
  sendiri) — koreksi selalu lewat OD.

Semua larangan itu ada di `WITH CHECK` policy database, bukan hanya di tampilan.
Mengirim ulang form dengan nilai lain tetap ditolak Postgres.

## 2. Membuka jendela (OD/Director)

1. Masuk **Kelola Karyawan** (`/employees`).
2. Kartu **Jendela Onboarding SPV/Lead** → centang *Izinkan SPV/Lead menambah
   staff divisinya*.
3. Isi **Tutup otomatis pada (WIB)** — wajib. Jendela aktif tanpa tanggal tutup
   ditolak sistem: pelonggaran yang pencabutannya bergantung pada ingatan
   seseorang bukan pelonggaran sementara.
4. Opsional: batasi ke divisi tertentu, dan isi catatan alasan dibuka.
5. **Simpan Pengaturan Jendela.**

Saat jendela terbuka, menu *Kelola Karyawan* muncul sendiri di sidebar SPV/Lead,
dan hilang lagi sendiri begitu jendela tutup.

## 3. Instruksi untuk SPV/Lead

1. Buka **Kelola Karyawan** → kartu *Tambah Anggota Tim <Divisi>*.
2. Isi **nama lengkap** + **email kantor**. Divisi dan level terkunci.
3. Tekan **Tambah Anggota Tim**. Sistem menampilkan **password sementara**
   berformat `MEAGO-XXXX-XXXX-XXXX` — **hanya sekali**. Salin, kirim ke yang
   bersangkutan lewat jalur pribadi (bukan grup).
4. Anggota tim login dengan email + password sementara itu, lalu **wajib**
   menetapkan passwordnya sendiri sebelum bisa memakai sistem. Password yang
   Anda pegang berhenti berlaku saat itu juga.

Password hilang sebelum sempat diserahkan? SPV tidak bisa menerbitkan ulang —
minta OD/HR menekan **Reset password** di baris karyawan itu.

## 4. Mencabut akses

Tiga jalan, semuanya berakhir sama (dan ketiganya diuji di
`scripts/test_employee_onboarding.sql`):

1. **Otomatis** — tanggal tutup terlampaui. Tidak ada yang perlu dilakukan
   siapa pun; ini jalur normal.
2. **Satu tombol** — *Cabut akses SPV/Lead sekarang* di kartu jendela.
3. **Hapus centang** izin lalu simpan.

Sesudah dicabut, penambahan karyawan kembali sepenuhnya ke OD/HR dan Director —
persis keadaan sebelum migrasi 0367. Tidak ada yang perlu di-drop atau
di-rollback.

## 5. Jejak dan audit

- Kolom **Ditambahkan oleh** di daftar karyawan menyebut penambahnya; akun yang
  masuk lewat jendela bertanda `via SPV`.
- Kolom **Password**: `sementara` = pemiliknya belum menetapkan passwordnya
  sendiri; `sendiri` = sudah.
- Setiap penambahan masuk `audit_log` (entity `employee`) lengkap dengan
  aktornya — termasuk yang dilakukan SPV. Audit tidak bisa diubah atau dihapus
  siapa pun, Director sekalipun.

## 6. Setelah jendela tutup — checklist OD

- [ ] Daftar karyawan cocok dengan daftar tim tiap divisi (tanya SPV bila ada
      selisih).
- [ ] Tidak ada akun tersisa berstatus **password sementara** yang pemiliknya
      sudah aktif bekerja; yang belum login diingatkan atau di-reset.
- [ ] Level dan flag sudah benar — SPV hanya bisa membuat Staff, jadi
      pengangkatan Lead/SPV dan pemberian flag OD dilakukan OD/Director di sini.
- [ ] Karyawan yang tidak jadi bergabung di-nonaktifkan (`active=false`), bukan
      dihapus (riwayatnya dipakai audit dan modul lain).
