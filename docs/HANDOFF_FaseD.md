# MSDPS — Handoff Fase D (M11–M15 SELESAI + TERVERIFIKASI)

## Ringkasan status (untuk chat berikutnya)
Fase D (Modul 11–15: Merchant Board, Task/SLA, Merchant Health, Team Performance, Portal internal)
**selesai dibangun, diuji SQL, dan diverifikasi via UI preview end-to-end** (login akun riil +
klik tombol asli). MSDPS kini **lengkap M0–M15**. Tidak ada pekerjaan kode menggantung dari sesi ini.

Yang tersisa murni menunggu keputusan/brief Yohan:
1. **AI Auto-Reporting** — masih DITUNDA menunggu brief detail (lihat HANDOFF_FaseC2.md bagian DITUNDA; status tak berubah).
2. **Merchant Portal (Fase 2 M15)** + complaint door #3 — sengaja tidak dibangun (M15-OA-2). Bangun bila Yohan minta.
3. **CSAT** — di luar scope sistem (M15-OA-3).

## Konteks singkat
Lanjutan MSDPS (internal MEAGO!/PT MEA Agensi Digital). Backend Supabase live (project
`mvcckptntrvzujqaoxxh`), frontend Next.js App Router (React 19, Next 15.5). Fase A+B (M1–M5),
Fase C (M6–M10), Fase C.2 (auto-timer + single-layer review) sudah selesai & teruji. Bahasa:
Indonesia. User = Yohan (Director, div Account; konfirmasi sebelum pindah fase besar).

Lokasi (folder induk ADA SPASI di akhir: `Claude Code `):
- App: `/Users/apple/Documents/Claude Code /msdps/`
- PRD: `/Users/apple/Documents/Claude Code /MSDPS_FULL_PRD.md`
- Tracker: `.../msdps/docs/BUILD_PLAN.md` (sudah di-update M11–M15 ✅ + Fase D UI)
- Supabase MCP: project id `mvcckptntrvzujqaoxxh`. Pola uji sebagai user riil:
  `select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}', true); set local role authenticated; <query>`.

## ✅ SELESAI & TERUJI sesi ini — Fase D (M11–M15)

### Migrasi (semua file lokal ADA + sudah apply_migration ke live)
- **`0206_module12_sla_speed.sql`** — M12. `working_days_between()`, entity `block_requests`
  (BLK-, enum `blk_status`), trigger `blk_validate`/`blk_apply_block` (approve→Brief [Blocked]),
  `briefs_close_block` (resume→stempel `blocked_to`), view `v_speed_score`. Transisi Brief→[Blocked]
  dinaikkan jadi minimal `lead` (staff wajib lewat block-request).
- **`0206b_module12_fix_block_resume.sql`** — hotfix: `blocked_to` sempat tak pernah tertutup karena
  proteksi kolom derived menimpa update internal; diperbaiki dengan flag transaksi-lokal
  `msdps.blk_internal` + data-repair BLK yang sudah resume.
- **`0207_module11_merchant_board.sql`** — M11. View `v_merchant_board` (1 baris/Brief, kolom kanonik
  6-state, agregat unit per divisi, flag). Role-gate ditanam di WHERE.
- **`0208_module13_merchant_health.sql`** — M13. Split `v_speed_score`→`v_speed_score_internal`
  (definer, utk cron) + view publik ber-gate. Tabel `merchant_health_snapshots` (MHR-) &
  `merchant_health_monthly` (MHRM-), immutable. `generate_health_snapshots(date)` &
  `generate_health_monthly(char)` (definer, manual OD/Director-only). Cron `msdps_health_weekly`
  (Min 17:30 UTC) & `msdps_health_monthly` (tgl 1, 18:00 UTC).
- **`0209_module14_team_performance.sql`** — M14. Tabel `performance_scores` (PERF-, immutable),
  `okr_target_value()`, `generate_performance_scores(date)` (definer, manual OD/Director-only),
  seed OKR 2026-Q3, view `v_okr_attainment` (dijanjikan sejak 0007). Cron `msdps_perf_weekly`
  (Min 17:45 UTC).
