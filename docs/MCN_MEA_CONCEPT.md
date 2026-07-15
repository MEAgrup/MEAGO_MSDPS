# Konsep MCN MEA di MSDPS — Keputusan Desain & Aturan Bisnis

Ringkasan keputusan interview final untuk fitur MCN (Manajemen Kreator Affiliate TikTok) yang diintegrasikan ke MSDPS, berikut konvensi teknis MSDPS yang dipakai. Dokumen ini referensi bagi developer berikutnya — lihat `MCN_MEA_PLAN.md` untuk detail rencana implementasi.

---

## 1. Struktur 5 Team & Navigasi

Sidebar dikelompokkan per team (role-gated, member hanya melihat grup relevan):

1. **CM Kreator** (divisi `CreatorManagement`): Data Kreator, CM Workspace, Jadwal Live
2. **BizDev & Admin Ops** (divisi `BizDev`): Leads (existing M1), Merchant Deals, BizDev Workspace  
3. **Akuisisi Kreator** (divisi `Acquisition`): Acquisition Workspace
4. **Special Project** (baru; multi-divisi): Kelola project, summary di tiap workspace
5. **Account & Service** (existing, ditata ulang): Merchant Board, E-com, Ads, KOL, LiveStream, dll

Divisi baru di enum `division`: `CreatorManagement` dan `Acquisition` (BizDev sudah ada sejak Fase 0). Struktur tim memungkinkan workflow khusus: CM handle kreator internal, BizDev kelola deal/merchant, Akuisisi cari kreator baru + closing binding.

---

## 2. Keputusan Interview Final (jangan re-litigasi)

### Master Kreator MCN terpisah
- Tabel `mcn_creators` BARU (bukan ubah existing M9 `creators` KOL).
- KOL M9 tidak tersentuh — ekosistem KOL booking tetap independen.
- MCN kreator: platform TikTok saja (kolom tetap untuk future-proof, default `'tiktok'`).
- Unik per `(platform, lower(name))` — pisah per platform bila expand.

### Special Project (fitur baru)
- **Assignment penuh**: kebutuhan 100 kreator = 50 internal (CM assign dari roster) + 50 baru (Akuisisi cari/assign). 
- Merchant peserta dipilih dari master M4 existing.
- Registrar: Lead/OD/Director (divisi apa saja) — tidak perlu khusus divisi.
- GMV aktual = Σ affiliate_gmv kreator ter-assign dalam rentang tanggal project (dari tabel `creator_period_summary` hasil ingest).

### Deal ↔ Merchant (link opsional)
- `brand_deals.merchant_id` nullable — brand lokal pakai M4, brand luar (chain) cukup nama + shop_id.
- Shop_id unik per brand (partial unique index, nullable tersebut).
- Sinkron otomatis: trigger `brand_deals` → upsert `cooperating_shops` set deal_end = exp_date, active_flag = exp_date >= today.

### BizDev Leads
- Pakai modul M1 existing (`leads`) — **tidak** ada tabel `bd_leads` baru.
- Lead shop dari CM ke BizDev masuk sebagai lead M1 dengan source baru (`lead_source = 'MCN Shop Lead'`).

### Verifikasi Jadwal Live
- Tim CM (staff & lead) + management (no Creator Support role).
- Slot `status='done'` terkunci: server tolak edit/delete; field actual_start/end + verified_by/at wajib terisi.

### Divisi & Role
- Divisi baru: `CreatorManagement`, `Acquisition` (BizDev sudah ada).
- Role Lead/Staff mengikuti pola existing — tidak ada role khusus.

---

## 3. Aturan Bisnis Kunci per Modul

### Upload Data Mingguan (Ingest)
- **Window W1–W5 LOCKED**: W1=1–7, W2=8–14, W3=15–21, W4=22–28, W5=29–akhir (exact match). Tolak lintas bulan.
- **Drop-raw**: baris mentah tidak masuk DB — hanya 3 agregat (`creator_period_summary`, `creator_subcat_segment_gmv`, `creator_top_products`).
- **Parser toleran**: skip baris "Summary" + header, normalisasi alias ID/EN, skip baris tanpa product_id/shop_id (catat alasan), **items_sold=0 TIDAK di-skip** (GMV tetap dihitung, avg_price null).
- **Agregasi**: CTR/CTOR = rata-rata tertimbang GMV, live_pct guard div-0 → null (null ≠ 0).
- **Auto-fill master** (post-ingest): GMV rata-rata **bulanan** lintas histori (dedupe per period_start createdAt terbaru; kanonik 1/8/15/22/29 menang); niche = ranking kategori; jenis_creator dari rasio live:video. Hanya field berubah yang di-update.
- **Batch idempoten**: `batch_id = "ingest:<periodStart>:<hash8>"` — replace scoped per (creator × minggu), bukan wipe seluruh batch.
- **Guard overlap**: batch periode beda tapi tanggal overlap → tolak.

