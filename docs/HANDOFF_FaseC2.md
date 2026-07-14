# MSDPS — Handoff Fase C.2 (SELESAI + TERVERIFIKASI; AI reporting DITUNDA menunggu brief Yohan)

## Ringkasan status (untuk chat berikutnya)
Fase C.2 (auto-timer + single-layer review) sudah **selesai dibangun, diuji SQL, dan diverifikasi via UI preview end-to-end** (login asli tiap peran + klik tombol asli, bukan cuma SQL). Tidak ada pekerjaan kode yang menggantung dari sesi ini. Yang tersisa murni menunggu keputusan/brief dari Yohan:
1. Brief detail AI Auto-Reporting (lihat bagian DITUNDA).
2. Konfirmasi mulai Fase D (M11–M15) atau tidak.
Jangan mulai keduanya tanpa instruksi eksplisit Yohan di chat berikutnya.

## Konteks singkat
Lanjutan MSDPS (internal MEAGO!/PT MEA Agensi Digital). Backend Supabase live (project `mvcckptntrvzujqaoxxh`), frontend Next.js App Router (React 19, Next 15.5). Fase A+B (M1–M5) & Fase C (M6–M10) sudah selesai & teruji. Bahasa: Indonesia. User = Yohan (non-teknis di implementasi, paham produk mendalam; konfirmasi sebelum pindah fase).

Lokasi (folder induk ADA SPASI di akhir: `Claude Code `):
- App: `/Users/apple/Documents/Claude Code /msdps/`
- PRD: `/Users/apple/Documents/Claude Code /MSDPS_FULL_PRD.md`
- Tracker: `.../msdps/docs/BUILD_PLAN.md` (sudah di-update M6–M10 ✅ + Fase C UI)
- Supabase MCP: tool `mcp__9d1d3d39-...__apply_migration` / `execute_sql`, project id `mvcckptntrvzujqaoxxh`. Pola uji sebagai user riil: `select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}', true); set local role authenticated; <query>`.

## ✅ SELESAI & TERUJI sesi ini — Fase C.2 (perubahan alur kerja dari Yohan)
Migrasi **`0205_faseC2_auto_timer_single_review.sql`** (file lokal ADA + sudah apply_migration ke live). Isi:
1. **Timer OTOMATIS per Brief, semua divisi** — timer manual dihapus. Kolom baru di `briefs`: `work_time_seconds bigint`, `timer_started_at timestamptz`. Trigger `briefs_track_time()` (BEFORE UPDATE): mulai saat status masuk `[In Progress]`/`[Overdue]`, berhenti (akumulasi) saat keluar (submit/complete/blocked). Revisi → timer lanjut. Kolom derived (di-reset ke OLD tiap update; hanya trigger yang ubah).
2. **Review setelah submit = team Account saja** — pada SKU Work Unit, layer E-com Lead DIHAPUS (`[In Review - E-com Lead]` & `[Approved by Lead]` dibuang dari `status_transitions`, `sku_units_validate` ditulis ulang single-layer). Review Brief (`[In Review]`/`[Approved]`/`[Revision Requested]`) juga digerbang Account/OD/Director di dalam `briefs_track_time()`.
- Uji SQL LULUS: brief BRF-202607-0010 (E-com, merchant test ajeng) → Sepri pick-up (timer jalan, `timer_running=true`) → buat SKU → submit → Eka (E-com Lead) coba ambil review = DITOLAK ✅ → Anty (AM) ambil+approve → brief `[Completed]`, `work_time_seconds=78`, timer berhenti.

### Perubahan kode app (sudah ditulis, tsc bersih):
- `lib/actions/ecommerce.ts` — `startTimer`/`stopTimer` DIHAPUS (diganti komentar; timer via trigger).
- `lib/format.ts` — ditambah `durasi(sec)` helper.
- `app/(app)/ecommerce/forms.tsx` — `TimerButtons` dihapus; import startTimer/stopTimer dibuang.
- `app/(app)/ecommerce/page.tsx` — ditulis ulang: badge ⏱ waktu kerja otomatis per brief (akumulasi + segmen berjalan via `waktuKerja(b)`), review flow single-layer (Submitted for Review → AM ambil → Approve/Revisi), tabel Brief Selesai tampilkan kolom Waktu Kerja.
- `app/(app)/ads/page.tsx` & `app/(app)/kol/page.tsx` — ditambah badge ⏱ `waktuKerja(b)` + select kolom `work_time_seconds, timer_started_at`.
- **Verifikasi preview MCP**: input manual LSR livestream W2 sempat diuji jalan (sesi sebelumnya). tsc `npx tsc --noEmit` bersih. Dev server sempat nyala di localhost:3000.

## ⬜ DITUNDA (menunggu brief detail Yohan) — AI Auto-Reporting
- Yohan MINTA fitur: **tools AI otomatis generate report dari semua hasil MSDPS, digabung dengan hasil dari platform** (Shopee/TikTok seller center dll).
- Sudah dieksplorasi lalu **di-skip atas permintaan Yohan** ("saya akan berikan brief mendetail untuk itu menghindari miss creation").
- `lib/actions/reports.ts` yang sempat dibuat sudah DIHAPUS. Direktori `app/(app)/reports/` TIDAK dibuat. Paket `@anthropic-ai/sdk` SUDAH terpasang (package.json) — biarkan.
- **JANGAN bangun ulang tanpa brief Yohan.** Tunggu spesifikasi: sumber data platform (format paste/upload/CSV/API?), struktur laporan, per-merchant/per-periode, siapa yang boleh generate, apakah disimpan/diarsip, branding (MEA Report Designer palette).
- Catatan teknis (dari eksplorasi, untuk referensi saja): butuh `ANTHROPIC_API_KEY` di `.env.local`; pengumpulan lintas-modul perlu `createAdminClient` (service-role, server-only) karena RLS per divisi tak beri satu role akses semua tabel; model `claude-opus-4-8`, `max_tokens: 64000` + streaming (`.stream()` + `.finalMessage()`) karena output HTML panjang; ada skill `mea-client-reporting` & `shopee-ads-specialist` yang relevan untuk pola laporan.

