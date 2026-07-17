# Fase F — Creator Portal (Portal Kreator MEA GO)

Plan hasil interview Yohan 2026-07-17 (sesi orchestrator). Status: **desain F.1 terkunci, implementasi BELUM dimulai**. Referensi visual: mockup sidebar "MCN MEA — Portal Kreator" (7 menu). Kode mcnapp TIDAK dipakai — dibangun dari awal mengikuti konvensi MSDPS (keputusan 2026-07-17; repo mcnapp tak dapat diakses lintas-owner dari sesi CCR meagrup).

---

## 1. Gambaran

Portal untuk **kreator** (user eksternal, BUKAN karyawan MEAGO) melihat performanya dan mengajukan request ke agency. Menu mockup:

| Menu | Fase | Isi |
|---|---|---|
| Performa Saya | **F.1** | Metrik mingguan W1–W5 + ringkasan 3 bulan |
| Agency Plan | F.2 | ⚠ definisi belum di-interview |
| Report Saya | F.2 | ⚠ definisi belum di-interview (bedanya dgn Performa?) |
| Request Brand/Ads | **F.1** | Ajukan request model MEA GO + status request |
| Special Project | **F.1** | Read-only project yang meng-assign kreator ybs |
| Komplain & Feedback | F.2 | Antrian ke **CM owner** kreator (keputusan terkunci) |

F.1 = pondasi auth + 3 menu inti. Menu F.2 tetap tampil di sidebar sebagai placeholder.

## 2. Keputusan interview TERKUNCI (jangan re-litigasi)

1. **Akun kreator dibuat admin** (CM/OD) lalu dikaitkan ke `mcn_creators` — tidak ada pendaftaran mandiri (mirror pola karyawan).
2. **Login satu pintu `/login`**, auto-route pasca-login: `auth.uid()` ada di `employees` → app karyawan; ada di `mcn_creators.auth_user_id` → portal kreator; tidak keduanya → sign-out + error. Middleware saling-blokir route.
3. **Model request MEA GO ≠ MCN lama** (`sample/ads/hsl` TIDAK dipakai di portal). 4 jenis:
   - `free_meal` — Free Meal, kategori **Dining**, dari merchant tertentu.
   - `visit` — Visit, kategori **Accommodation & Things to Do**, dari merchant tertentu.
   - `ads_live` — Ads budget untuk live.
   - `special_price_live` — Harga special live.
4. **Target merchant** (free_meal/visit): **keduanya** — dropdown merchant master M4 difilter kategori (Free Meal→Dining; Visit→Accommodation/Things to Do) + opsi "lainnya" ketik bebas bila belum terdaftar.
5. **Routing request → antrian BizDev** (`/bizdev`), bukan CM owner.
6. **`ads_live` auto-gate cap**: nominal > `ads_budget_cap` kreator ATAU cap null → `needs_approval=true` (approval Director; mekanisme trigger 0306 yang sudah ada).
7. **Performa Saya**: selector **W1–W5 bulan berjalan + ringkasan rata-rata 3 bulan**; metrik **operasional TANPA komisi** (GMV/Sales value, Orders, AOV, Redemption, New posts, Posts with sales, Live streams, Valid live streams — `commission_share` & Redeemed GMV internal-only? Redemption amount boleh; commission_share TIDAK).
8. **Komplain & Feedback (F.2)** → antrian CM owner di CM Workspace.

## 3. Temuan teknis (sudah diverifikasi dari kode/DB live)

- `auth.uid()` = `employees.id`; helper RLS di migrasi 0002 (`auth_emp_id`, `auth_division`, `is_od`, `is_director`, `is_lead`, `actor_tokens`) semuanya melihat `employees`. **`mcn_creators` belum punya kolom auth** → butuh `auth_user_id uuid unique references auth.users` + helper baru `auth_creator_id()` (security definer, ambil `mcn_creators.id` by `auth_user_id = auth.uid()`).
- `creator_requests` (0306): type check `sample/ads/hsl`; status `diajukan/diproses/selesai/ditolak`; `needs_approval` + trigger Director-only approve + blok `diajukan→diproses` bila belum approve; code `REQ-` ; state machine `creator_request`; RLS select/update = CM/BizDev/mgmt, insert = CM (staff scope owner). **Konsumen existing yang ikut terdampak rework**: `lib/actions/mcn-requests.ts` (createRequest/approveRequest/progressRequest), `/meago/workspace` (antrian approval Director), `/bizdev` (baca requests).
- RLS tabel yang perlu policy **creator-self (select-only)** baru: `mcn_creators` (baris sendiri), `creator_period_summary` (mcn_creator_id = auth_creator_id()), `special_project_creators` + `special_projects` (yang meng-assign dirinya), `creator_requests` (baris sendiri; + insert self).
- **Merchant picker**: `merchants` (M4) berisi kolom sensitif (gmv_baseline, target_gmv, total_revenue) — JANGAN beri kreator select policy langsung. Rencana: view `v_portal_merchants` **security definer** berisi hanya `id, nama_toko, kota, kategori`, di-gate `auth_creator_id() is not null`.
- ⚠ **Konflik nama route**: `/portal` SUDAH dipakai Team Portal karyawan. Portal kreator pakai route lain, usul `/kreator/*` (layout sendiri di `app/(kreator)/`, di luar route group `(app)`).
- Login page & middleware saat ini redirect semua user ke `/dashboard` — perlu cabang identitas.

