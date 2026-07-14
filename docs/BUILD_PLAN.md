# MSDPS Build Plan & Progress Tracker

Cross-turn tracker so we never lose the thread. Source of truth: `MSDPS_FULL_PRD.md`.
Architecture: `MSDPS_STEP1_Architecture_Blueprint.md` (approved).

## Conventions for every module migration
Each module migration delivers, in order:
1. **Tables** (cols, types, FKs, defaults) + `status_changed_by/at` on lifecycle tables.
2. **ID** issuance trigger (validate mandatory → `next_code()` → set `code`, immutable).
3. **status_transitions** rows + attach `enforce_status_transition('<entity>')`.
4. **Derived fields** (generated col / trigger / view / pg_cron — per blueprint §4).
5. **RLS** policies (blueprint §5).
6. **Audit** trigger `capture_audit('<entity>')`.

## Progress

| Phase / Module | Entities | Status |
|---|---|---|
| **Phase 0 / Fase A — Foundation** | employees, id_sequences, status_transitions, audit_log, working_calendar, okr_targets + RLS helpers + Next.js shell (login, dashboard, Kelola Karyawan) + seed | ✅ **DONE & VERIFIED** on live `mvcckptntrvzujqaoxxh` (migr. 0001–0010). 19 staff seeded, auth login tested green, app builds clean. ⏳ only pending: user opens `npm run dev` for visual/role-gate check. |
| M3 — Campaign | `campaigns` | ✅ DB applied+tested (lifecycle) |
| M1 — Leads Database | `leads`, `prospect_attempts` | ✅ DB applied+tested (dedup, competitive claim Ajeng vs Galih, atomic win-resolution) |
| M2 — Marketing | `marketing_performance_records` + `v_marketing_metrics` | ✅ DB applied+tested (ROAS 4.38, CPL/CPRL/Quality) |
| M4 — Merchant Record | `merchants`, `merchant_platforms`, `services`, `service_catalog`, `package_catalog` | ✅ DB applied |
| M5 — Finance | `transactions`, `installments`, `creator_payouts` + `close_deal()` + `verify_payment()` | ✅ DB applied+tested (closing, routing gate, over-verify block). PYO milestone gating → Fase C. |
| **Fase B — UI** | Next.js screens + server actions for M1–M5 | ✅ **BUILD CLEAN**. Routes `/campaigns` (CRUD+lifecycle+ROAS dashboard dari v_marketing_metrics), `/leads` (register + import CSV + self-claim pool + papan kompetisi + dedup message), `/merchants` (detail services/trx + closing form → close_deal), `/finance` (antrian verifikasi → verify_payment + flag jatuh-tempo/bermasalah). Nav role-gated di (app)/layout. lib/format.ts helper. ⏳ pending: user cek visual via `npm run dev`. |
| M6 — Account & Service | `strategies`, `briefs`, `complaints` | ✅ DB applied+tested (migr. 0200: assign_am, strategy approve/revisi, brief per divisi, komplain 2 pintu, execution_status state machine kedua di services, close_deal +p_package_id). |
| M7 — E-commerce | `sku_work_units`, `ecom_time_logs` | ✅ DB applied+tested (migr. 0201: review 2-layer Lead→AM, timer 1-aktif/staff, completion% derived, cancel kurangi target). |
| M8 — Ads | `ad_campaign_records`, `weekly_performance_entries` | ✅ DB applied+tested (migr. 0202: go-live approval Lead-only, budget per-currency IDR/USD, ROAS/CTR generated, Final Report gate sebelum Completed). |
| M9 — KOL | `creators`, `creator_bookings` | ✅ DB applied+tested (migr. 0203: tanpa revision cycle, create_creator_payout PYO-Video/10 video & PYO-Live/5 jam lintas merchant → creator_payouts M5). |
| M10 — Live Stream | `live_stream_results`, `merchant_gmv_authoritative` | ✅ DB applied+tested (migr. 0204: entry_status derived, v_ls_achievement, GMV otoritatif + confidence tag). |
| **Fase C — UI** | Next.js screens + server actions for M6–M10 | ✅ **BUILD CLEAN + PREVIEW VERIFIED**. Routes `/account` (intake→assign AM, strategy, brief per divisi, komplain), `/ecommerce` (queue, work unit, checklist, timer, review 2-layer), `/ads` (ADC + go-live gate + WPE/Final Report), `/kol` (creator master, bookings, GMV, Payment Request milestone), `/livestream` (forward vendor, upload Template Baku, manual, resolve unmatched, achievement, GMV otoritatif), `/finance` +antrian disbursement PYO. Nav role-gated di (app)/layout. `npx tsc --noEmit` bersih; preview MCP: input manual LSR W2 → [Lengkap], achievement recompute 41%. |
| M12 — Task/SLA | `block_requests`, `v_speed_score` | ✅ DB applied+tested (migr. 0206 + 0206b hotfix: block-request formal per Brief, approve≥lead→Brief [Blocked], auto-timer Fase C.2 = blocked-time exclusion inheren, resume stempel `blocked_to`; `v_speed_score` hari-kerja E-com 3hk/20SKU pro-rata·Ads 6hk go-live·KOL 5hk·LS start 3hk; staff tak bisa [Blocked] langsung). |
| M11 — Merchant Board | `v_merchant_board` (view) | ✅ DB applied+tested (migr. 0207: 1 baris/Brief, kolom kanonik 6-state prioritas Blocked>In Review>In Execution>Planning>Intake>Completed, agregat unit per divisi, flag overdue/revisi≥3/blocked/pending-block, role-gate di WHERE). |
| M13 — Merchant Health | `merchant_health_snapshots`, `merchant_health_monthly` (pg_cron) | ✅ DB applied+tested (migr. 0208: MHR-/MHRM- immutable, GMV 40% anti-double-count dari `merchant_gmv_authoritative` (fallback channel tertinggi [GMV Estimasi])·Completion 30%·SLA 30%·penalti komplain −5/−15/−30·sinyal revisi E-com/Ads; band 75/50; cron mingguan `msdps_health_weekly` Min 17:30 UTC + bulanan `msdps_health_monthly`; RPC manual OD/Director. `v_speed_score` di-split jadi `v_speed_score_internal` (definer, utk cron) + view publik ber-gate). |
| M14 — Team Performance | `performance_scores`, `v_okr_attainment` (pg_cron) | ✅ DB applied+tested (migr. 0209: PERF- per staff/minggu, Output 40/Speed 30/Quality 30 ternormalisasi vs target role, komponen per role E-com/Ads/KOL(GMV-generating, bukan revisi)/AM(health portfolio+pickup review+komplain), bobot renorm atas komponen tersedia, staff tanpa aktivitas tak diberi baris; seed OKR 2026-Q3; `v_okr_attainment` kuartal-berjalan; cron `msdps_perf_weekly` Min 17:45 UTC). |
| M15 — Portals (internal) | `v_team_portal_*`, `v_management_dashboard` | ✅ DB applied+tested (migr. 0210, Fase 1 internal: `v_team_portal_tasks`/`_performance`/`_blocks` + `v_management_dashboard` (Director/OD, semua merchant, `band_rank` sort At Risk dulu). Merchant Portal = Fase 2, TIDAK dibangun; CSAT di luar scope). |
| **Fase D — UI** | Next.js `/board` `/portal` `/management` + block-request | ✅ **BUILD CLEAN + PREVIEW VERIFIED**. `/portal` (Team Portal: Tugas Saya + Skor Performa + Speed Score + Block Request + antrian approve SPV), `/board` (Kanban 6 kolom per merchant), `/management` (Director/OD: kesehatan merchant, ringkasan bulanan, OKR attainment, ranking performa + tombol "Hitung snapshot minggu ini"). `lib/actions/blocks.ts` (ajukan/putuskan/resume block + generate manual). Nav role-gated. `npx tsc --noEmit` bersih. Preview MCP: siklus block penuh via UI (ajukan BLK-0003→approve→Brief [Blocked]+timer stop→resume→blocked_to closed), Management Dashboard render lengkap, role-gate (Sepri redirect dari /management), console bersih. |
| **Target OKR — UI** | `/okr` (Director/OD set target per section) | ✅ **BUILD CLEAN + PREVIEW VERIFIED**. Target OKR TIDAK lagi hardcode — Director menetapkan per section (E-com/Ads/KOL/AM) per kuartal via `/okr`. Pure app code (tanpa DDL baru): tulis ke `okr_targets` lewat sesi authed (RLS `okr_manage`), pola supersede (nonaktifkan aktif lama → insert baru, histori tersimpan; unique index parsial). `lib/okr-metrics.ts` (katalog 6 metrik computable + default fallback + helper kuartal), `lib/actions/okr.ts` (`setOkrTarget`/`clearOkrTarget`), `app/(app)/okr/` (page+forms), switcher periode ±kuartal. Nav "Target OKR" mgmt-only + link dari card OKR di /management. `npx tsc --noEmit` bersih. Preview MCP (Yohan): ubah SKU E-com 20→25 → tersimpan, effective ↑, attainment /management ikut 25%→20% (engine baca live), supersede terverifikasi di DB (row 20 active=false, 25 active=true), "no change" guard, restore ke 20. Role-gate: Sepri redirect /okr→/dashboard, nav "Target OKR" absen. Console bersih. |

