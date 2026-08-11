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

**Yang harus dilakukan di sisi konfigurasi** (tidak bisa dikerjakan dari repo):
1. Vercel → project MSDPS → Settings → Environment Variables.
2. Pastikan `SUPABASE_SERVICE_ROLE_KEY` ada dan ter-scope ke **Production** (dan Preview kalau
   QA memakai preview deployment). Nilainya: Supabase → project `mvcckptntrvzujqaoxxh` →
   Settings → API → `service_role`. Server-only — jangan diberi prefix `NEXT_PUBLIC_`.
3. **Redeploy** — env baru tidak berlaku untuk deployment yang sudah jadi.
4. Ulangi Tambah Karyawan. Kalau masih gagal, form kini menampilkan penyebab aslinya
   (mis. "Email … sudah terpakai", "service-role key ditolak (401/403)").

## Divisi yang bisa dipilih di Tambah Karyawan

Daftar divisi ada di `lib/divisions.ts` dan harus sama persis dengan enum `division` di DB
(migrasi 0002 = 8 divisi dasar, migrasi 0300 menambah `CreatorManagement` + `Acquisition`).
Sebelumnya daftar di form berhenti di 8 divisi, sehingga staf MEAGO (CreatorManagement) dan
Acquisition tidak bisa dibuat lewat UI. Form dan server action sekarang membaca konstanta yang
sama, jadi pilihan UI tidak bisa menyimpang dari yang diterima DB.
