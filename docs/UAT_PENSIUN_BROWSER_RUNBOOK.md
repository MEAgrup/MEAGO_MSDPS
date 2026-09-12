# Runbook — UAT Browser Pensiun Account & Service (migr. 0361-0363)

Ditulis 2026-09-12 karena sesi Claude Code sandboxed TIDAK BISA menjalankan ini
sendiri: outbound HTTPS sesi itu lewat egress proxy ber-allowlist organisasi,
dan `*.supabase.co` bukan anggota allowlist-nya (`curl` lewat proxy tsb
mengembalikan `403 connect_rejected`, bukan bug — kebijakan sengaja). Jalankan
runbook ini dari mesin dengan akses jaringan normal (laptop Anda, atau sesi
Claude Code lain yang TIDAK di-sandbox).

Semua prasyarat DI BAWAH INI **sudah disiapkan** di sesi sebelumnya — Anda
tinggal jalankan dari langkah 1.

---

## 0. Yang sudah disiapkan (jangan diulang)

- **Migrasi `0361`/`0362`/`0363` sudah di-apply ke `MSDPS Staging`**
  (`vgjzvdpxrdoefoncuazw`) — skema staging sudah sama dengan production
  (yang juga sudah di-apply migrasi yang sama, lihat `docs/BUILD_PLAN.md`).
- **Tiga akun uji staging-only sudah dapat password dikenal** (lewat SQL
  `update auth.users set encrypted_password = crypt(...)`, HANYA di project
  staging, TIDAK menyentuh password akun production siapa pun):

  | Email | Password | Peran | Kenapa dipilih |
  |---|---|---|---|
  | `fina@meago.test` | `UatTest2026!` | Finance / staff | Divisi yang TETAP HIDUP — cek nav normal |
  | `anty@meago.test` | `UatTest2026!` | Account / staff | Salah satu dari 10 yang di-`active=false` di **production** (P3) — di staging MASIH `active=true`, jadi bisa dipakai untuk lihat tampilan "sebelum dinonaktifkan" DAN (kalau Anda jalankan langkah 5) "sesudah" |
  | `ghifari@meago.dev` | `UatTest2026!` | Account / lead, `is_director=true` | Akun uji sintetis (BUKAN akun pribadi siapa pun) untuk mewakili sudut pandang Director — cek `/okr` dan gerbang role |

  Ketiganya email `@meago.test`/`@meago.dev` — akun data uji/seed, bukan email
  pribadi karyawan. **Password di atas HANYA berlaku di project staging**;
  tidak mengubah apa pun di production.

- **`.env.local` sudah ditulis** di root repo (root ini, `meago_msdps/`)
  berisi:
  ```
  NEXT_PUBLIC_SUPABASE_URL=https://vgjzvdpxrdoefoncuazw.supabase.co
  NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key staging>
  ```
  File ini gitignored (`.env*.local` di `.gitignore`) — kalau Anda kloning
  ulang repo ini di mesin lain, file ini TIDAK ikut ter-clone dan harus
  dibuat ulang (lihat langkah 1).

## 1. Siapkan environment lokal (kalau `.env.local` belum ada)

```bash
cd meago_msdps   # repo ini, branch claude/exciting-cori-w72aus
npm ci
```

Kalau `.env.local` belum ada di mesin Anda, buat:

```bash
cat > .env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://vgjzvdpxrdoefoncuazw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ambil dari dashboard Supabase "MSDPS Staging" → Settings → API → anon public>
EOF
```

**Jangan** isi `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` dengan nilai production
(`mvcckptntrvzujqaoxxh`) — password uji di atas cuma berlaku di staging.

## 2. Jalankan dev server

```bash
npm run dev
```

Buka `http://localhost:3000/login`.

⚠️ **Jangan** `npm run build`/`next build` selagi `npm run dev` menyala —
aturan rumah repo ini (`docs/BUILD_PLAN.md` baris 50): build menimpa `.next`
yang dipakai server dev, aset jadi korup.

## 3. Checklist UAT — jalankan sebagai `fina@meago.test` (divisi hidup)

Login dengan `fina@meago.test` / `UatTest2026!`.

- [ ] Login sukses, redirect ke `/dashboard`, nol error console.
- [ ] Nav sidebar **TIDAK** lagi menampilkan grup terpisah untuk
      Account/E-commerce/Ads/KOL/Live Stream/Board/Portal/Management.
- [ ] Nav menampilkan grup **"Merchant & Kampanye"** berisi `/merchants` +
      `/campaigns`.
- [ ] Buka LANGSUNG via URL bar (bukan klik nav, karena nav-nya sudah tidak
      ada linknya): `/account`, `/ecommerce`, `/ads`, `/kol`, `/livestream`,
      `/board`, `/portal`, `/management` — **kedelapannya** harus menampilkan
      halaman nisan yang SAMA: pesan
      `[modul ini sudah pindah ke CDPS — eksekusi layanan tidak lagi dijalankan di MEAGO]`
      + tombol ke `/deals`. Nol query DB (halaman harus muncul instan, tanpa
      loading spinner data).
