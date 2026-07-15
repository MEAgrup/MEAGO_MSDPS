# Plan — Fitur MCN MEA di MSDPS (porting dari mcnapp + Special Project)

## Context

MEAGO/MSDPS adalah sistem internal PT MEA Agensi Digital (Next.js 15 + Supabase; aturan bisnis di-enforce di Postgres: trigger ID, state machine `status_transitions`, `audit_log` immutable, RLS per role). Fase A–D + 15 modul sudah selesai untuk kebutuhan tim Account & Service (merchant service delivery).

User (Yohan) ingin menambahkan fitur MCN (manajemen kreator affiliate TikTok) yang direplikasi dari platform mcnapp, mengikuti blueprint `PORTING_GUIDE.md` (di `/root/.claude/uploads/88f7340f-0ca4-5d5d-92c2-d26f92295dcc/c6b9bcc3-PORTING_GUIDE.md`), disesuaikan kebutuhan MEAGO, plus satu fitur baru (Special Project & Campaign) yang tidak ada di guide.

### Struktur kebutuhan per team (hasil interview)

1. **Team CM (Creator Management)** — Data Kreator, CM Workspace, Upload Data Mingguan, Jadwal Live. (Grup 1 guide)
2. **Team BizDev & Admin Operasional** — Merchant Deals: registrasi deal + import master deal **dalam 1 tab/halaman**, BizDev Workspace. Fitur existing yang dipakai: Leads & Prospek (M1). (Grup 2 guide)
3. **Team Akuisisi Kreator** — Acquisition Workspace. (Grup 3 guide)
4. **Special Project & Campaign** (fitur baru, konsep user) — Lead mendaftarkan project: nama, kebutuhan kreator (jumlah target), tanggal mulai–akhir, ads budget, merchant peserta, kategori industri (Dining/Accommodation/Things to Do), target GMV. Summary/reporting project muncul di workspace CM, BD, dan Akuisisi.
5. **Team Account & Service** — fitur existing (Merchant Board, E-com, Ads, KOL, LiveStream, dll) — tidak berubah, hanya ditata ulang navigasinya.

**Navigasi**: sidebar dikelompokkan per team; member hanya melihat grup yang relevan (role-gated seperti sekarang).

### Keputusan interview (final, jangan re-litigasi)

- **Scope**: semua grup (1+2+3) + fondasi §0 + Special Project.
- **Master kreator MCN terpisah** dari `creators` M9 KOL → tabel baru `mcn_creators`. KOL M9 tidak disentuh.
- **Special Project**: kebutuhan kreator = angka target + **assignment penuh** — kreator konkret di-assign ke project oleh CM (dari roster internal) DAN Akuisisi (kreator baru). Contoh use case: butuh 100 kreator, internal 50, sisanya dicari akuisisi. Merchant peserta dipilih dari master `merchants` M4.
- **BizDev leads**: pakai modul Leads existing (M1) — tidak ada tabel `bd_leads` baru. Lead shop dari CM masuk sebagai lead M1 dengan source baru.
- **Platform**: TikTok saja (MEAGO hanya di TikTok). Kolom platform tetap ada untuk future-proof, default 'tiktok'.
- **Deal ↔ Merchant M4**: link **opsional** (`merchant_id` nullable di brand_deals; brand luar cukup nama + shop ID).
- **Divisi baru** di enum `division`: `CreatorManagement`, `Acquisition` (BizDev sudah ada). Role Lead/Staff mengikuti pola existing.
- **Special Project registrar**: Lead divisi mana pun + OD/Director.
- **GMV aktual Special Project**: otomatis dari ingest — Σ GMV mingguan kreator ter-assign dalam rentang tanggal project.
- **Verifikasi Jadwal Live**: tim CM (staff & lead) + management; tidak ada role Creator Support.
- **Konvensi teknis**: ikuti MSDPS — ID via `next_code()`/`next_code_global()` trigger SECURITY DEFINER, state machine via `status_transitions` + `enforce_status_transition`, audit via `capture_audit`, RLS server-side, server action return `{ok,error}` (jangan throw mentah). `app_config` (key/value jsonb) dibuat baru — belum ada di MSDPS. Logika bisnis dari guide dipertahankan persis (parser toleran, W1–W5, weighted ctr, dedupe, dll).

## Aturan bisnis kunci dari PORTING_GUIDE (wajib dipertahankan)