- **`0210_module15_portals.sql`** — M15 Fase 1. `v_merchant_board` +kolom `assigned_pic`.
  `v_team_portal_tasks`, `v_team_portal_performance` (invoker), `v_team_portal_blocks` (invoker),
  `v_management_dashboard` (Director/OD, `band_rank` sort At Risk dulu).

### Kode app Fase D (tsc bersih)
- `lib/actions/blocks.ts` — `ajukanBlock`/`putuskanBlock`/`resumeBrief` (M12) + `generateSkorMingguIni`
  (RPC health+perf minggu berjalan, gate di RPC).
- `app/(app)/board/page.tsx` — Kanban 6 kolom per merchant (switch merchant via query `?merchant=`).
- `app/(app)/portal/page.tsx` + `forms.tsx` — Team Portal (Tugas Saya, Skor Performa, Speed Score,
  Block Request, antrian approve SPV/Lead). Konvensi React 19: satu `<form>`/aksi + hidden input.
- `app/(app)/management/page.tsx` + `forms.tsx` — Management Dashboard + tombol "Hitung snapshot minggu ini".
- `app/(app)/layout.tsx` — nav +Team Portal, +Merchant Board, +Manajemen (mgmt-only).

### Verifikasi
- **SQL**: staff tak bisa [Blocked] langsung (ditolak trigger) ✅; block cycle BLK-0001/0002
  (submit→approve→Brief [Blocked], `work_time_seconds` naik, timer stop→resume, `blocked_to` closed) ✅;
  health snapshot minggu 0622 (netral 70) & 0629 (29 At Risk, GMV otoritatif 43jt, tren ↓ driver GMV) +
  monthly MHRM 202606 ✅; perf 5 staff (Erlina 93/Anty 75/Sembo 70/Sepri 54/Rizal 50) + OKR attainment ✅;
  gate manual generate ditolak utk Sepri ✅; role-gate view (Sepri hanya lihat Ecommerce) ✅.
- **UI preview MCP** (login riil):
  - Sepri (E-com staff): Team Portal render (skor 54, Speed On-Time), Merchant Board hanya kartu Ecommerce.
  - Yohan (Director): ajukan block BLK-0003 via UI → masuk Antrian Approval → **Approve via UI** →
    BRF-0006 [Blocked] + timer stop → **Resume via UI** → [In Progress] + timer jalan + `blocked_to` closed.
  - Management Dashboard render penuh (test ajeng At Risk 29, ringkasan bulanan, OKR, ranking tim);
    tombol "Hitung snapshot minggu ini" → "0 snapshot + 0 skor" (sudah ada, dilewati = immutability OK).
  - Role-gate: Sepri akses `/management` langsung → redirect `/dashboard`, nav "Manajemen" tak muncul.
  - Console bersih di seluruh sesi.

## Catatan teknis penting (untuk chat berikutnya)
1. **Timezone cron**: server pg_cron pakai UTC. WIB = UTC+7 → jadwal mingguan Minggu 17:30/17:45 UTC
   = Senin 00:30/00:45 WIB (menyusun minggu yang BARU selesai). Bulanan tgl 1 18:00 UTC.
2. **`v_speed_score` publik = proyeksi ber-gate dari `v_speed_score_internal`** (yang definer,
   TIDAK di-grant ke authenticated). Cron/fungsi definer WAJIB pakai versi internal (tanpa JWT →
   role-gate WHERE bikin kosong).
3. **Blocked-time exclusion inheren**: karena auto-timer Fase C.2 memang berhenti saat Brief [Blocked],
   `work_time_seconds` sudah bebas blocked-time tanpa perhitungan tambahan. `v_speed_score` mengurangi
   blocked hari-kerja hanya untuk unit non-timer (durasi kalender antar transisi dari `audit_log`).
4. **Seed OKR 2026-Q3** sudah masuk (6 target). OD/Director bisa supersede via `okr_targets` (set
   `active=false` baris lama, insert baru) — jangan edit histori.
5. **Data uji lama** (BRF-0006/0007/0008 In Progress sejak sebelum migrasi; BRF-0006 pic=Yohan) tetap
   ada. `merchant_gmv_authoritative` untuk test ajeng = 43jt periode 202607 `[GMV Estimasi]`.
