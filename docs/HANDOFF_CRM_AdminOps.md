# MSDPS — Handoff: Adaptasi Web App Sheets → CRM Admin Ops (`/leads` + `/deals`)

Tanggal sesi: **2026-08-28**. Branch kerja: `claude/sheets-webapp-staging-adapt-qqstnx`,
sudah di-merge (fast-forward) ke **`staging`**. Kedua branch ada di commit **`7dd30b0`**.

## Ringkasan status (untuk chat berikutnya)

Tiga fitur inti Web App Google Apps Script *"Forms Leads Masuk & Dashboard CRM"* sudah
dipindahkan ke MSDPS, mengganti **flow** dua tab existing. **Kode selesai, DB staging selesai
& teruji SQL.** Yang BELUM: verifikasi UI end-to-end lewat browser.

**BLOCKER (bukan bug kode, tidak bisa dikerjakan dari repo):** deployment di
`meago-msdps-git-staging-meagency.vercel.app` **membaca database PRODUCTION**, bukan staging —
lihat `docs/STAGING.md` §3b untuk bukti log. Selama itu belum dibereskan, fitur ini tidak bisa
dites lewat URL staging (tabelnya tidak ada di DB yang dibaca), **dan setiap test lewat URL itu
sebenarnya menulis ke database production.**

Keputusan Yohan di sesi ini: **perbaiki env Vercel dulu**, JANGAN apply 0321 ke production.
Jadi migrasi 0321 saat ini **hanya ada di Supabase staging**.

## Konteks singkat

Repo: `MEAgrup/MEAGO_MSDPS`. Next.js App Router (React 19, Next 15.5) + Supabase.
Bahasa: Indonesia. Supabase staging `vgjzvdpxrdoefoncuazw`, production `mvcckptntrvzujqaoxxh`.

Pola uji DB sebagai user riil (dipakai di sesi ini, berhasil):
```sql
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}', true);
-- <query>
```

## Apa yang berubah (pemetaan fitur)

| Fitur Apps Script | Lokasi baru di MSDPS |
|---|---|
| Forms Leads Masuk | `/leads` — kartu aksi bertab, tab "Forms Leads Masuk" |
| Import Bulk Leads | `/leads` — tab "Import Bulk Leads" |
| Update Status Brand | `/leads` — modal per baris tabel |
| Pendataan Transaksi | `/deals` — kartu aksi bertab, tab "Pendataan Transaksi" |
| Import Bulk Transaksi | `/deals` — tab "Import Bulk Transaksi" |
| Notif "Perlu Input Transaksi" | banner di `/leads` **dan** `/deals` |

## Keputusan desain yang JANGAN di-litigasi ulang

**Tabel BARU, bukan menumpang tabel lama.** Alasannya:
- `leads` + `prospect_attempts` (Module 1) = pool dedup-by-nomor E.164 + mekanik kompetisi
  prospek. Konsep berbeda total dari CRM scouting brand/POI (satu baris per brand, tanpa dedup
  nomor, tanpa kompetisi). Masih jadi sumber `close_deal` di menu Merchant.
- `brand_deals` = registry deal MCN yang direferensikan `live_schedule_slots`,
  `cooperating_shops`, `special_projects`, dan portal kreator. Mengubah bentuknya merusak
  modul-modul itu.

Konsekuensi: sistem lama **tetap utuh** dan bisa dibuka di section arsip (`<details>`) di
masing-masing halaman. Ini disengaja, bukan sisa pekerjaan.

## Migrasi `supabase/migrations/0321_crm_leads_transaksi.sql`

Status: **applied ke staging `vgjzvdpxrdoefoncuazw`**. TIDAK ke production.

- `normalize_phone_62(text)` — normalisasi ke format `62…` (meniru `formatContactPIC()`).
  Beda dari `normalize_phone_id()` Module 1 yang menghasilkan `+62…`.
- **`crm_leads`** — ID `CRM-YYYYMM-NNNN`. Kategori brand Accommodation/Dining/TTD (CHECK) +
  jenis usaha preset per kategori, source, 34 provinsi, kontak PIC dinormalisasi trigger.
  Status `Leads → Approaching → Follow Up → Dealing/Rejected` (+`Renewal`) lewat
  `status_transitions('crm_lead')` — **21 transisi**, termasuk mundur/koreksi; lompat
  `Leads → Dealing` **diblokir**. Stempel `tanggal_status_*` + `tanggal_update_status`
  otomatis. Benefit dealing **wajib** saat Dealing/Renewal. Durasi kontrak harus lengkap &
  urut bila diisi.