### Fondasi
- `parseRupiah`: toleran 2 format ribuan (koma/titik), kurung = negatif, tak yakin → null (jangan menebak).
- `parseCommission`: `{min,max,isRange}`; simpan `raw` + `pct` (min bila range); di luar 0–100 → null.
- `parseFlexibleDate`: bulan ID/EN, day-first default, fallback month-first, validasi kalender nyata → ISO atau null.
- `app_config` seed: `m8.perf_drop=0.15`, `ingest.top_n_products=20`, `segments.price_bounds={low:180000,entry:800000,sweet:3600000,high:8000000}`, `m8.gmv_post_join_days=90`.

### Ingest (Upload Data Mingguan)
- Window W1–W5 LOCKED: W1=1–7, W2=8–14, W3=15–21, W4=22–28, W5=29–akhir; exact match; tolak lintas bulan; pesan error sebut periode file + window valid.
- `batch_id = "ingest:<periodStart>:<hash8>"` (sha256 isi file, 8 char) — idempoten; replace scoped **per (creator × minggu)**, bukan wipe batch.
- Process-on-ingest, **drop-raw**: baris mentah tidak pernah masuk DB; hanya 3 agregat: `creator_period_summary`, `creator_subcat_segment_gmv`, `creator_top_products` (top-N dari config).
- Parse: skip baris "Summary"; header dinormalisasi + alias Indonesia; baris tanpa product_id/shop_id skip+alasan; `items_sold=0` TIDAK di-skip (GMV tetap dihitung, avg_price null); kumpulkan `skipped[]`; 0 baris valid → diagnostik header ditemukan vs diharapkan.
- Agregasi: `ctr/ctor` = rata-rata tertimbang GMV; `live_pct` guard div-0 → null (null ≠ 0).
- Auto-create kreator belum dikenal (dari report performa → status `aktif`) + laporkan.
- Auto-fill master pasca-ingest: `gmv/gmv_live/gmv_video` = **rata-rata bulanan** dari seluruh histori (dedupe per (creator,period_start) createdAt terbaru menang; kanonik 1/8/15/22/29 menang; bulan kosong tidak dihitung nol); `niche`/`top_niches` ranking GMV kategori level-2; `jenis_creator` dari rasio live:video; hanya field berubah yang di-update.
- Guard overlap: batch processed lain dengan periode beda tapi overlap tanggal → tolak.

### CM Workspace
- Scope: CPM (staff CM) hanya kreator `owner_cpm_id = dirinya`; Lead CM & management lintas. Enforce di server/RLS.
- Growth W1–W5: minggu tanpa data = null (bukan 0); delta vs minggu TERISI sebelumnya; monthGrowth = (minggu terisi terakhir − pertama)/pertama.
- Alert `perf_drop`: GMV turun > config 0.15 periode-ke-periode → `platform_alerts` ke CPM owner; pulih → auto-resolve.
- Request kreator (sample/ads/hsl): sample = auto; ads > `ads_budget_cap` (atau cap belum diisi) → butuh approval Director.
- `commission_share` read-only (sync platform; tidak ada form edit).

### Jadwal Live
- Matriks creator × 7 hari (Senin-start); roster manual via `live_roster` flag.
- **Boleh multi-slot per kreator per hari** (tanpa unique (creator,date)).
- Status: scheduled/tentative/off/done; `done` = terkunci (server tolak edit/delete); verifikasi isi actual_start/end + verified_by/at.
- `brand_name` free text + `deal_id` opsional.
- Date math = string wall-clock `YYYY-MM-DD`, tanpa timezone/Date object.
- Copy week: offset hari sama, reset status/pk_ready/tap/verifikasi, skip OFF, tolak bila target terisi.
- Indikator: PK ✘, TAP ✘, ring "butuh verifikasi" (pending & tanggal < hari ini), "besok belum ada jadwal" (hari OFF-only tidak diwarning).

### Deals
- Form registrasi tervalidasi: brand_name wajib persis display platform; shop_id numeric-only + UNIK (tolak sebut deal existing); exp_date date-picker; komisi min/max 0–100 + max ≥ min; pic dari daftar employee; komisi disimpan raw + pct.
- `brand_deals.exp_date` → sync `cooperating_shops.deal_end` + `active_flag = exp_date >= today`. (cooperating_shops = kunci join shop ber-deal.)
- `deal_products`: 1 deal → N produk, mewarisi niche/exp/komisi.
- Import legacy: **jangan pernah crash/tolak baris** — probe header (skip baris judul), alias header nyata (`nama_campiagn` typo, `nama_bd`, `ads`), field kotor → null + `review_flags`; expired → active_flag=false; laporan inserted + {row,reason}.
- Registrasi + Import dalam **1 halaman ber-tab**.