- [ ] Klik tombol di halaman nisan → mendarat di `/deals`.
- [ ] Buka `/okr` — halaman render tanpa error, menampilkan metrik divisi
      non-operasional (BizDev/CreatorManagement/Acquisition/Marketing/
      Finance) dengan **pace** di samping attainment.

## 4. Checklist UAT — Bridge "Teruskan ke CDPS" (`/deals`)

Masih sebagai `fina@meago.test` (atau BizDev/CreatorManagement kalau ada akun
staging lain — Finance sendiri TIDAK termasuk `can_manage_bridge()`, jadi
kalau tombol tidak muncul/disabled untuk Fina, itu **benar**, bukan bug —
coba akun BizDev/CreatorManagement kalau tersedia, atau lihat §5 pakai
`ghifari@meago.dev`, Account+`is_director=true`, yang JUGA berwenang lewat
`is_director()`).

- [ ] Buka `/deals`, cari deal Berbayar yang sudah terverifikasi Finance.
- [ ] Klik "Teruskan ke CDPS" → modal pilih baris muncul.
- [ ] Dropdown jenis layanan menampilkan **ENAM** opsi: Account, Ads,
      Creative, Store Operation, KOL-Non-Roster, **dan `Live Stream`** (yang
      terakhir ini baru — D2 dibalik migr. 0362).
- [ ] Pilih `Live Stream`, isi baris, submit → baris tersimpan di
      `deal_bridge_lines` (bisa cek lewat MCP Supabase `execute_sql` kalau
      mau verifikasi DB, project `vgjzvdpxrdoefoncuazw`).

## 5. Checklist UAT — akun dinonaktifkan (opsional, mirror P3 ke staging)

Langkah ini MENGUBAH staging (mirror keputusan P3 yang sudah dieksekusi di
production) — lakukan HANYA kalau Anda ingin menguji perilaku "karyawan
dinonaktifkan", bukan wajib untuk UAT dasar.

1. Set `anty@meago.test` jadi `active=false` di staging (lewat MCP Supabase
   `execute_sql` project `vgjzvdpxrdoefoncuazw`, ATAU dashboard Supabase Table
   Editor):
   ```sql
   update employees set active = false where id = 'b35fea84-b182-4a00-8da8-b440d509c018';
   ```
2. Logout, login ulang sebagai `anty@meago.test` / `UatTest2026!`.
3. Verifikasi: GoTrue login itu sendiri kemungkinan besar TETAP sukses
   (`active` bukan kolom yang dibaca GoTrue) — yang harus diverifikasi adalah
   APAKAH lapisan aplikasi (RLS `is_employee()` atau redirect di
   `app/login/page.tsx`) menolak/meredirect setelah login. Kalau ternyata
   TIDAK ada gate seperti itu, itu temuan penting untuk dilaporkan — cek
   `lib/supabase/*` dan RLS helper `is_employee()` untuk memastikan
   `active=false` benar-benar berarti "tidak bisa apa-apa", bukan cuma flag
   kosmetik.
4. **Setelah selesai, kembalikan** `active=true` di staging (staging harus
   tetap mencerminkan keadaan employees yang wajar untuk sesi UAT berikutnya):
   ```sql
   update employees set active = true where id = 'b35fea84-b182-4a00-8da8-b440d509c018';
   ```

## 6. Checklist UAT — sudut pandang Director (`ghifari@meago.dev`)

Login dengan `ghifari@meago.dev` / `UatTest2026!` (akun uji sintetis,
`is_director=true`, BUKAN akun pribadi siapa pun).

- [ ] `/okr` menampilkan SEMUA divisi (Director baca semua, bukan cuma
      divisinya sendiri).
- [ ] Kedelapan URL pensiun di §3 tetap menampilkan nisan yang sama (nisan
      tidak dibedakan per role — cek ini juga berlaku untuk Director).
- [ ] `/deals` → tombol "Teruskan ke CDPS" berfungsi (Director termasuk
      `can_manage_bridge()`).

## 7. Setelah selesai

- **Jangan** commit `.env.local` (sudah gitignored, tapi cek `git status`
  untuk memastikan).
- Laporkan hasil checklist §3-§6 (per-item pass/fail) — kalau ada yang FAIL,
  sertakan screenshot + console error kalau ada.
- Kalau Anda menjalankan §5 (nonaktifkan `anty@meago.test`), **pastikan
  langkah 4 di §5 (kembalikan `active=true`) sudah dijalankan** sebelum
  menutup sesi UAT.
- Password uji (`UatTest2026!`) di staging BOLEH dibiarkan apa adanya untuk
  sesi UAT berikutnya, atau diganti kalau mau — staging bukan data real,
  tidak ada risiko keamanan nyata di sini.
