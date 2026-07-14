# MSDPS — Handoff / Continuation Prompt

Paste this into a new chat to continue the build with full context.

---

## Apa yang sedang dibangun
**MSDPS (Merchant Service Delivery & Performance System)** — aplikasi web internal untuk tim
**MEAGO!** (PT MEA Agensi Digital). Backend **Supabase** (Postgres + Auth + RLS + Storage),
frontend **Next.js App Router** (nanti di Vercel). Fase 1 = internal only (AM, staff per divisi,
SPV/Lead, OD, Director). **Merchant Portal eksternal = Fase 2, JANGAN dibangun dulu.**

Sumber kebenaran PRD (LOCKED, 15 modul + Phase 0): jangan ubah/sederhanakan logika tanpa izin.

## Lokasi file (PENTING: folder induk ada spasi di akhir: `Claude Code `)
- PRD: `/Users/apple/Documents/Claude Code /MSDPS_FULL_PRD.md`
- Step 1 Blueprint: `/Users/apple/Documents/Claude Code /MSDPS_STEP1_Architecture_Blueprint.md`
- Step 2 Roadmap: `/Users/apple/Documents/Claude Code /MSDPS_STEP2_Phased_Build_Roadmap.md`
- Project app: `/Users/apple/Documents/Claude Code /msdps/`
- Tracker progres: `/Users/apple/Documents/Claude Code /msdps/docs/BUILD_PLAN.md`

## Supabase (LIVE)
- Project ID: **`mvcckptntrvzujqaoxxh`** (URL `https://mvcckptntrvzujqaoxxh.supabase.co`)
- Terhubung via **Supabase MCP** (`.mcp.json` di project, pakai env `SUPABASE_ACCESS_TOKEN`).
  Tools: `apply_migration`, `execute_sql`, `list_tables`, `get_advisors`, dll.
- `.env.local` (gitignored) berisi URL + anon key + **service_role key** (sudah diisi).
- Migrasi diterapkan langsung ke DB via MCP; file SQL lokal di `msdps/supabase/migrations/`.

## Keputusan yang SUDAH dikunci (jangan dilitigasi ulang)
- Enforcement di **Postgres** (bukan app): state machine via trigger `enforce_status_transition`
  + tabel `status_transitions`; ID `PREFIX-YYYYMM-NNNN` via `next_code()` (CRT pakai
  `next_code_global`); derived read-only via generated col / trigger / view / pg_cron; audit
  `audit_log` append-only immutable untuk semua (termasuk Director & service_role).
- Role model: `employees(division, rank[staff|lead], is_od, is_director)`; helper RLS
  `auth_division()/is_lead()/is_od()/is_director()/actor_tokens()`.
- **OKR**: `okr_targets` per-role per-quarter, owner OD+Director, auto-achievement (view di M14).
- **SLA KOL = 5 hari kerja**. **Login = email/password, invite admin** (no public signup).
- GMV otoritatif (M13) = entry manual + confidence tag. LSR (M10) = upload template + manual fallback.
- Working calendar OTA-5 dibuat; phone dedup E.164 (+62); `CRT-NNNN` tanpa bulan.

## Konvensi engineering (WAJIB diikuti tiap modul)
1. Tiap tabel lifecycle punya kolom `status` (enum), `status_changed_by uuid`, `status_changed_at timestamptz`.
2. Trigger ID/validasi = **SECURITY DEFINER** (karena `next_code` di-revoke dari anon/authenticated).
3. Pasang: validasi/ID (BEFORE INSERT/UPDATE) + `enforce_status_transition('<entity>')` (BEFORE UPDATE)
   + `capture_audit('<entity>')` (AFTER INSERT/UPDATE) + baris `status_transitions`.
4. FK lintas-modul ditambah di migrasi tabel tujuannya (hindari error urutan).
5. Fungsi trigger/util: revoke execute dari public/anon/authenticated. RPC yang dipanggil app
   (mis. `close_deal`, `verify_payment`): grant ke authenticated saja (revoke anon).