### BizDev Workspace
- Tracker `creator_requests` lintas CM; pipeline deal (`pipeline_stage` manual, ter-audit, tampil shop_name+shop_id); lead → modul M1 existing; brand report sederhana (agregasi per shop ber-deal).
- Routing campaign: state machine murni — route (owner_cpm auto dari mcn_creators) → CM konfirmasi mau/tidak → [brand acc bila perlu] → final fix/batal → handover. Transisi ilegal ditolak server.

### Acquisition
- `recordAcquisition`: snapshot `commission_share_at_binding`; GMV 30d pre-binding (baseline log-only); `quarter_end` = akhir kuartal kalender binding_date; specialist = actor sendiri; creator prospek → binding.
- `recordReferral`: `antar_creator` wajib referrer; `platform` tanpa referrer.
- `markReferralPaid`: guard sudah dibayar → tolak; permission lead/management.
- `markHandoffDone`: blok sampai creator punya `owner_cpm_id` (pesan arahkan ke CM Lead); sukses → status aktif.
- `refreshGmvPostJoin`: window dari config; Σ affiliate_gmv per period_start dalam [binding, binding+window) dan [binding, quarter_end].

### Special Project (fitur baru — desain sendiri)
- `special_projects`: code SPJ-YYYYMM-NNNN, name, industry_category (Dining/Accommodation/Things to Do), start_date, end_date, ads_budget, target_gmv, creators_needed int, status (draft→active→done/cancelled via state machine), created_by (lead/OD/director only).
- `special_project_merchants`: project × merchant M4 (FK ke merchants).
- `special_project_creators`: project × mcn_creator, `filled_by` ('cm'|'acquisition'), assigned_by, assigned_at.
- Derived summary (view): creators_assigned vs needed (split per filled_by), GMV aktual = Σ `creator_period_summary.affiliate_gmv` kreator ter-assign dengan `period_start` dalam [start_date, end_date], progress vs target_gmv.
- Summary card project aktif muncul di workspace CM, BD, Akuisisi (read-only) + halaman `/projects` untuk kelola.

## Konvensi rumah yang WAJIB diikuti (hasil eksplorasi)

- `audit_log.entity_id` = **uuid** → semua tabel baru pakai `id uuid PK default gen_random_uuid()` + `code text unique` (bukan bigserial/text-PK seperti guide). Attach: `create trigger ... after insert or update ... execute function capture_audit('<entity>')` (entity via `tg_argv[0]`).
- State machine: kolom `status_changed_by uuid, status_changed_at timestamptz` wajib di tabel lifecycle; attach `enforce_status_transition('<entity>')` BEFORE UPDATE; seed `status_transitions (entity, from_status, to_status, allowed_tokens)`.
- ID: trigger validate BEFORE INSERT/UPDATE `security definer set search_path = public`; `next_code('PFX')` → PFX-YYYYMM-NNNN, `next_code_global('PFX')` → PFX-NNNN; code immutable (`[ID tidak dapat diubah]`); guard field wajib `[data tidak lengkap...]`. Revoke execute fungsi trigger dari public/anon/authenticated.
- RLS: helper `is_od() is_director() is_lead() auth_division() auth_emp_id() actor_tokens()`; pola select `is_od() or is_director() or auth_division() in (...)`; plumbing tables = RLS enabled tanpa policy.
- Server action: `"use server"`, `type ActionResult = { ok: boolean; message: string }`, signature `(_prev, formData)` utk `useActionState`, helper `ctx()` (auth + row employees), TIDAK PERNAH throw, `revalidatePath` saat sukses, dup key `error.code === "23505"`.
- Forms: `"use client"` + `useActionState`; **satu `<form>` per aksi dengan hidden input** (nilai submit button tidak terkirim di React 19). Tidak ada komponen tab existing → tab dibuat sederhana via `useState` di client component.
- Import bulk existing = **paste textarea** + split manual (tanpa lib parser). package.json belum punya parser file.
- Nav `app/(app)/layout.tsx`: server component, boolean per grup `const seeX = mgmt || ["Div"].includes(div)`.
- `ALTER TYPE ... ADD VALUE` belum ada preseden — nilai enum baru **tidak boleh dipakai di transaksi yang sama** → migration enum terpisah dari pemakaiannya.
- pg_cron pattern: `select cron.schedule('nama', 'cron', $$select fn()$$)` — dipakai bila perlu job berkala.
- `lib/format.ts`: `rupiah()`, `num()`, `tanggal()` siap pakai.
- merchants M4: `id uuid` PK + `code MER-…`; leads M1: enum `lead_source` (11 nilai) + `lead_status`.