### CM Workspace
- **Scope CPM**: staff CM hanya kreator `owner_cpm_id = dirinya` (enforce RLS + server).
- **Growth W1–W5**: null (bukan 0) jika minggu tanpa data; delta vs minggu terisi sebelumnya; monthGrowth = (minggu terakhir − pertama)/pertama.
- **Alert perf_drop**: GMV turun > config 0.15 periode-ke-periode → insert `platform_alerts` ke CPM owner; pulih → auto-resolve (no manual action).
- **Request kreator** (sample/ads/hsl): sample = auto-approve; ads > ads_budget_cap → butuh approval Director.
- **commission_share**: read-only (sync platform via ingest, no form edit).

### Jadwal Live
- **Multi-slot per hari**: tanpa unique(creator, date) — 1 kreator bisa 3 slot senin.
- Status workflow: scheduled ↔ tentative, scheduled → off, tentative → off, off → scheduled, scheduled/tentative → done (done = terkunci).
- **Done terkunci**: BEFORE UPDATE/DELETE trigger tolak edit/delete; to-done wajib actual_start/end + verified_by terisi.
- **Copy week**: offset hari sama, reset status/pk_ready/tap/verifikasi, skip OFF, tolak jika target terisi.
- **Indikator**: PK✘, TAP✘, ring "butuh verifikasi" (pending & tanggal < hari ini), warning "besok no jadwal" (hanya OFF-only).

### Merchant Deals
- **Registrasi tervalidasi**: brand_name persis display platform, shop_id numeric + UNIK (tolak sebut deal existing), exp_date date-picker, komisi 0–100 + max ≥ min.
- **shop_id unik**: partial unique index `(shop_id) WHERE shop_id IS NOT NULL`.
- **Import legacy**: jangan crash — probe header, alias termasuk typo (`nama_campiagn`), field kotor → null + review_flags; expired → active_flag=false; laporan inserted + {row,reason}.
- **Registrasi + Import**: dalam 1 halaman ber-tab.

### BizDev Workspace
- **Tracker requests** lintas CM, **pipeline deals** per stage (manual, ter-audit, tampil shop_name+shop_id).
- **Routing campaign** (state machine murni): route (owner_cpm auto dari mcn_creators) → CM confirm → [brand acc jika perlu] → final fix/batal → handover. Transisi ilegal ditolak server.

### Acquisition
- **snapshot commission_share_at_binding**: GMV 30d pre-binding (baseline log-only); quarter_end = akhir kuartal kalender binding_date.
- **recordReferral**: antar_creator wajib referrer; platform tanpa referrer (check constraint enforce).
- **markHandoffDone**: blok sampai creator punya owner_cpm_id (pesan arahkan CM Lead); sukses → status aktif.
- **refreshGmvPostJoin**: window dari config, Σ affiliate_gmv per period_start dalam [binding, binding+window) dan [binding, quarter_end].

### Special Project
- **Derived summary** (view): creators_assigned vs needed (split per filled_by = cm|acquisition), GMV aktual Σ affiliate_gmv kreator ter-assign dalam [start_date, end_date].
- **Summary card** aktif muncul read-only di workspace CM, BD, Akuisisi; `/projects` untuk kelola (create, set status, tambah/hapus merchant, assign kreator).
- **Status workflow**: draft → active, active → done/cancelled, draft → cancelled (role: lead+).

---

## 4. Konvensi Teknis MSDPS yang Dipakai

### ID & Code
- `id uuid PK default gen_random_uuid()` — semua tabel baru pakai UUID.
- `code text unique` (bukan bigserial) — ID issuance via trigger SECURITY DEFINER.
  - `next_code('PFX')` → PFX-YYYYMM-NNNN
  - `next_code_global('PFX')` → PFX-NNNN (global sequence, misal MCR-1234)
- **Code immutable** — trigger validate BEFORE INSERT/UPDATE; error `[ID tidak dapat diubah]`.
- Trigger revoke execute dari public/anon/authenticated.

### State Machine & Lifecycle
- Kolom `status_changed_by uuid, status_changed_at timestamptz` di setiap tabel lifecycle.
- Trigger `enforce_status_transition('<entity>')` BEFORE UPDATE — validasi transisi berdasarkan baris di tabel `status_transitions`.
- Seed `status_transitions (entity, from_status, to_status, allowed_tokens)` — allowed_tokens null = semua role, otherwise cek actor token.

