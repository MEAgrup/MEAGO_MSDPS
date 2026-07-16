# Handoff — POI Dealing (MEA GO / TikTok GO) di Workspace BisDev

**Status:** ✅ DB applied + smoke test 7/7 + tsc bersih · ⏳ import contoh 59/119 baris tersisa + preview UI pending
**Branch:** `claude/fable-orchestrator-multimodel-9ltnw5` · **DB live:** `mvcckptntrvzujqaoxxh` (migrasi **0310** applied 2026-07-16)
**Metode sesi ini:** Fable = orchestrator/QC/revisi; eksekutor Opus (migrasi), Sonnet (actions+UI), Haiku (sweep istilah).

---

## 1. Apa yang dibangun

Workflow dealing BD dengan **POI** (venue TTD / Accomodation / Dining) untuk visit kreator —
sebelumnya via Google Form + spreadsheet "Report Dealing BD TikTok GO" — dipindah **full ke app**,
digabung ke tabel `brand_deals` (deal POI dikenali dari `kategori_poi IS NOT NULL`; baris lama =
deal shop MCN, kolom POI null).

### Keputusan interview dengan user (LOCKED — jangan dilitigasi ulang)
1. **Istilah**: "brand deals" = istilah lama; user-facing sekarang **"POI Deals / Merchant Deals"**.
   Nama tabel DB & kode internal TETAP `brand_deals` (pola sama dengan `mcn`). **Ingat untuk memory berikutnya.**
2. **Satu tabel digabung** (bukan tabel/halaman terpisah).
3. **Realisasi** (Tanggal Listing Creator, Tanggal Realisasi Visit, Realisasi Kreator/Video,
   Check Pelaksanaan) boleh diisi **semua tim** → RPC definer `update_poi_realisasi`, grant authenticated.
4. **Poin BD otomatis dari rule, rule belum baku** → derived read-only, dihitung trigger dari
   `app_config['poi.poin_rule']` (default: visit ✓ + real/target kreator ≥100% = 2, ≥50% = 1,
   <50% = 0.5; visit ✓ tanpa data kreator = 1; tidak visit = 0). Kalibrasi cukup ubah config.
5. **Berbayar → transaksi Finance**: RPC `create_poi_finance` match/create merchant M4 dari nama POI
   (dedup lower(nama), kategori map: TTD→'Attraction & Leisure', Accomodation→'Accommodation',
   Dining→'Dining'; kota/link placeholder '-') + insert `transactions` [Menunggu Verifikasi].
   Dipanggil otomatis saat registrasi deal Berbayar; deal lama ada tombol "Buat Transaksi".
6. **Benefit dropdown per kategori** dari `app_config['poi.benefits']` (6 nilai eksisting).
7. **Summary = tab di `/deals`**: per periode per BD (Total Deal, Realisasi Visit, %, Poin) +
   per kategori (% deal to visit) — pengganti sheet Summary.
8. **Import hanya 1 bulan terakhir** dari file contoh ("ini hanya contoh"); ke depan full input app,
   Google Form pensiun.
9. **Seed 6 BD** sebagai BizDev staff.

## 2. Artefak

| Artefak | Isi |
|---|---|
| `supabase/migrations/0310_poi_dealing.sql` (**applied**) | +22 kolom POI di `brand_deals`; `brand_deals_validate()` REPLACE (validasi wajib POI, normalisasi WA 0→62, poin derived); RPC `update_poi_realisasi(uuid,date,date,int,int,bool)` & `create_poi_finance(uuid,payment_intent)`; view `v_poi_deal_summary` (invoker); seed config `poi.poin_rule` / `poi.kategori` / `poi.benefits`; grants/revokes sesuai konvensi |
| `lib/actions/deals.ts` | +`registerPoiDeal` (insert + auto create_poi_finance bila Berbayar; RPC gagal → deal tetap tersimpan + warning), `updatePoiRealisasi`, `createPoiFinanceAction` |
| `app/(app)/deals/` | 3 tab: **Dealing POI** (form input replika Google Form + tabel deal POI + form realisasi inline + tombol Buat Transaksi), **Deals Shop (MCN)** (fungsional lama utuh), **Summary**. Judul "POI Deals / Merchant Deals" |
| Sweep istilah | `bizdev/page.tsx` ("Merchant Report"), `meago/schedule/*` ("Brand"→"Merchant") |
| `scripts/poi_import/` | **Sisa import**: `poi_sub_1/2/3.sql` (59 baris) + README status & instruksi |