## Rencana implementasi

### Step 0 — Dependency
- Tambah `xlsx` (SheetJS) ke package.json — dibutuhkan untuk file export TikTok XLSX pada Upload Data Mingguan (CSV diparse manual). Hanya dipakai server-side.

### Step 1 — Migrasi SQL (supabase/migrations/, seri 0300)

**0300_mcn_enums.sql** — HANYA penambahan nilai enum (transaksi terpisah):
- `alter type division add value 'CreatorManagement'; alter type division add value 'Acquisition';`
- `alter type lead_source add value if not exists 'MCN Shop Lead';` (lead shop dari CM masuk M1)

**0301_mcn_foundation.sql**
- `app_config (key text pk, value jsonb not null, updated_by uuid, updated_at)` — RLS: select authenticated; manage OD/Director. Seed: `mcn.perf_drop=0.15`, `mcn.gmv_post_join_days=90`, `mcn.top_n_products=20`, `mcn.price_bounds={low,entry,sweet,high}`, `mcn.deal_expiring_days=14`.
- `platform_alerts (id uuid pk, code ALRT-YYYYMM-NNNN, alert_type text check in ('perf_drop','link_bocor','deal_expiring'), mcn_creator_id uuid, shop_id text, target_member_id uuid→employees, detail jsonb, resolved bool, resolved_at, created_at)` — insert/update oleh CM+mgmt (dan sistem via action); select: target member sendiri + divisi CreatorManagement/BizDev + mgmt. Audit trigger.

**0302_mcn_creators.sql**
- `mcn_creators (id uuid pk, code MCR-NNNN via next_code_global, name text not null, platform text not null default 'tiktok', niche text, top_niches jsonb, status text default 'prospek' check in prospek/binding/aktif/nonaktif, jenis_creator text check in live/video/mixed, gmv numeric, gmv_live numeric, gmv_video numeric (rata-rata BULANAN), commission_share numeric (read-only dari sisi form), owner_cpm_id uuid→employees, live_roster bool default false, ads_budget_cap numeric, notes, created_by, created_at, status_changed_by/at)`.
- `unique (platform, lower(name))` — kreator dipisah per platform.
- Transitions: prospek→binding, prospek→aktif, binding→aktif, aktif→nonaktif, nonaktif→aktif (allowed_tokens null; perubahan tercatat).
- RLS: select mgmt + divisi CreatorManagement/BizDev/Acquisition/KOL; insert CM+Acquisition+mgmt; update: mgmt + CM lead lintas, CM staff hanya `owner_cpm_id = auth_emp_id()` (scope CPM), Acquisition boleh update terbatas (status via action). Audit.

**0303_mcn_ingest.sql**
- `upload_batches (id uuid pk, batch_id text unique 'ingest:<start>:<hash8>', source_type text default 'tiktok', uploaded_by, uploaded_at, row_count_raw int, creators_count int, period_start date, period_end date, file_hash text, status text check staging/processed/failed, processed_at, error text)`.
- `creator_period_summary (id uuid pk, mcn_creator_id uuid, period_start date, period_end date, upload_batch text, gmv_total, affiliate_gmv, affiliate_live_gmv, affiliate_video_gmv, live_orders, video_orders, orders, items_sold, refund_gmv, ctr, ctor, live_pct, created_at, unique(mcn_creator_id, period_start, upload_batch))`.
- `creator_subcat_segment_gmv (id uuid pk, mcn_creator_id, period_start, upload_batch, category_l2 text, price_segment text null, gmv, items_sold)`.
- `creator_top_products (id uuid pk, mcn_creator_id, period_start, upload_batch, product_id text, product_name text, shop_id text, shop_name text, gmv, items_sold, rank int)`.
- RLS ketiganya: select mgmt+CM+BizDev+Acquisition; insert/delete CM+mgmt (pipeline delete-then-insert per creator×minggu). Tanpa audit per baris (audit 1x per run di level action, entity 'ingest', entity_id = upload_batches.id).