### Audit & RLS
- Trigger `capture_audit('<entity>')` AFTER INSERT/UPDATE — immutable audit_log.
- RLS helper: `is_od()`, `is_director()`, `is_lead()`, `auth_division()`, `auth_emp_id()`, `actor_tokens()`.
- RLS pattern: `select` dengan `WHERE is_od() OR is_director() OR auth_division() IN (...)`, `insert/update` dengan permission check.

### Server Action
- Pattern: `"use server"`, type `ActionResult = { ok: boolean; message: string }`, signature `(_prev, formData)`.
- Helper `ctx()` — auth context + row employees (avoid N queries per request).
- **Tidak pernah throw** — catch error, return `{ok:false, message}`.
- Dup key error: cek `error.code === "23505"`, kembalikan pesan user-friendly.
- Sukses → `revalidatePath()` + return `{ok:true, ...}`.

### Forms & UI
- `"use client"` components dengan `useActionState`.
- **Satu `<form>` per aksi** dengan hidden `<input>` (React 19: nilai submit button tidak terkirim di FormData).
- Jika belum ada komponen tab → buat sederhana via `useState` + conditional render (no external lib).

### File & Format
- Bulk import: **paste textarea** + split manual (tanpa lib parser, package.json belum ada).
- CSV: split manual (quote-aware); XLSX: pakai `xlsx` (SheetJS) server-side saja, jangan bundel client.
- Crypto: `node:crypto` untuk hash (hash8 = first 8 char sha256 hex).

### Date Math
- String wall-clock `YYYY-MM-DD`, **tanpa timezone/Date object** — semua date logic pakai string & integer.
- Helper `lib/mcn/weeks.ts` → `w1w5WindowsOf()`, `validateW1W5Period()`, `weekIndexOfDate()`, `buildMonthlyGrowth()`, `buildMonthlyAverages()`.

### lib/format.ts
- Siap pakai: `rupiah()`, `num()`, `tanggal()`.

---

## 5. Ringkasan Migrasi & Artifact

| Migrasi | Konten |
|---------|--------|
| **0300** | Enum baru: `CreatorManagement`, `Acquisition` di `division`; `MCN Shop Lead` di `lead_source` |
| **0301** | Foundation: `app_config`, `platform_alerts` |
| **0302** | `mcn_creators` — master kreator TikTok, platform unik |
| **0303** | Ingest: `upload_batches`, `creator_period_summary`, `creator_subcat_segment_gmv`, `creator_top_products` |
| **0304** | `live_schedule_slots` — jadwal harian (multi-slot, status workflow, lock done) |
| **0305** | `brand_deals`, `deal_products`, `cooperating_shops` (FK live_schedule_slots.deal_id) |
| **0306** | `creator_requests`, `campaign_requests` — routing state machine |
| **0307** | `acquisitions`, `referrals` — binding snapshot & referral tracking |
| **0308** | `special_projects`, `special_project_merchants`, `special_project_creators`, `v_project_summary` |

Semua tabel dilengkapi: ID trigger + state_transitions + RLS + audit.

---

## 6. Pure Lib (testable, tanpa DB)

- `lib/mcn/parsers.ts` — `parseRupiah`, `parseCommission`, `parseFlexibleDate`, `parsePercent`, `parseIntTolerant` (null bila tak yakin).
- `lib/mcn/weeks.ts` — W1–W5 validation & growth building.
- `lib/mcn/ingest.ts` — file parse + aggregate.
- `lib/mcn/routing.ts` — pure campaign routing state machine.
- `lib/mcn/copy-week.ts` — slot copying logic.
- `lib/mcn/indicators.ts` — slot indicator helpers.
- `lib/mcn/file-read.ts` — CSV/XLSX read + hash.

---

## 7. Fase E — Status Implementasi

**DB + Pure Lib + Server Actions + UI + Nav**: Selesai.

Migrasi 0300–0308 applied ke live 2026-07-15. Smoke test SQL 6/6 PASS: creator auto-ID, state machine, slot locking, shop_id unique, referral constraint, project_summary accuracy. Harness rollback verified—DB live bersih. Actions 9 file (`mcn-creators.ts`, `mcn-ingest.ts`, `mcn-schedule.ts`, `deals.ts`, `bizdev.ts`, `acquisition.ts`, `projects.ts`, `mcn-requests.ts`, `config.ts`) + Routes 7 (`/mcn/creators`, `/mcn/workspace`, `/mcn/schedule`, `/deals`, `/bizdev`, `/acquisition`, `/projects`) + Nav per team (server component, role-gated): ter-commit, build clean, `npx tsc --noEmit` bersih, QC pure lib 37/37.

Pending: preview/manual test UI end-to-end.