- **`crm_transaksi`** — ID `CRMTRX-YYYYMM-NNNN`. FK `crm_lead_id` (`on delete restrict`).
  Hanya untuk lead Dealing/Renewal (dijaga trigger). `Berbayar` ⇒ nominal > 0;
  `Free` ⇒ nominal dipaksa 0. `visit_mulai <= visit_berakhir`. **Durasi Kerjasama wajib khusus
  kategori Dining**, dibersihkan untuk kategori lain. `jumlah_konten` & `total_jam_live`
  opsional. `is_bulk_import` lepas saat baris di-Edit.
- Pola Phase 0 dipatuhi: ID lewat trigger SECURITY DEFINER **setelah** validasi wajib lolos,
  `code` immutable, state machine data-driven, `capture_audit`, RLS per divisi, revoke anon.

### RLS terpasang
| Tabel | SELECT | INSERT/UPDATE | DELETE |
|---|---|---|---|
| `crm_leads` | mgmt + BizDev, Marketing, CreatorManagement, Account, Acquisition | mgmt + BizDev, Marketing | mgmt + Lead BizDev |
| `crm_transaksi` | mgmt + BizDev, CreatorManagement, Account, Finance | mgmt + BizDev, CreatorManagement | mgmt + Lead BizDev |

## File yang ditambahkan / diubah

Baru:
- `lib/crm/options.ts` — sumber tunggal opsi dropdown. **`CRM_STATUS_NEXT` di sini WAJIB sama
  dengan rows `status_transitions('crm_lead')` di 0321** (21 transisi). Kalau menambah transisi
  di DB, update konstanta ini juga.
- `lib/crm/types.ts` — bentuk row, harus sama dengan string `select()` di page.
- `lib/crm/waktu.ts` — konversi WIB. **Penting:** input `datetime-local` TIDAK boleh dikirim
  mentah ke `timestamptz` (Supabase default UTC ⇒ jam tergeser 7 jam). Semua lewat
  `jakartaInputToIso()` / `waktuJakarta()` / `isoToJakartaInput()`.
- `lib/crm/select-all.ts` — paginasi `.range()` per 1000 baris (PostgREST memotong di 1000
  **tanpa error**). Mengembalikan `{rows, error}` — **tidak throw**.
- `lib/supabase/project-ref.ts` — ref project Supabase yang sedang dibaca runtime, dilabeli
  PRODUCTION/STAGING, untuk ditampilkan di banner error.
- `lib/actions/crm-leads.ts`, `lib/actions/crm-transaksi.ts` — server actions.
- `app/(app)/leads/crm-forms.tsx`, `app/(app)/deals/crm-forms.tsx` — client components.
- `app/error.tsx` — **di-port dari branch `main`** (staging belum punya). Error boundary root.

Diubah: `app/(app)/leads/page.tsx`, `app/(app)/deals/page.tsx`, `docs/BUILD_PLAN.md`
(baris Fase F), `docs/STAGING.md` (§3b).

Tidak disentuh: `app/(app)/leads/forms.tsx` dan `app/(app)/deals/forms.tsx` (form sistem lama,
masih dipakai section arsip).

## Verifikasi yang SUDAH dilakukan

- **Smoke test trigger di staging: 10/10 lolos** — brand kosong ditolak; ID terbit
  `CRM-202608-0001`; `0812-3456-7890` → `6281234567890`; lompat Leads→Dealing diblokir; Dealing
  tanpa benefit ditolak; stempel `tanggal_status_dealing` terisi; Dining tanpa durasi ditolak;
  Berbayar nominal 0 ditolak; Free memaksa nominal 0 + bersihkan durasi; lead bertransaksi tidak
  bisa dihapus. Semua di-rollback — tidak ada baris tes tertinggal (`crm_leads` = 0 rows).
- **Probe RLS** — BizDev bisa baca + insert; Ads dapat 0 baris dan insert ditolak.
- **Audit kolom** — semua nama kolom di string `select()` dicek ada di schema staging (0 mismatch).
- `npx tsc --noEmit` dan `next build` bersih.

## Yang BELUM diverifikasi

- **UI end-to-end lewat browser** (login BD → isi form → cek data masuk). Terblokir env Vercel.
- Sandbox sesi ini **tidak bisa** menjangkau `*.vercel.app` maupun `*.supabase.co` lewat HTTP
  (network policy environment; hanya Supabase MCP yang punya akses DB). Jadi verifikasi UI harus
  dilakukan dari browser Yohan.
- **Cara verifikasi dari sisi agent setelah env diperbaiki:** begitu halaman dibuka, request akan
  muncul di `edge_logs` Supabase **staging**. Cek dengan `query_logs`:
  ```sql
  select timestamp, event_message from logs
  where source = 'edge_logs' order by timestamp desc limit 20
  ```
  Kalau `edge_logs` staging tetap kosong sementara production ramai ⇒ env masih salah sambung.

