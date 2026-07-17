# Handoff — Fitur MCN MEAGO (Kreator Affiliate TikTok)

**Status:** ✅ Selesai & terverifikasi QA · **Branch:** `claude/fable-orchestrator-impl-flsr1i` · **PR:** [#3](https://github.com/MEAgrup/MEAGO_MSDPS/pull/3) (draft)
**DB live:** project `mvcckptntrvzujqaoxxh` (MSDPS) — migrasi 0300–0309 sudah di-apply.
**Preview:** https://meago-msdps-git-claude-fable-orchestrator-impl-flsr1i-meagency.vercel.app

---

## 1. Ringkasan fitur

Modul MCN mengelola kreator affiliate TikTok end-to-end lintas 3 tim: **Creator Management (CM)**, **Acquisition**, dan **BizDev**, plus **Special Project**. Data performa mingguan masuk lewat upload file "Creator Analysis" dari platform TikTok (bukan input manual).

### Halaman (routes)
| Route | Tim | Isi |
|---|---|---|
| `/meago/creators` | CM + mgmt | Tabel master kreator (15 kolom), Upload Data Mingguan, Assign CM/CPM |
| `/meago/workspace` | CM + mgmt | Growth W1–W5, Detail Mingguan, alert, request kreator, approval Director |
| `/meago/schedule` | CM + mgmt | Jadwal live per minggu, slot lock-done |
| `/acquisition` | Acquisition + mgmt | **Daftarkan Kreator Baru (Prospek)**, Prospek Terdaftar, binding, referral, handoff |
| `/bizdev` | BizDev + mgmt | Routing campaign request |
| `/deals` | BizDev + mgmt | Brand deals + produk |
| `/projects` | Lead/CM/BizDev/Acq + mgmt | Special Project + assign kreator |

> Catatan: URL fitur adalah `/meago/*`. Folder kode internal & tabel DB tetap memakai nama `mcn` (mis. `lib/mcn/`, tabel `mcn_creators`) — ini sengaja, tidak memengaruhi URL yang dilihat user.

---

## 2. Alur bisnis (siapa melakukan apa)

1. **Acquisition** mendaftarkan kreator baru sebagai **prospek** (`/acquisition` → Daftarkan Kreator Baru). Field: nama, username TikTok, industry, kota, catatan.
2. **Acquisition** mencatat **binding** (prospek → binding), lalu **handoff** ke CM (binding → aktif). Handoff diblok jika kreator belum punya owner CM.
3. **Lead Creator Growth** (atau manajemen) **assign CM/CPM** ke kreator via `/meago/creators` → card Assign CM/CPM.
4. **CM** meng-**upload data mingguan** (file Creator Analysis) di `/meago/creators` atau `/meago/workspace`. Upload otomatis: buat kreator yang belum ada, isi metrik mingguan, sinkron info master, buat/selesaikan alert.

**Dua jalur menambah kreator:**
- **Manual (prospek)** → oleh Acquisition, untuk kreator baru yang belum ada.
- **Auto (upload master)** → untuk data kreator yang sudah ada di platform; dibuat otomatis saat ingest berstatus aktif.

---

## 3. Format file & aturan ingest "Creator Analysis"

- Workbook XLSX 2 sheet: **Filter** (periode `YYYYMMDD` + creator level) & **Data** (1 baris = 1 kreator/minggu).
- Kolom Data: Creator name, Creator ID (**username = kunci identitas**), Binding status, city, level, Sales value, Orders, AOV, Redemption amount + Redeemed orders, New posts, Posts with sales, LIVE streams, Valid LIVE streams.
- **Periode wajib window W1–W5** (LOCKED) — periode di luar window ditolak.
- **Username = kunci**: nama tampilan boleh berubah & di-update otomatis dari file. Kreator dicocokkan by username; fallback ke nama lalu backfill username.
- **Sales value & Redemption dua-duanya disimpan**; growth memakai Sales value (`affiliate_gmv`).
- **Sinkron master info-only** (name/city/level/binding) — transisi status kreator tetap manual.
- **Null ≠ 0**: metrik kosong ditampilkan `—`, tidak dihitung sebagai 0.

### Alert otomatis
- `perf_drop` — penurunan GMV mingguan ≥ 15% (config `mcn.perf_drop`).
- `binding_lost` — dibuat saat kreator jadi "Previously bound creators"; auto-resolve saat kembali "Bound creators".

---

## 4. Tabel master `/meago/creators` (15 kolom)

Nama · Username · CM · Status · Industry · Jenis · Level · **Avg Pay GMV** · **Redeemed GMV** · Komisi · Total post · Posts with sales · Live stream · Valid live stream · Roster Live

- **Status**: Bounded / Prev. Bounded / Unbounded (dari binding_status).
- **Avg Pay GMV, Redeemed GMV & kolom aktivitas** = rata-rata bulanan **3 bulan kalender terakhir** (bulan tanpa data tidak dihitung; null ≠ 0).
- **Industry** sementara terbatas: Dining / Accommodation / Things to Do.
- **Assign CM/CPM**: hanya **Lead Creator Growth** (lead divisi CreatorManagement) & manajemen.

---

## 5. Skema DB — migrasi

Semua sudah **applied ke project live** `mvcckptntrvzujqaoxxh`.

| Migrasi | Isi |
|---|---|
| 0300–0308 | Fondasi MCN: enum divisi, master kreator, ingest drop-raw, jadwal live, deals, routing campaign, acquisition, special project. (Smoke test 6/6 PASS.) |
| **0309** | Creator Analysis: `mcn_creators` +username/city/creator_level/binding_status (unik pindah ke username); `creator_period_summary` +aov/redemption_amount/redeemed_orders/new_posts/posts_with_sales/live_streams/valid_live_streams; `platform_alerts` +`binding_lost`. Di-apply 2026-07-16 via SQL Editor. |

> **Dorman** (menunggu fase berikutnya): kolom `jenis_creator`/`gmv_live`/`gmv_video`, `ctr`/`ctor`/`live_pct`, dan tabel `creator_subcat_segment_gmv` / `creator_top_products` — dipakai lagi setelah export "list konten video" tersedia.

---

## 6. Akun uji (dummy, DEV-ONLY)

6 karyawan MEAGO di-seed ke DB (password seragam **`Meago2026!`** — ganti sebelum produksi):

| Nama | Email | Divisi | Rank | Akses kunci |
|---|---|---|---|---|
| SPV MEAGO | `spv@meago.dev` | CreatorManagement | lead | is_od (manajemen) |
| Lead Creator Growth | `lead.creatorgrowth@meago.dev` | CreatorManagement | lead | Assign CM/CPM |
| Creator Manager 1 | `cm1@meago.dev` | CreatorManagement | staff | CM (bisa di-assign) |
| Campaign Specialist 1 | `campaign1@meago.dev` | CreatorManagement | staff | — |
| Lead BisDev | `lead.bisdev@meago.dev` | BizDev | lead | BizDev |
| Admin Operasional | `admin.ops@meago.dev` | BizDev | staff | — |

---

## 7. Verifikasi yang sudah lolos

- Parser `lib/mcn/creator-analysis.ts` — QC 32/32 PASS terhadap file sample asli.
- Smoke test SQL migrasi 0300–0308 — 6/6 PASS (harness rollback, DB bersih).
- `npx tsc --noEmit` bersih di setiap step.
- QA manual (oleh user): login, Assign CM/CPM, pendaftaran prospek Acquisition, rename `/meago`, upload — **berhasil**.

---

## 8. Sisa / langkah berikutnya

_Update 2026-07-16 (sesi orchestrator):_

1. ~~**Merge PR #3**~~ — ✅ **MERGED ke `main`** (2026-07-16, setelah QC: tsc + build produksi bersih, advisor DB tanpa temuan baru). PR #2 (draft rencana, tersalip) ditutup. PR #1 (hardening middleware Vercel) juga **merged** — merge bersih, `package-lock.json` versi main (xlsx) dipertahankan.
2. **Rotasi password** akun dummy (atau hapus) sebelum produksi. — masih terbuka.
3. ~~**Fase berikutnya — export "list konten video"**~~ — ❌ **DIBATALKAN** (keputusan 2026-07-16). `jenis_creator` & `niche` kini diisi **manual** via card "Kelola Kreator — Profil, Budget Cap Ads & Roster Live" di `/meago/creators` (`setCreatorProfile`). Artefak dorman terkait fase ini dibiarkan di DB — tidak menunggu apa pun lagi.
4. ~~Fungsi yang tidak bertempat~~ — ✅ **selesai via PR #4** (`claude/fable-orchestrator-workflow-iqd1w6`, merged 2026-07-16): card "Budget Cap Ads & Roster Live" di `/meago/creators` untuk `setAdsBudgetCap` & `toggleRoster`; gate mengikuti RLS `mcn_creators_update` (CM staff hanya kreator miliknya).

_Update 2026-07-17 (Fase E.2–E.3, PR #5 `claude/fable-orchestrator-multi-model-k367i0`):_

5. **Fase E.2 — Penutupan gap MCN** ✅: `setCreatorProfile` + `ProfileRow` (edit manual Jenis live/video/mixed & Industry per kreator di card "Kelola Kreator" `/meago/creators`); `lib/mcn/industries.ts` = sumber tunggal 3 industri TikTok GO (**Dining, Accommodation, Things to Do**) — dipakai kategori merchant (final, PENDING dihapus), project, acquisition. Tanpa migrasi.
6. **Fase E.3 — Revisi QA /projects & workspace** ✅: migrasi **0310** (applied + smoke test PASS 2026-07-17) menambah `special_projects.videos_needed` & `poi_location` (info-only, OPSIONAL) — form Buat Project Baru + list `/projects` saja. Card project di **3 workspace** (CM/Akuisisi/BizDev) kini menampilkan **semua project kecuali cancelled** dengan badge status: **[Persiapan]** bila tanggal mulai belum tiba (turunan tanggal via `lib/mcn/project-status.ts`, hari Asia/Jakarta), [Berjalan]/[Draft]/[Selesai].
7. **Sisa platform** (di luar PR #5): Merchant Portal Fase 2 (belum dibangun, butuh interview desain), rotasi password akun dummy (ditunda ke pra-produksi, keputusan 2026-07-16), aktifkan *leaked password protection* di Supabase Auth (setting dashboard).

---
_Dokumen ini ringkasan status implementasi; detail keputusan interview ada di `docs/MCN_MEA_CONCEPT.md` (§7–8) dan `docs/BUILD_PLAN.md` (baris Fase E / E.1)._