6. `status_transitions` bertipe text → di trigger bandingkan `old.status::text` (bugfix penting).
7. View pakai `security_invoker=true` bila bisa.

## Roadmap fase (Step 2)
A Foundation → B Lead-to-Cash (M1-5) → C Account&4 divisi (M6-10) → D Coordination (M11-12) →
E Reporting (M13-14) → F Portal internal (M15). **Satu fase per satu; konfirmasi user sebelum lanjut.**

## STATUS SAAT INI
### ✅ Fase A (Foundation) — SELESAI, LIVE, teruji
- Migrasi DB `0001–0010` (phase0_*): employees, id_sequences, status_transitions, audit_log,
  working_calendar, okr_targets, helper RLS, hardening. Semua engine teruji (ID, state machine,
  audit immutable, kalender).
- App shell Next.js **build sukses**: `/login`, `/dashboard`, `/(app)/employees` (Kelola Karyawan),
  `middleware.ts`, `lib/supabase/{server,client,admin}.ts`, server actions `employees.ts`/`auth.ts`.
- **19 karyawan di-seed** (semua divisi + Leads + OD Rara + Director Yohan). Password default
  `Msdps#2026`. Login diuji (HTTP 200).
  - Director: `yohanagustian@meagency.co.id` · Staff contoh: `sepri@meago.test` (Ecommerce).
- User perlu jalankan sendiri untuk lihat UI: `cd msdps && npm run dev` → http://localhost:3000.

### ✅ Fase B (Lead-to-Cash) — DB backbone SELESAI & teruji (UI belum)
- Migrasi DB (faseB_*): `0100_module3_campaigns`, `0101_module1_leads`, `0102_module4_merchant`,
  `0103_module5_finance`, `0104_module2_marketing`, `0105_faseB_hardening` (+ fix enum cast, +
  normalize_phone searchpath).
- Tabel baru: campaigns, leads, prospect_attempts, merchants, merchant_platforms, services,
  service_catalog (5 tipe terisi), package_catalog, transactions, installments, creator_payouts,
  marketing_performance_records, view `v_marketing_metrics`.
- RPC: `close_deal(...)` (closing → MER+SVC+TRX, cascade win-resolution), `verify_payment(...)`
  (routing gate, over-verify block).
- Uji lolos (rolled back): Ajeng vs Galih competitive claim; ROAS 4.38 (Dashboard 46/Real 12);
  Finance partial→release, over-verify blocked, lunas→outstanding 0.
- **Catatan:** `creator_payouts` (PYO-Video/PYO-Live) tabel siap, tapi trigger pemicu milestone
  (10 video / 5 jam) diuji di **Fase C** (butuh `creator_bookings` M9).

## LANGKAH BERIKUTNYA (mulai di chat baru dari sini)
**Fase B UI** — layar Next.js + server actions untuk M1–M5:
- `/campaigns` (CRUD + lifecycle + dashboard ROAS dari `v_marketing_metrics`)
- `/leads` (import CSV, registrasi, self-claim pool, competitive board, dedup message)
- `/merchants` (detail + closing form memanggil `close_deal`)
- `/finance` (antrian verifikasi memanggil `verify_payment` + reminder)
Pakai pola app shell Fase A (server actions, RLS via session). Setelah UI: minta user cek, lalu
lanjut Fase C.

## Cara kerja user (penting)
- Non-teknis di implementasi, tapi paham produk & business logic mendalam. Jelaskan keputusan
  teknis dalam bahasa yang bisa divalidasi ke PRD.
- Bahasa Indonesia. Label status/field user-facing pakai `[Bahasa Indonesia]` sesuai PRD.
- Shell user = **zsh** (bukan bash): `read -s "VAR?prompt"`, bukan `read -s -p`.
- Konfirmasi dulu sebelum pindah fase.