**0304_live_schedule.sql**
- `live_schedule_slots (id uuid pk, mcn_creator_id uuid not null, schedule_date date, start_time time, end_time time, status text default 'scheduled' check scheduled/tentative/off/done, off_reason text, brand_name text, deal_id uuid null→brand_deals(nanti, FK ditambah di 0305), deals_by text check bd/cm/creator, ads_payer text check brand/mea/invoicing_mea/organik, ads_note, pk_ready bool, product_set_title, product_connected_tap bool, fokus_produk, actual_start time, actual_end time, verified_by uuid, verified_at, created_by, updated_by, created_at, updated_at, status_changed_by/at)` + index (schedule_date), (mcn_creator_id, schedule_date). **TANPA unique(creator,date)** — multi-slot per hari.
- Trigger lock: BEFORE UPDATE/DELETE — bila `old.status='done'` → raise `[slot sudah diverifikasi dan terkunci]`.
- Transitions: scheduled↔tentative, scheduled→off, tentative→off, off→scheduled, scheduled→done, tentative→done (done hanya via aksi verify yang mengisi actual_start/end — divalidasi trigger: to done wajib actual_start & verified_by).
- RLS: select mgmt+CM+BizDev; write CM+BizDev+mgmt (CPM staff scope kreator sendiri via owner_cpm_id subquery). Audit ('live_slot').

**0305_deals.sql**
- `brand_deals (id uuid pk, code DEAL-YYYYMM-NNNN, brand_name text not null, shop_id text unique (nullable, unik bila terisi — partial unique index), merchant_id uuid null→merchants (link opsional M4), niche, brand_link, campaign_name, campaign_id, exp_date date, deal_end date (=exp_date, diset trigger), komisi_kreator_raw text, komisi_kreator_pct numeric, komisi_mea_raw, komisi_mea_pct, pic_tap uuid→employees, gmv_tap numeric, avg_price, ads_budget, service_fee, campaign_type text default 'paid' check paid/sample/extra_commission, status text default 'running' check running/hold/done, priority text, pipeline_stage text default 'baru', review_flags jsonb, sourced_by_role text check bd/cm, notes, created_by, created_at, status_changed_by/at)`.
- `deal_products (id uuid pk, deal_id uuid not null, product_id, product_name not null, product_link, niche, exp_date, komisi_kreator_pct, komisi_mea_pct, ads_budget, service_fee, status, created_by)`.
- `cooperating_shops (shop_id text pk, shop_name, deal_id uuid, deal_start date, deal_end date, active_flag bool)` — sinkron dari brand_deals (trigger AFTER INSERT/UPDATE pada brand_deals: upsert cooperating_shops set deal_end=exp_date, active_flag=exp_date>=current_date bila shop_id terisi).
- FK `live_schedule_slots.deal_id → brand_deals(id)` ditambahkan di sini.
- Transitions brand_deal: running↔hold, running→done, hold→done.
- RLS: select mgmt+BizDev+CM+Account; insert/update BizDev+mgmt, plus CM boleh insert (self-sourced deal, `sourced_by_role='cm'`). Audit ketiga tabel.

**0306_requests_routing.sql**
- `creator_requests (id uuid pk, code REQ-YYYYMM-NNNN, mcn_creator_id uuid not null, type text check sample/ads/hsl, target_brand text, detail text, status text default 'diajukan' check diajukan/diproses/selesai/ditolak, needs_approval bool default false, approved_by uuid, approved_at, requested_by, created_at, status_changed_by/at)`.
  - Trigger validate: transisi diajukan→diproses ditolak bila `needs_approval and approved_by is null` → `[request ads melebihi budget cap — butuh approval Director]`. Approval (set approved_by) hanya Director (cek `is_director()` di trigger BEFORE UPDATE bila approved_by berubah).
  - Transitions: diajukan→diproses, diajukan→ditolak, diproses→selesai.
- `campaign_requests (id uuid pk, code CRQ-YYYYMM-NNNN, deal_id uuid→brand_deals, mcn_creator_id uuid, owner_cpm_id uuid (auto-derive), cm_confirm_status text default 'menunggu' check menunggu/mau/tidak, needs_brand_acc bool, brand_acc_status text default 'n_a' check n_a/menunggu/approved/ditolak, final_status text default 'proses' check proses/fix/batal, handover_done bool default false, created_by, created_at)`.
  - Transisi dijaga pure function di lib (`lib/mcn/routing.ts`) + guard DB minimal (check constraint: `handover_done = false or final_status = 'fix'`).
