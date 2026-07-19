# Staging Environment — MSDPS & MCN MEA

Dokumen ini menjelaskan environment **staging** yang dibuat sebagai duplikat dari
production, untuk kedua aplikasi di ekosistem MEA yang punya backend Supabase sendiri:
**MEAGO!/MSDPS** (repo ini) dan **MCN MEA standalone** (repo terpisah, kode tidak ada
di sini).

Tujuan staging: tempat menguji migrasi database & fitur baru dengan data yang mirip
production, tanpa risiko merusak data real.

---

## 1. Ringkasan arsitektur environment

| | **Production** | **Staging** |
|---|---|---|
| **MSDPS/MEAGO! (repo ini)** | ref `mvcckptntrvzujqaoxxh`<br>`https://mvcckptntrvzujqaoxxh.supabase.co` | ref `vgjzvdpxrdoefoncuazw`<br>`https://vgjzvdpxrdoefoncuazw.supabase.co`<br>nama project: **"MSDPS Staging"** |
| **MCN MEA (app standalone, repo terpisah)** | ref `bqknstylbpwsnlgnzayw` | ref `fomlangoiiywhexwoqom`<br>nama project: **"MCN MEA Staging"** |

Catatan:
- Kedua project staging berada di organisasi Supabase yang sama dengan production
  (**"yohanagustian-del's Org"**), region **ap-southeast-2**, biaya masing-masing
  **$10/bulan** (jadi total tambahan **$20/bulan** untuk dua staging project).
- Data + schema staging adalah **copy dari production** (schema dari
  `supabase/migrations` untuk MSDPS). **File storage (bucket/objects) TIDAK ikut
  ter-copy** — hanya metadata/skema yang ada, isi file harus di-upload ulang manual
  kalau dibutuhkan untuk testing. **Auth users IKUT ter-copy**, jadi akun
  login staging = akun login production (password sama).

---

## 2. Cara kerja staging untuk MEAGO!/MSDPS (repo ini)

Frontend tetap satu project Vercel yang sama (`meago-msdps`, team `meagency`) — **tidak
ada project Vercel duplikat**. Yang membedakan production vs staging adalah **branch
git** dan **environment variables** yang di-scope ke branch tersebut.

- Branch `main` → production. Vercel Production deployment, pakai Supabase production.
- Branch `staging` → staging. Vercel otomatis membuat Preview deployment dengan URL tetap:

  ```
  https://meago-msdps-git-staging-meagency.vercel.app
  ```

  Preview ini dikonfigurasi (lihat §3) untuk memakai Supabase **staging**
  (`vgjzvdpxrdoefoncuazw`), bukan production.

### Alur kerja yang direkomendasikan

1. Fitur/perbaikan dikembangkan di branch feature (`claude/...` atau branch lain) —
   biasanya juga dapat Preview URL sendiri dari Vercel.
2. Setelah siap, merge (atau langsung push/test) ke branch **`staging`**. Migrasi DB
   baru diterapkan dulu ke Supabase staging (lihat §4), lalu di-test lewat
   `https://meago-msdps-git-staging-meagency.vercel.app`.
3. Kalau sudah oke di staging (fungsional benar, tidak ada error, data terlihat wajar),
   baru merge `staging` → `main`. Migrasi yang sama lalu diterapkan ke Supabase
   production, dan Vercel Production ter-deploy otomatis dari `main`.

Intinya: **jangan langsung merge ke `main`** untuk perubahan yang menyentuh skema DB
atau alur data — lewat `staging` dulu.

---

## 3. Setup Vercel — Environment Variables (langkah manual, sekali saja)

Dashboard: **Vercel → project `meago-msdps` → Settings → Environment Variables.**

Tambahkan 3 variable berikut dengan scope **Preview**, dan batasi ke branch **`staging`**
saja (opsi "Custom" / pilih branch spesifik saat menambah variable, tersedia di
Vercel untuk Preview environment):

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://vgjzvdpxrdoefoncuazw.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ambil dari dashboard Supabase project **"MSDPS Staging"** → Settings → API → `anon` `public` key |
| `SUPABASE_SERVICE_ROLE_KEY` | ambil dari dashboard Supabase project **"MSDPS Staging"** → Settings → API → `service_role` key (rahasia, jangan expose ke client) |

**Penting — gap yang harus diperhatikan:** branch Preview *lain* (semua feature branch
selain `staging`) akan tetap memakai environment variable Preview **default**, yang
saat ini masih menunjuk ke Supabase **production**. Artinya **setiap Preview deployment
non-`staging` saat ini membaca/menulis ke database production**.