## Action Plan berikutnya (selain auto-reporting)
Urutan disarankan; konfirmasi Yohan sebelum mulai fase besar.

1. ✅ **Verifikasi UI Fase C.2 via preview + akun uji** (SELESAI 3 Jul 2026):
   - Sepri (staff E-com): tombol timer hilang, badge ⏱ jalan ("⏱ 2m · berjalan" di BRF-0006), kolom Waktu Kerja di Brief Selesai (BRF-0010 = ⏱ 1m). Submit SKU-0004 tanpa checklist DITOLAK trigger ✅, setelah checklist → [Submitted for Review]. Sepri TIDAK lihat tombol review.
   - Eka (E-com Lead): TIDAK ada tombol review pada SKU submitted (layer lead hilang) ✅.
   - Anty (AM): lihat "Ambil review (Account)" → In Review - AM → Approve → SKU-0004 [Approved], completion brief 20%→40% ✅. Console bersih.
   - `/ads` (BRF-0007) & `/kol` (BRF-0008): badge "⏱ Xm · berjalan" muncul ✅.
   - Catatan: (a) timer BRF-0006/0007/0008 dinyalakan via siklus sah [In Progress]→[Blocked]→[In Progress] (pra-migrasi timer belum jalan); (b) password SEMUA akun `@meago.test` di-reset ulang ke `Msdps#2026` via SQL (login sempat invalid_credentials).
2. **Rapikan sisa timer lama (opsional, teknis)**: tabel `ecom_time_logs` + kolom `sku_work_units.time_logged_seconds` dibiarkan sebagai arsip historis (tak dipakai UI). Bila Yohan mau bersih total, bisa migrasi drop nanti — tapi TIDAK mendesak.
3. **AI Auto-Reporting** — begitu brief Yohan turun (lihat DITUNDA di atas).
4. **Fase D = M11–M15** (butuh konfirmasi Yohan dulu):
   - M11 Merchant Board (`v_merchant_board`), M12 Task/SLA (`block_requests`, `v_speed_score` — sekarang `work_time_seconds` per brief bisa jadi basis speed/effort metric!), M13 Merchant Health (`merchant_health_snapshots` + pg_cron; basisnya `merchant_gmv_authoritative` yang sudah ada), M14 Team Performance (`performance_scores`, `v_okr_attainment` + pg_cron), M15 Portals internal (`v_team_portal_*`, `v_management_dashboard`).
   - Catatan: `work_time_seconds` otomatis per brief (baru) = input berharga untuk M12/M14 (produktivitas & speed score per staff/divisi).

## Akun uji (semua password `Msdps#2026`), UUID untuk SQL
- Director: yohanagustian@meagency.co.id (Yohan, div Account, is_director)
- Account SPV: Sari `da7cc141-6452-43e7-87ef-0345150cc618` (lead); OD: Rara (is_od)
- AM: Anty `b35fea84-b182-4a00-8da8-b440d509c018`, Mey `b72b5cae-b24c-49c4-9bfc-0691bbb97369`
- E-com: Eka (lead) `b62bb7b0-49c1-4f22-bae1-f86ed16f5910`, Sepri `5b218bb4-f3df-4c69-9d64-782e94c11cef`
- Ads: Adit (lead) `2b7512da-d304-4a5f-bc5e-e93e858ccc7c`, Erlina `d81112b8-5078-4949-b351-35462e67bea8`
- KOL: Koko (lead) `cbb9a5d6-7123-4cd4-82d0-0f1f37692dce`, Rizal `51e2da28-9f1f-4f21-a1d2-b9d467010baf`
- Merchant uji: MER-202607-0001 "test ajeng" (`0df2a634-3fb1-4e78-ab96-69851615f667`), AM = Anty.

## Konvensi WAJIB (dipatuhi)
- Trigger ID/validasi = SECURITY DEFINER, di-revoke dari anon/authenticated.
- Tiap tabel lifecycle: `status`, `status_changed_by`, `status_changed_at` + `enforce_status_transition('<entity>')` + `capture_audit('<entity>')` + baris `status_transitions`.
- UI: JANGAN andalkan name/value tombol submit (React 19) → satu `<form>` per aksi + hidden `<input name to_status value>`.
- RPC app di-grant `authenticated` saja. Enforcement di Postgres, bukan app. Label status user-facing [Bahasa Indonesia].
- Verifikasi: `cd .../msdps && npx tsc --noEmit` (JANGAN `npm run build` saat dev jalan).

## State machine ringkas (terbaru pasca C.2)
- **brief**: To Do→In Progress→Submitted→In Review→(Approved|Revision Requested→In Progress)|Blocked|Overdue|Completed; LiveStream: Menunggu Forward ke Vendor→Diteruskan ke Vendor→Completed. Timer jalan di In Progress/Overdue. Review (In Review/Approved/Revision Requested) = Account/OD/Director only.
- **sku_unit (single-layer sekarang)**: To Do→In Progress→Submitted for Review→In Review - AM→(Approved|Revision Requested→In Progress); Cancelled dari mana saja (AM). Layer E-com Lead SUDAH DIHAPUS.
- ads/kol/livestream state machine tidak berubah dari Fase C.