- RLS: creator_requests — insert CM (CPM scope kreator sendiri), select CM+BizDev+mgmt, update CM+BizDev+mgmt (approval Director via trigger). campaign_requests — BizDev+CM+mgmt. Audit keduanya.

**0307_acquisition.sql**
- `acquisitions (id uuid pk, code ACQ-YYYYMM-NNNN, mcn_creator_id uuid not null, specialist_id uuid not null (=actor, dipaksa trigger: `new.specialist_id := auth.uid()` saat insert), lead_source text check inbound/outbound/platform, binding_date date not null, commission_share_at_binding numeric (snapshot), gmv_last_30d numeric, gmv_post_join numeric, gmv_quarter_actual numeric, quarter_end date, handoff_done bool default false, notes, created_at)`.
- `referrals (id uuid pk, code RFR-YYYYMM-NNNN, new_creator_id uuid not null, referrer_creator_id uuid null, referral_source text check antar_creator/platform, commission_status text default 'pending' check pending/dibayar, recorded_by, created_at)` + check constraint: `(referral_source='antar_creator' and referrer_creator_id is not null) or (referral_source='platform' and referrer_creator_id is null)`.
- RLS: select Acquisition+CM+mgmt; insert Acquisition+mgmt; update terbatas (markReferralPaid: lead/od/director — enforce trigger cek actor_tokens saat commission_status berubah; handoff/refresh GMV: Acquisition+mgmt). Audit keduanya.

**0308_special_projects.sql**
- `special_projects (id uuid pk, code SPJ-YYYYMM-NNNN, name text not null, industry_category text not null check in ('Dining','Accommodation','Things to Do'), start_date date not null, end_date date not null (check end>=start), ads_budget numeric, target_gmv numeric, creators_needed int not null, description text, status text default 'draft' check draft/active/done/cancelled, created_by, created_at, status_changed_by/at)`.
  - Insert hanya lead/od/director (RLS with check `is_lead() or is_od() or is_director()`).
  - Transitions: draft→active, active→done, active→cancelled, draft→cancelled (allowed_tokens `{lead,od,director}`).
- `special_project_merchants (id uuid pk, project_id uuid not null, merchant_id uuid not null→merchants, unique(project_id, merchant_id), added_by, created_at)`.
- `special_project_creators (id uuid pk, project_id uuid not null, mcn_creator_id uuid not null, filled_by text not null check cm/acquisition, assigned_by, created_at, unique(project_id, mcn_creator_id))`.
- View `v_project_summary` (security_invoker): per project → creators_assigned total & per filled_by, merchant_count, actual_gmv = Σ `creator_period_summary.affiliate_gmv` untuk kreator ter-assign dengan `period_start between start_date and end_date` (dedupe per creator×period_start ambil created_at terbaru), pct vs target.
- RLS: select semua divisi terkait (CM/BizDev/Acquisition/Account) + mgmt; write assignment: CM & Acquisition & mgmt (filled_by dipaksa trigger dari divisi actor: CreatorManagement→'cm', Acquisition→'acquisition', mgmt bebas). Audit.

### Step 2 — Pure lib (tanpa DB, unit-testable)