Rekomendasi: set juga default Preview environment variables (tanpa branch restriction)
ke nilai Supabase staging di atas, supaya *semua* preview (termasuk PR/feature branch)
otomatis aman dan tidak menyentuh DB production. Kalau ada kebutuhan spesifik test
langsung ke production dari sebuah branch, baru override per-branch seperlunya.

---

## 4. Menerapkan migrasi ke staging

Ada dua cara, pilih salah satu.

### a) Lewat script yang sudah ada di repo (`scripts/apply_migrations.mjs`)

Script ini membaca semua file `supabase/migrations/*.sql` (urut nama file) dan
mengirimkannya ke Supabase Management API project sesuai `ref`. Secara default
(fallback) `ref` mengarah ke **production** (`mvcckptntrvzujqaoxxh`), kecuali
di-override lewat env `SUPABASE_PROJECT_REF`. Token personal access token dibaca dari
file `.supabase-token` (gitignored, harus dibuat manual sekali di root repo, isinya
Supabase Personal Access Token kamu).

Untuk staging:

```bash
SUPABASE_PROJECT_REF=vgjzvdpxrdoefoncuazw node scripts/apply_migrations.mjs
```

Atau pakai npm script yang sudah ditambahkan (lihat juga §"Perubahan pada
`package.json`" di bawah):

```bash
npm run db:migrate:staging
```

### b) Lewat Supabase CLI

```bash
supabase link --project-ref vgjzvdpxrdoefoncuazw
supabase db push
```

### Kebijakan wajib

**Migrasi baru WAJIB diuji dulu di staging sebelum diterapkan ke production.** Urutan
yang benar: tulis migrasi → apply ke staging → test lewat
`https://meago-msdps-git-staging-meagency.vercel.app` → baru apply ke production
(`npm run db:migrate:prod` atau `node scripts/apply_migrations.mjs` tanpa override,
atau `supabase link --project-ref mvcckptntrvzujqaoxxh && supabase db push`).

---

## 5. Refresh data staging dari production

Karena staging dipakai untuk testing, datanya akan lama-lama menyimpang dari
production (row baru production tidak otomatis masuk ke staging). Kalau butuh data
staging yang segar/sinkron lagi dengan production, dua opsi:

1. **Minta Claude (agent) menjalankan ulang proses copy** production → staging (schema
   + data), sama seperti proses awal pembuatan staging project ini. Ini paling praktis
   karena mengulang langkah yang sudah pernah dijalankan.
2. **Manual lewat dashboard Supabase**: gunakan fitur backup/restore project
   (Database → Backups) di production untuk export, lalu restore ke project staging.
   Perlu diingat: file storage tetap tidak ikut, dan auth users perlu ditangani
   terpisah kalau ingin tetap sinkron.

Setelah refresh, cek ulang Auth settings staging (lihat §6) karena beberapa
konfigurasi dashboard tidak ikut ter-restore otomatis tergantung metode yang dipakai.

---

## 6. Gap manual yang harus di-set di dashboard Supabase staging

Hal-hal berikut **tidak otomatis ikut ter-copy** dari production dan perlu dicek/di-set
manual di dashboard **project "MSDPS Staging"** (`vgjzvdpxrdoefoncuazw`):

- **Auth → Settings**:
  - **Disable signup publik** (Enable email signups → off) atau pastikan tetap
    invite-only, sama seperti kebijakan production (login = email/password, invite
    admin, no public signup).
  - **SMTP** custom (kalau production pakai SMTP sendiri untuk email) — kalau tidak
    di-set, staging akan pakai email default Supabase yang rate-limit ketat.
  - **Site URL** dan **Redirect URLs**: ubah dari domain production ke
    `https://meago-msdps-git-staging-meagency.vercel.app` (dan `localhost` kalau perlu
    untuk dev lokal), supaya link konfirmasi/reset password mengarah ke tempat yang
    benar.
- **Storage**: bucket/objects file **tidak ikut ter-copy** dari production. Kalau
  fitur yang ditest butuh file (misal upload dokumen/Creator Analysis), file contoh
  perlu di-upload manual ke staging.

---

## 7. App MCN MEA standalone (repo terpisah)

Untuk aplikasi **MCN MEA** yang berdiri sendiri (bukan bagian repo ini):

- Database staging **sudah dibuat**: project **"MCN MEA Staging"**, ref
  `fomlangoiiywhexwoqom` (copy dari production ref `bqknstylbpwsnlgnzayw`).
- Frontend-nya di-setup dengan **pola yang sama** seperti di sini: branch `staging` +
  environment variable Preview yang di-scope ke branch tersebut, mengarah ke project
  Supabase staging di atas — dilakukan di project Vercel **milik app MCN MEA itu
  sendiri** (bukan `meago-msdps`).
- Kode dan dokumentasi setup lebih detail untuk app tersebut ada di **repo terpisah**
  milik MCN MEA, bukan di repo ini.