6. **Snapshot immutable**: `merchant_health_snapshots`/`_monthly`/`performance_scores` di-lock trigger
   `audit_immutable()` (tak bisa UPDATE/DELETE siapa pun). Re-generate minggu yang sudah ada = dilewati.
7. **Security advisor (sudah ditinjau)**:
   - `0210b` hotfix mencabut EXECUTE anon/public dari 3 generator + `working_days_between` — sebelumnya
     `anon` (auth.uid() null) bisa bypass gate OD/Director. Sudah diperbaiki & dikonfirmasi
     (`has_function_privilege`: anon=false, authenticated=true; pg_cron=postgres superuser tetap jalan).
   - Advisor `security_definer_view` (ERROR) pada `v_speed_score`/`v_merchant_board`/`v_management_dashboard`/
     `v_okr_attainment`/`v_team_portal_tasks` = **SENGAJA & AMAN**. View ini WAJIB definer untuk baca
     lintas-RLS (`audit_log` OD/Director-only, `merchants` yang tak beri akses divisi eksekusi), dengan
     role-gate ditanam di WHERE (`is_od()/is_director()/auth_division()/auth.uid()` membaca JWT pemanggil,
     bukan owner — terbukti empiris). **JANGAN ubah jadi `security_invoker`** — akan memutus baca lintas-RLS.
     Pola sama dengan `v_marketing_metrics` (Fase B). View yang cukup pakai RLS tabel = invoker
     (`v_team_portal_performance`/`_blocks`).
   - `auth_leaked_password_protection` (WARN) = setting Auth Supabase (HaveIBeenPwned), keputusan Yohan
     bila mau diaktifkan; bukan isu kode.

## Akun uji (semua password `Msdps#2026`), UUID untuk SQL
- Director: yohanagustian@meagency.co.id (Yohan, `3287f4cf-3f28-4d2f-a2ad-d8d560a8c172`, div Account, is_director)
- AM: Anty `b35fea84-b182-4a00-8da8-b440d509c018`, Mey `b72b5cae-b24c-49c4-9bfc-0691bbb97369`
- E-com: Eka (lead) `b62bb7b0-49c1-4f22-bae1-f86ed16f5910`, Sepri `5b218bb4-f3df-4c69-9d64-782e94c11cef`
- Ads: Adit (lead) `2b7512da-d304-4a5f-bc5e-e93e858ccc7c`, Erlina `d81112b8-5078-4949-b351-35462e67bea8`
- KOL: Koko (lead) `cbb9a5d6-7123-4cd4-82d0-0f1f37692dce`, Rizal `51e2da28-9f1f-4f21-a1d2-b9d467010baf`, Sembo (staff)
- Merchant uji: MER-202607-0001 "test ajeng" (`0df2a634-3fb1-4e78-ab96-69851615f667`), AM = Anty.

## Konvensi WAJIB (dipatuhi Fase D)
- Trigger ID/validasi = SECURITY DEFINER, di-revoke dari anon/authenticated.
- Tiap tabel lifecycle: `status_changed_by/at` + `enforce_status_transition('<entity>')` +
  `capture_audit('<entity>')` + baris `status_transitions`. (block_request memakainya penuh.)
- Tabel derived-only (health/perf): tak ada policy tulis; baris hanya lahir dari fungsi definer.
- View agregasi lintas-RLS yang baca `audit_log`/lintas divisi → SECURITY DEFINER + role-gate di WHERE
  (pola v_speed_score/v_merchant_board/v_management_dashboard). View yang cukup pakai RLS tabelnya →
  `security_invoker=true` (v_team_portal_performance/_blocks).
- UI: satu `<form>`/aksi + hidden `<input name to_status value>` (React 19). Label status [Bahasa Indonesia].
- Verifikasi: `cd .../msdps && npx tsc --noEmit` (JANGAN `npm run build` saat dev jalan).

## Next (menunggu Yohan)
1. **AI Auto-Reporting** — begitu brief detail turun (lihat HANDOFF_FaseC2.md).
2. **Merchant Portal Fase 2** (M15) + complaint door #3 — bila diminta.
3. Kalibrasi opsional: ambang band health (75/50), bobot komponen, target OKR — semua di data
   (`okr_targets`) / konstanta fungsi, bisa disesuaikan tanpa ubah arsitektur.