- `lib/mcn/parsers.ts` — `parseRupiah`, `parseCommission`, `parseFlexibleDate`, `parsePercent`, `parseIntTolerant` — persis aturan guide §0.1–0.3 (null bila tak yakin).
- `lib/mcn/weeks.ts` — `w1w5WindowsOf(year,month)`, `validateW1W5Period(start,end)` (exact match + tolak lintas bulan + daftar window valid di pesan), `weekIndexOfDate(dateStr)` (dari HARI period_start), `buildMonthlyGrowth(rows)` (dedupe createdAt terbaru; kanonik 1/8/15/22/29 menang; null ≠ 0; delta vs minggu terisi sebelumnya), `buildMonthlyAverages(rows)` (rata-rata bulanan lintas bulan berdata). **Semua date math pakai string YYYY-MM-DD + kalender integer, tanpa `new Date(iso)`.**
- `lib/mcn/ingest.ts` — `parsePlatformRows(cells[][])` (skip Summary; normalisasi header + alias ID→EN; skip tanpa product/shop id + alasan; items_sold=0 tetap; kolom Date rentang; skipped[]; diagnostik header) dan `aggregateRows(rows, config)` (1 pass → summary per creator (ctr/ctor weighted-by-GMV, live_pct guard div-0), subcat×segmen (avg_price per baris, bounds dari config), top-N produk).
- `lib/mcn/routing.ts` — pure transition `campaignRoutingNext(state, event) → newState | {error}`.
- `lib/mcn/copy-week.ts` — `buildCopiedSlots(slots, targetMonday)` (offset hari sama; reset status/pk/tap/verifikasi; skip OFF).
- `lib/mcn/indicators.ts` — indikator slot (PK✘, TAP✘, butuh-verifikasi, besok-kosong dgn aturan OFF-only).
- `lib/mcn/file-read.ts` — baca File (FormData) → `cells[][]`: CSV split manual (quote-aware), XLSX via `xlsx`; sha256 (node:crypto) untuk hash8.

### Step 3 — Server actions (`lib/actions/`)

Semua mengikuti pola `ActionResult` + `ctx()`:
- `mcn-creators.ts` — addCreator (prospek manual), assignOwner (CM Lead/mgmt), toggleRoster, setAdsBudgetCap, setStatus (via state machine). TIDAK ada edit commission_share.
- `mcn-ingest.ts` — `runIngest(formData{file, source_type})`: baca file → parse → validasi W1–W5 → cek overlap batch processed → resolve/auto-create mcn_creators (scope platform; dari report → status aktif) → upsert upload_batches staging → agregasi → delete-then-insert 3 tabel scoped per (creator×minggu) → auto-fill master (gmv rata-rata bulanan dari seluruh histori via buildMonthlyAverages; niche ranking; jenis_creator; hanya field berubah) → refreshGrowthAlerts (buat/auto-resolve perf_drop dari app_config) → status processed (gagal → failed + error). Return laporan: baris, kreator, auto-created, skipped[].
- `mcn-schedule.ts` — createSlot, updateSlot, deleteSlot (server tolak bila done), verifySlot (isi actual → done), toggleRosterInline, copyWeek (tolak bila target terisi).
- `deals.ts` — registerDeal (validasi field per guide §2.2, fieldErrors per field digabung dalam message terstruktur, cek shop_id duplikat sebut deal existing, bentuk komisi raw+pct, insert + produk dinamis + sync cooperating_shops otomatis via trigger, laporan parsial), importLegacyDeals (textarea paste; probe header; alias termasuk `nama_campiagn`; field kotor → null + review_flags; expired → active_flag false; laporan inserted + {row,reason}), setPipelineStage, addDealProduct.
- `bizdev.ts` — createShopLead (insert leads M1 source 'MCN Shop Lead'), routeCampaign/cmConfirm/brandAcc/finalize/handover (panggil pure routing + tulis + audit implisit).
- `acquisition.ts` — recordAcquisition (snapshot commission_share; GMV 30d pre; quarter_end kalender; creator prospek→binding), recordReferral, markReferralPaid, markHandoffDone (blok tanpa owner_cpm_id, pesan arahkan CM Lead; sukses → creator aktif), refreshGmvPostJoin (window config).
- `projects.ts` — createProject (lead+), setProjectStatus, addProjectMerchant, removeProjectMerchant, assignProjectCreator (filled_by dari divisi actor), unassignProjectCreator.
- `mcn-requests.ts` — createRequest (ads: cek cap → needs_approval), approveRequest (Director), progressRequest.
- `config.ts` — updateAppConfig (OD/Director) — halaman kecil atau bagian management.

### Step 4 — UI (app/(app)/…) + navigasi per team

Nav `layout.tsx` ditata jadi seksi berjudul per team (headings kecil di sidebar):
1. **CM Kreator** (`seeCM = mgmt || div==='CreatorManagement'`): `/mcn/creators` Data Kreator · `/mcn/workspace` CM Workspace · `/mcn/schedule` Jadwal Live. (BizDev boleh lihat schedule & creators read-only sesuai RLS.)
2. **BizDev & Admin Ops** (`seeBD = mgmt || div==='BizDev'`): `/leads` (existing) · `/deals` Merchant Deals · `/bizdev` BizDev Workspace.
3. **Akuisisi Kreator** (`seeAcq = mgmt || div==='Acquisition'`): `/acquisition`.
4. **Special Project** (`seeProj = mgmt || is_lead || div in (CM,BizDev,Acquisition)`): `/projects`.
5. **Account & Service** (gate existing dipertahankan): `/board /account /ecommerce /ads /kol /livestream /merchants /campaigns`.
6. **Umum/Manajemen**: `/dashboard /portal /finance /okr /management /employees` (gate existing).

