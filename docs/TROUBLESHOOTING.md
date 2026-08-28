# Troubleshooting

## "Internal server error" saat Tambah Karyawan / Buat akun portal kreator

**Gejala.** Form `/employees` → *Tambah Karyawan* (atau `/meago/creators` → *Buat akun*)
dikirim, lalu muncul layar error server tanpa keterangan — bukan pesan merah di dalam form.

**Penyebab.** Kedua fitur memanggil `createAdminClient()` (service-role) untuk membuat user di
Supabase Auth. Bila `SUPABASE_SERVICE_ROLE_KEY` (atau `NEXT_PUBLIC_SUPABASE_URL`) tidak ada di
environment runtime, `@supabase/supabase-js` **melempar** `supabaseKey is required.` secara
sinkron. Dulu server action tidak menangkapnya, jadi exception itu lolos ke Next.js dan tampil
sebagai 500 generik — tanpa error boundary, seluruh halaman ikut mati.

Bukti di DB live `mvcckptntrvzujqaoxxh`: **tidak ada satu pun** baris `auth.users` /
`audit_log(entity='employee')` yang lahir dari UI — semua akun yang ada dibuat lewat
`npm run seed` (pakai `.env.local` lokal) atau SQL Editor. Jadi jalur ini memang belum pernah
berhasil di deployment.

**Perbaikan di kode** (sudah ada di repo):
- `lib/supabase/admin.ts` — `hasAdminEnv()` + pesan `ADMIN_ENV_MESSAGE` yang menyebut env mana
  yang kurang, menggantikan `supabaseKey is required.`
- `lib/actions/employees.ts`, `lib/actions/portal.ts` — preflight env + `try/catch` menyeluruh:
  server action **tidak pernah melempar**, semua kegagalan keluar sebagai pesan di dalam form.
  401/403 dari Supabase dipetakan ke "service-role key ditolak" (salah salin / sudah dirotasi).
- `app/error.tsx` — error boundary root: kalau masih ada exception tak terduga, user melihat
  pesan + `digest` (untuk dicocokkan ke log Vercel) dan tombol "Coba lagi".
- `app/(app)/campaigns/page.tsx` — metrik marketing tampil kosong kalau service key tidak ada,
  halaman tidak ikut jatuh (pola yang sudah dipakai `/meago/creators`).

**Cara memastikan penyebabnya (production, satu klik).** `/employees` → card *Tambah Karyawan*
→ tombol **"Cek koneksi service-role"** (OD/Director). Panel ini melaporkan, dari dalam runtime
production itu sendiri:

- apakah `NEXT_PUBLIC_SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` benar-benar terbaca;
- bentuk key-nya — panjang, awalan, format (`jwt` / `sb_secret_` / `sb_publishable_`), dan untuk
  JWT legacy juga klaim `role` + `ref` project. **Nilai key tidak pernah ditampilkan.**
  Kalau yang terpasang ternyata anon key, panel langsung menyebut `role "anon"`;
- hasil panggilan admin sungguhan ke Supabase (`auth.admin.listUsers`) beserta status errornya.

Diagnosa yang sama otomatis ditempel ke pesan gagal di form, jadi percobaan berikutnya sudah
membawa jawabannya tanpa perlu buka log.

**Yang harus dilakukan di sisi konfigurasi** (tidak bisa dikerjakan dari repo):
1. Vercel → project MSDPS → Settings → Environment Variables.
2. Pastikan `SUPABASE_SERVICE_ROLE_KEY` ada dan **checkbox Production-nya tercentang** — env yang
   hanya ter-scope Development/Preview tetap terlihat ada di daftar, tapi tidak terbaca di
   production. Nilainya: Supabase → project `mvcckptntrvzujqaoxxh` → Settings → API →
   `service_role` (bukan `anon`). Server-only — jangan diberi prefix `NEXT_PUBLIC_`.
3. **Redeploy** — env baru/berubah tidak berlaku untuk deployment yang sudah jadi. Kalau env
   ditambahkan setelah deployment production terakhir, runtime-nya masih memakai nilai lama
   (yaitu: kosong).