## UI conventions (Fase B, learned)
- **JANGAN andalkan `name`/`value` tombol submit** untuk mengirim data ke Server Action (React 19/Next 15): nilai submitter TIDAK ikut ke FormData → action menerima field kosong. Untuk tombol transisi status, buat **satu `<form>` per aksi dengan hidden `<input name=... value=...>`**. (Bug ini sempat bikin advance prospek & lifecycle kampanye "ditolak: Data transisi tidak lengkap".) Diverifikasi via preview MCP: Ajeng advance Pending→…→Negotiation OK.
- **View agregasi lintas-RLS (`v_marketing_metrics`)** dibuat `security_invoker=true`, jadi saat dibaca sesi **Marketing** (yang tak punya akses RLS ke prospect_attempts/merchants/transactions) hasilnya 0 (ROAS/Revenue/Lead Real). Fix: campaigns/page.tsx membaca view via **klien service-role (`createAdminClient`, server-only)**, digerbang `is_od||is_director||division='Marketing'` (mirror RLS mpr). Diverifikasi: ROAS 29.97× muncul utk Bima. Alternatif DB-level (view SECURITY DEFINER + WHERE role-gate) bisa dipasang nanti bila akses DDL tersedia.
- **JANGAN `npm run build` saat `npm run dev` menyala** — build menimpa `.next` yang dipakai server dev → aset korup (CSS hilang/tampilan polos, JS klien mati/login gagal). Untuk typecheck pakai `npx tsc --noEmit`.
- **Campaign auto-activate**: create form punya checkbox "Langsung aktifkan" (default ON). Action insert [Draft] → update [Active] (via state machine, teraudit). Verified: CMP baru langsung [Active].
- **Merchant kategori = dropdown MEAGO** (hospitality/lifestyle: Dining, Accommodation, Café & Bakery, Bar & Nightlife, Spa & Wellness, Attraction & Leisure, Retail, Lainnya) — BUKAN taksonomi e-commerce agency (beauty/fashion). Kolom DB tetap `text`; daftar di merchants/forms.tsx `KATEGORI`. **PENDING: konfirmasi daftar final ke Yohan.**

## Engineering conventions (enforced from Fase A)
- **Entity ID triggers MUST be `SECURITY DEFINER`** — `next_code()`/`next_code_global()` are revoked from anon/authenticated, so only owner-context (definer) triggers can mint IDs.
- Every lifecycle table carries `status_changed_by uuid`, `status_changed_at timestamptz` (stamped by `enforce_status_transition`).
- Attach order per table: ID/validation trigger (BEFORE INSERT/UPDATE) + `enforce_status_transition('<entity>')` (BEFORE UPDATE) + `capture_audit('<entity>')` (AFTER INSERT/UPDATE).
- Cross-module FKs added in the migration that creates the *referenced* table (avoids ordering failures).

## Locked decisions (do not re-litigate)
- State machines + ID + derived read-only enforced in **Postgres** (triggers/generated cols/cron).
- Audit log immutable for everyone incl. Director & service_role (trigger).
- OKR: per-role, quarterly, auto-achievement, owned by OD+Director.
- KOL booking SLA = **5 working days**. Login = email/password admin-invite.
- GMV authoritative = manual entry + confidence tag (API later).
- Merchant Portal = Fase 2 (NOT built now).
