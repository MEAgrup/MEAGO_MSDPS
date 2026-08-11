# Troubleshooting

## 401 "Invalid API key" saat Tambah Karyawan (TERKONFIRMASI 2026-08-11)

**Gejala.** Form terkirim, muncul `Supabase menolak service-role key (401): Invalid API key`.

**Penyebab.** `SUPABASE_SERVICE_ROLE_KEY` dan `NEXT_PUBLIC_SUPABASE_URL` menunjuk **project
Supabase yang berbeda**. Panel diagnosa di `/employees` melaporkan:

```
URL Supabase: https://vgjzvdpxrdoefoncuazw.supabase.co     ← MSDPS Staging
Service-role key: … role "service_role", ref "mvcckptntrvzujqaoxxh"   ← MSDPS Production
Panggilan admin ke Supabase GAGAL (401): Invalid API key
```

Key-nya sendiri sah (`role service_role`, utuh, tanpa spasi) — tapi milik project lain, dan
Supabase selalu menolak key lintas-project dengan 401. Pesan Supabase tidak pernah menyinggung
soal project, jadi tanpa perbandingan `ref` penyebabnya tidak kelihatan.

**Asalnya** dari setup staging (`docs/STAGING.md` §3): environment Preview sudah diarahkan ke
Supabase staging untuk `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`, tapi
`SUPABASE_SERVICE_ROLE_KEY`-nya masih tertinggal memakai key production. Efeknya hanya terasa di
fitur yang butuh service-role (buat akun karyawan / akun portal kreator) — sisanya jalan normal
karena memakai anon key, sehingga masalahnya baru muncul saat QA menambah user.

**Perbaikan konfigurasi.** Vercel → `meago-msdps` → Settings → Environment Variables →
`SUPABASE_SERVICE_ROLE_KEY` pada scope yang bersangkutan: isi dengan `service_role` dari project
**yang sama dengan URL-nya**, lalu redeploy environment itu.

| Environment | URL | Ambil `service_role` dari |
|---|---|---|
| Production (`main`) | `mvcckptntrvzujqaoxxh` | project **MSDPS** |
| Preview / branch `staging` | `vgjzvdpxrdoefoncuazw` | project **MSDPS Staging** |

**Perbaikan di kode.** `adminKeyWarning()` kini membandingkan klaim `ref` di JWT dengan project
ref pada URL dan menyebut mismatch-nya langsung (lengkap dengan nama project), jadi kasus ini
tidak lagi perlu dibaca manual dari panel. Kalau bentuk key lolos semua cek tapi tetap ditolak
401/403, `adminKeyRejectionHint()` mengarahkan ke kemungkinan terakhir: JWT secret sudah
dirotasi atau legacy API key dinonaktifkan.

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