4. Ulangi Tambah Karyawan. Kalau masih gagal, form kini menampilkan penyebab aslinya
   (mis. "Email … sudah terpakai", "service-role key ditolak (401/403)").

## Divisi yang bisa dipilih di Tambah Karyawan

Daftar divisi ada di `lib/divisions.ts` dan harus sama persis dengan enum `division` di DB
(migrasi 0002 = 8 divisi dasar, migrasi 0300 menambah `CreatorManagement` + `Acquisition`).
Sebelumnya daftar di form berhenti di 8 divisi, sehingga staf MEAGO (CreatorManagement) dan
Acquisition tidak bisa dibuat lewat UI. Form dan server action sekarang membaca konstanta yang
sama, jadi pilihan UI tidak bisa menyimpang dari yang diterima DB.

## Login gagal tanpa pesan (error `{}`) padahal akun & password benar

**Gejala.** User baru dibuat, akunnya ada di `auth.users`, password sudah benar, tapi setiap
percobaan login di `/login` gagal dan pesan yang muncul kosong / `{}`. Yang terkena hanya akun
tertentu — user lain login normal di saat yang sama.

**Cara memastikan.** Supabase → project MSDPS → Logs → Auth Logs, cari `POST /token` di jam
percobaan login. Baris yang bersangkutan berstatus **500** dengan:

```
error finding user: sql: Scan error on column index 3, name "confirmation_token":
converting NULL to string is unsupported
error_code: unexpected_failure
```

Atau lewat SQL:

```sql
select email from auth.users
where confirmation_token is null or recovery_token is null
   or email_change_token_new is null or email_change is null;
```

**Sebab.** GoTrue (server auth Supabase) memetakan kolom token di `auth.users` —
`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`,
`email_change_token_current`, `phone_change`, `phone_change_token`, `reauthentication_token` —
ke tipe `string` Go yang **tidak nullable**. Empat kolom pertama tidak punya `DEFAULT ''` di
skema `auth`, jadi baris yang dibuat lewat jalur selain Admin API (`INSERT` SQL langsung ke
`auth.users`, skrip seed, restore parsial) meninggalkannya `NULL`. Sejak itu GoTrue gagal
membaca baris user tersebut dan mengembalikan 500 **sebelum** password sempat diperiksa —
karena itu ganti password atau reset tidak menolong sama sekali.

Akun yang dibuat lewat menu **Tambah Karyawan** / **Buat akun portal kreator** di aplikasi tidak
terkena: keduanya memakai `auth.admin.createUser`, yang mengisi kolom-kolom itu dengan `''`.

**Perbaikan.** Migrasi `0318_auth_users_token_null_guard.sql`:
1. Backfill semua baris `NULL` → `''`.
2. Trigger `auth_users_token_defaults` (BEFORE INSERT OR UPDATE di `auth.users`) yang memaksa
   `NULL → ''`, sehingga jalur pembuatan user apa pun tidak bisa lagi melahirkan akun yang tidak
   bisa login. Kolomnya sengaja dibiarkan nullable — menambah `NOT NULL` di skema `auth` bisa
   bentrok dengan migrasi internal Supabase saat GoTrue di-upgrade.

Kalau kejadian lagi di project lain (mis. MCN MEA), jalankan migrasi yang sama di sana.

**Catatan tampilan error.** Halaman login dulu merender `error.message` apa adanya; pada 500
GoTrue badan responsnya kosong sehingga yang terlihat user hanya `{}`. `app/login/page.tsx`
sekarang memakai `describeAuthError()` yang selalu menghasilkan kalimat lengkap dengan
status + kode, jadi keluhan user bisa langsung dicocokkan dengan Auth Logs. Kegagalan membaca
profil karyawan/kreator setelah login juga tidak lagi memicu sign-out dengan pesan
"tidak terhubung ke karyawan maupun kreator" yang menyesatkan.