## Pekerjaan tersisa (urut prioritas)

1. **Yohan: perbaiki env var Vercel** (`docs/STAGING.md` §3 + §3b) — scope 3 variable Preview ke
   branch `staging`, lalu **Redeploy** (env baru tidak berlaku untuk deployment yang sudah jadi).
   Disarankan set juga default Preview ke staging supaya semua preview branch berhenti menyentuh
   production.
2. Test UI end-to-end di URL staging; kalau ada error, layarnya sekarang menampilkan pesan +
   `digest` (bukan layar kosong) — laporkan digest-nya.
3. Baru setelah lolos staging: apply 0321 ke production + merge `staging` → `main`.

## Dua utang teknis yang ditemukan sesi ini (BUKAN dari perubahan ini)

1. **`staging` dan `main` sudah menyimpang, dan nomor migrasi bertabrakan.**
   `main` punya `0317_gmv_video_weekly_tracking.sql`; `staging` punya
   `0317_acquisition_extra_fields.sql` + `0318` + `0319` + `0320_gmv_video_weekly.sql`.
   Juga `main` punya fix #17 (`lib/divisions.ts`, `app/error.tsx`, hardening `createAdminClient`
   di `lib/actions/employees.ts`/`portal.ts`/`admin.ts`) yang **belum ada di `staging`**.
   Harus direkonsiliasi sebelum merge `staging` → `main`. Sesi ini hanya mem-port `app/error.tsx`.
2. **Drift schema `brand_deals` tanpa migrasi di repo — sudah ditulis migrasinya (0322),
   BELUM di-apply.** Audit lanjutan 2026-08-28 menemukan drift-nya lebih besar dari catatan
   awal: **21 kolom** POI (`kategori_poi` … `transaction_id`), 2 CHECK, 2 FK, 2 index, view
   `v_poi_deal_summary`, **plus dua fungsi SECURITY DEFINER yang belum tercatat sama sekali**
   — `update_poi_realisasi()` dan `create_poi_finance()` (yang terakhir menerbitkan transaksi
   Finance M5 dan bisa membuat baris `merchants` baru). Semuanya ada di production **dan**
   staging, tidak ada di repo.

   Yang memakainya bukan kode repo ini: pencarian di `main` dan `staging` hanya menemukan
   `poi_location` (0312) — tidak ada referensi ke 21 kolom itu, ke view, atau ke kedua RPC.
   Padahal fiturnya hidup: production punya 60 baris `brand_deals` dan **semuanya** baris POI.
   Jadi konsumennya ada di luar repo ini; jangan menghapus objek-objek itu hanya karena tidak
   dipakai `.from()` di sini.

   `supabase/migrations/0322_brand_deals_poi_drift.sql` mendokumentasikan semua objek itu
   secara idempoten. Sudah diuji dengan menjalankannya utuh di Supabase staging di dalam
   transaksi lalu `rollback`: berjalan bersih, dan jumlah kolom/constraint/index serta body
   view tidak berubah sedikit pun (no-op).

   **Satu perubahan nyata yang disengaja di dalamnya:** `v_poi_deal_summary` di staging masih
   tanpa `security_invoker` sehingga melewati RLS `brand_deals` — advisor security staging
   menandainya `security_definer_view` level **ERROR**, satu-satunya ERROR di project itu dan
   satu-satunya regresi terhadap pembersihan 0314. Production sudah `security_invoker = true`.
   0322 menyetel invoker + pola grant 0008/0314 (`revoke all`, lalu `grant select to
   authenticated`), jadi di staging ia memperbaiki advisor dan di production ia hanya mencabut
   grant ambient `anon` (yang sudah tersaring RLS, dan tidak ada satu pun request ke view/RPC
   itu di log 23 jam terakhir). Dampak datanya nihil sekarang — `brand_deals` staging 0 baris.

   Belum di-apply ke project manapun. Terapkan ke staging dulu, verifikasi advisor ERROR-nya
   hilang, baru production.

## Format import bulk (untuk dokumentasi user)

**Leads** — pemisah tab / `;` / `,`; hanya `nama_bd` & `brand` wajib:
```
nama_bd, brand, kategori_brand, wilayah, jenis_usaha, source, nama_pic, kontak_pic, website
```

**Transaksi** — dikunci ke kode lead CRM; PIC & WhatsApp diambil dari data lead:
```
kode_lead, bentuk_kerjasama, nominal, benefit, visit_mulai, visit_berakhir,
jumlah_kreator, jumlah_konten, link_brief, nama_ops, total_jam_live
```
`visit_*` menerima `YYYY-MM-DDTHH:mm` atau `YYYY-MM-DD` (jam 00:00 WIB). Baris hasil impor
ditandai `bulk` sampai dilengkapi lewat Edit.