## 4. Rencana implementasi F.1 (urutan step)

**Step 1 — Migrasi 0311 (creator auth + request rework)**
- `mcn_creators` + `auth_user_id uuid unique references auth.users(id)`.
- Fungsi `auth_creator_id()` (security definer, stable) + revoke pattern 0008.
- `creator_requests`: longgarkan check `type` menjadi union lama+baru (`sample,ads,hsl,free_meal,visit,ads_live,special_price_live`) — nilai lama tetap valid untuk baris existing, UI hanya menawarkan yang baru; + kolom `target_merchant_id uuid references merchants(id)` (null), `nominal numeric` (null).
- View `v_portal_merchants` (security definer, kolom terbatas, gate kreator).
- Policy creator-self di 5 tabel (lihat §3). Kreator TIDAK dapat update/delete apa pun kecuali insert `creator_requests` miliknya.
- ⚠ Sebelum apply: cek isi `creator_requests` live (`select type, count(*)`) — bila kosong, boleh langsung ganti check ke daftar baru saja.

**Step 2 — Routing & auth app**
- Middleware/redirect: pasca-login route by identitas; kreator diblok dari route `(app)`, karyawan diblok dari `/kreator`.
- `app/(kreator)/kreator/` layout (sidebar 7 menu, identitas kreator, Keluar) + halaman: `performa` (F.1), `request` (F.1), `special-project` (F.1), placeholder: `agency-plan`, `report`, `komplain`.
- `lib/actions/portal.ts`: `createPortalRequest` (4 jenis, merchant picker/teks bebas, auto-gate `ads_live`).
- Admin: card "Akun Portal Kreator" di `/meago/creators` (buat akun via `createAdminClient` service-role `auth.admin.createUser` + set `auth_user_id`; gate CM lead/mgmt).

**Step 3 — Penyesuaian sisi karyawan**
- `/bizdev`: antrian request portal (4 jenis baru, tampil merchant target/nominal, progress status).
- `/meago/workspace`: antrian approval Director tetap (needs_approval), label jenis baru.
- `lib/actions/mcn-requests.ts`: dukung type baru (atau deprecate form lama CM sesuai kebutuhan — tanyakan Yohan bila ragu).

**Step 4 — Verifikasi & rilis**
- `npx tsc --noEmit` + `npm run build`; smoke test SQL migrasi (harness rollback); uji RLS: sesi kreator TIDAK bisa baca kreator lain/karyawan; QC orchestrator; commit/push branch → PR draft; apply migrasi ke live `mvcckptntrvzujqaoxxh` (pola biasa).

**Orkestrasi**: Fable = orchestrator/QC/revisi; eksekutor Sonnet/Opus/Haiku per step (per instruksi Yohan). Migrasi + RLS dikerjakan/di-QC orchestrator sendiri (kritikal keamanan).

## 5. Pertanyaan terbuka untuk sesi berikutnya (tanya Yohan sebelum F.2)

1. Definisi **Agency Plan** & **Report Saya** (belum di-interview).
2. Nasib form request lama di CM Workspace (jenis `sample/ads/hsl`): tetap ada untuk internal, atau ikut model baru?
3. Kolom komplain & feedback: skema baru atau extend `complaints` M6 (saat ini merchant-scoped)?

---

## 6. STATUS IMPLEMENTASI (2026-07-17, sesi orchestrator branch `claude/fable-orchestrator-multi-model-347a6n`)

**Step 1–3 SELESAI di kode; Step 4 selesai KECUALI apply migrasi ke live** (di-hold — lihat bawah).