Halaman baru (pola page.tsx server component + forms.tsx client):
- `/mcn/creators` — tabel master (nama, platform, status, niche, jenis, GMV bulanan, owner CM, roster, komisi RO) + form tambah prospek + assign owner + toggle roster + set cap.
- `/mcn/workspace` — (a) card Upload Data Mingguan (input file CSV/XLSX + hasil laporan), (b) tabel Growth W1–W5 bulan terpilih (?month=YYYY-MM) dengan delta & total, (c) daftar platform_alerts unresolved, (d) request kreator + antrian approval Director, (e) summary Special Project aktif.
- `/mcn/schedule` — matriks minggu (?week=YYYY-MM-DD Senin) kreator roster × 7 hari; slot chips + indikator; form slot/verify/copy-week; panel "Verifikasi Hari Ini" & "Terlewat".
- `/deals` — **1 halaman, tab client-side**: [Registrasi Deal] form tervalidasi + baris produk dinamis; [Import Master Deal] textarea paste + laporan; di bawahnya daftar deals (code, brand, shop, exp, status, stage, review_flags badge, expiring soon).
- `/bizdev` — tracker requests lintas CM, pipeline deals per stage (move stage), routing campaign (buat + aksi transisi), tombol/form lead shop → M1, brand report ringkas (GMV per shop ber-deal dari agregat), summary project.
- `/acquisition` — form closing binding, tabel per specialist & sumber, referrals + mark paid, antrean handoff (blocker CPM), tombol refresh GMV post-join, summary project.
- `/projects` — form create (lead+), daftar project + progress (v_project_summary: kreator terisi cm/akuisisi vs target, GMV aktual vs target), kelola merchant & kreator per project.

### Step 5 — Verifikasi & delivery

1. **Parser check**: skrip node cepat di scratchpad menjalankan kasus uji dari guide (parseRupiah 6 kasus, parseCommission 5, parseFlexibleDate 5, W1–W5 valid/tolak, buildMonthlyGrowth null-vs-0) — semua harus lolos.
2. **Migrasi**: apply 0300–0308 ke project Supabase live `mvcckptntrvzujqaoxxh` via Supabase MCP `apply_migration` (pola sesi sebelumnya "DB applied+tested"), lalu smoke-test SQL: insert mcn_creator (ID MCR terbit), transisi ilegal ditolak, slot done terkunci, shop_id duplikat ditolak, referral platform+referrer ditolak (check constraint), v_project_summary menghitung.
3. **Typecheck**: `npx tsc --noEmit` bersih (JANGAN `npm run build` bila dev server nyala — konvensi repo).
4. **Ingest end-to-end**: file CSV contoh kecil (3 kreator × beberapa baris, termasuk baris Summary, baris tanpa product_id, items_sold=0) di scratchpad → jalankan fungsi parse+aggregate langsung (node) memverifikasi angka; uji juga penolakan periode non-W1W5.
5. **Docs**: update `docs/BUILD_PLAN.md` (baris modul MCN baru) + tulis `docs/MCN_MEA_CONCEPT.md` (rangkuman keputusan interview ini).
6. **Git**: commit bertahap per step di branch `claude/msdps-mcn-mea-features-buqt7d`, push, buat **draft PR** ke default branch, subscribe PR activity.

### Catatan risiko
- `ALTER TYPE ADD VALUE` di 0300 harus migration sendiri (nilai baru tak boleh dipakai dalam transaksi sama) — pemakaian pertama ada di 0301+.
- Ingest menulis banyak baris via PostgREST (delete-then-insert per creator×minggu) — batch insert per tabel dalam 1 call supaya cepat.
- `xlsx` hanya diimpor di modul server (`lib/mcn/file-read.ts`) agar tak masuk bundle client.
- Fitur guide yang di-SKIP (di luar scope MEAGO): Lane 2 leak analysis (§1.2.7), kontrak e-sign, komplain kreator MCN (sudah ada modul komplain merchant), bd_leads (pakai M1), Shopee parsing.