## 3. Verifikasi yang sudah lolos
- **Smoke test SQL 7/7** (sebagai Rafli BD & Sepri E-com, transaksi di-rollback):
  insert POI Free (code DEAL- mint, poin=0, WA `0812…`→`62812…`) ✓; realisasi 15/15 → poin 2 ✓;
  8/15 → 1, 3/15 → 0.5 ✓; Berbayar → merchant kategori 'Accommodation' + TRX 3jt + link transaction_id ✓;
  create_poi_finance dobel ditolak ✓; Sepri insert deal ditolak RLS ✓; Sepri isi realisasi sukses ✓.
- `npx tsc --noEmit` bersih.
- QC diff ketiga eksekutor oleh orchestrator.

## 4. Akun BD (password `Meago2026!` kecuali Ajeng `Msdps#2026`)
| BD | Email | Catatan |
|---|---|---|
| Ajeng | ajeng@meago.test | existing BizDev staff (Fase A) |
| Rafli | rafli.bd@meago.dev | baru |
| Claudia | claudia.bd@meago.dev | baru |
| Ira | ira.bd@meago.dev | baru |
| Fajar | fajar.bd@meago.dev | baru |
| Sembo (BD) | sembo.bd@meago.dev | baru — SENGAJA terpisah dari Sembo KOL (sembo@meago.test) agar data uji KOL utuh |

## 5. SISA PEKERJAAN (urutan untuk chat berikutnya)
1. **Selesaikan import contoh**: jalankan `scripts/poi_import/poi_sub_1.sql` → `_2` → `_3`
   (SQL Editor / MCP; cek count dulu — lihat README folder itu; 60/119 sudah masuk).
   Sesi ini koneksi MCP putus-putus sehingga 3 file terakhir belum tereksekusi.
2. **Verifikasi Summary** setelah import penuh: `select * from v_poi_deal_summary` — bandingkan
   dengan sheet Summary (mis. periode 202606/202607 per BD).
3. **Preview UI end-to-end** (`npm run dev` / Vercel preview): login Fajar → input deal POI baru;
   login akun lain → isi realisasi; cek poin & Summary; deal Berbayar → TRX muncul di `/finance`.
4. **Commit/PR**: branch sudah di-push; buat PR bila user minta.
5. Opsional menyusul: UI kalibrasi `poi.poin_rule` untuk manajemen (sekarang edit config via SQL),
   status otomatis deal POI (mis. auto-done saat visit ✓), laporan Poin BD ke Team Performance (M14).

## 6. Catatan teknis penting
- **Poin adalah kolom derived**: jangan pernah kirim `poin` dari app — trigger menimpanya.
- **`update_poi_realisasi`** = SECURITY DEFINER, gate hanya auth.uid() (keputusan "semua tim").
  Kalau nanti mau dipersempit, ubah gate di fungsi itu saja.
- **Baris non-POI tidak berubah perilaku** — blok POI di trigger di-gate `kategori_poi IS NOT NULL`.
- Import historis dijalankan sebagai postgres (bypass RLS) tapi trigger tetap jalan; `created_at`
  di-set dari timestamp asli supaya periode Summary benar. Kode DEAL- semua bermonth 202607
  (next_code pakai bulan berjalan) — identitas saja, periode dari created_at.
- File sumber user (2.9MB markdown export): `Report_Dealing_BD_Tiktok_GO.md` — sheet `Form Responses 1`
  = input mentah; sheet `Operasional <kategori>` = input + realisasi backend; `Summary` = agregat;
  `Sheet8` = daftar venue Funworld/Kidzilla (tidak dipakai, hanya scratch list).