- **Step 1 ✅** — `supabase/migrations/0311_creator_portal_auth.sql` ditulis + lolos smoke test transaksi-rollback di live. `creator_requests` live saat itu KOSONG, tapi check `type` tetap dibuat **union lama+baru** (bukan ganti total) agar form CM lama tak pecah sebelum keputusan Yohan (§5.2). Dua keputusan keamanan TAMBAHAN di luar plan awal:
  1. Gate cap `ads_live` **dipaksa di trigger** `creator_requests_validate()` (nominal null / cap null / nominal > cap → `needs_approval=true`) — kreator tak bisa bypass via API.
  2. Enam policy `using (true)` lama digate helper baru `is_employee()`: `employees`, `campaigns`, `service_catalog`, `package_catalog`, `app_config`, `working_calendar` — kreator ikut role `authenticated`, tanpa ini bisa baca data internal.
- **Step 2 ✅** (eksekutor Opus, QC orchestrator) — commit `8278e89`. Portal `app/(kreator)/kreator/*` (layout 6 menu — angka "7 menu" di plan salah hitung, tabel §1 memang 6), Performa (W1–W5 + rata-rata 3 bulan, tanpa komisi), Request (4 jenis, picker `v_portal_merchants` + "Lainnya"), Special Project read-only, 3 placeholder F.2. Routing identitas: query DB hanya di `/login` (middleware) + gating server di kedua layout; orphan → signOut. `lib/actions/portal.ts`: `createPortalRequest` (needs_approval DISERAHKAN ke trigger) + `createCreatorAccount` (service-role, gate CM Lead/OD/Director, rollback deleteUser bila gagal link, guard balapan `.is("auth_user_id", null)`). Card "Akun Portal Kreator" di `/meago/creators` (lookup email dibungkus try/catch).
- **Step 3 ✅** (eksekutor Sonnet, QC orchestrator) — commit `7378f8c`. `/bizdev` card "Request Portal Kreator" (label via `lib/mcn/request-types.ts`, target merchant + nominal, aksi progress state-machine); workspace: antrian approval Director + jenis/target/nominal (kolom merchant sengaja HANYA di antrian Director — RLS merchants tak mengizinkan staff CM); `approveRequest`/`progressRequest` revalidate `/bizdev` juga.
- **Step 4** — `tsc` + `npm run build` LOLOS. Kontrak label bersama: `lib/mcn/request-types.ts`.

### ⛔ BELUM: apply 0311 ke live + uji RLS (sesi berikutnya mulai dari sini)

Apply `0311` ke `mvcckptntrvzujqaoxxh` **ditolak/di-hold user pada sesi ini** — konfirmasi dulu ke Yohan sebelum apply. Konsekuensi sampai di-apply: login kreator/`v_portal_merchants`/kolom `target_merchant_id`+`nominal` belum ada di live → build tetap jalan, halaman baru degrade graceful, TAPI fitur portal belum bisa dipakai dan **deploy kode ini AMAN tanpa migrasi** (tidak ada breaking change ke fitur lama; satu-satunya interaksi: form CM lama tetap valid karena check union).

Urutan sesi berikutnya:
1. Apply `supabase/migrations/0311_creator_portal_auth.sql` ke live via MCP `apply_migration` (isi file = final, sudah smoke-tested).
2. Jalankan uji RLS: skrip draf ada di scratchpad sesi lama (hilang bila container reclaim) — intinya, dalam transaksi rollback: insert 2 user dummy `auth.users` + 2 kreator ber-auth, `set local role authenticated` + `set local request.jwt.claims = '{"sub":"<uuid>"}'`, assert: kreator lihat 1 baris `mcn_creators` (dirinya), performa sendiri saja, `employees`/`campaigns`/`app_config`/`merchants` = 0 baris, `v_portal_merchants` terbaca, insert request sendiri OK + `ads_live` > cap → `needs_approval=true`, insert utk kreator lain GAGAL, update request = 0 baris.
3. Uji e2e manual: buat akun portal via `/meago/creators` (butuh `SUPABASE_SERVICE_ROLE_KEY` di env Vercel — SUDAH ada, dipakai fitur employees), login sebagai kreator, cek 3 halaman + blokir silang route.
4. Buka/refresh PR branch `claude/fable-orchestrator-multi-model-347a6n` (PR #6 lama di branch `-k367i0` docs-only; commit plan-nya sudah di-cherry-pick ke branch ini sebagai `818034d` — PR #6 boleh ditutup).
