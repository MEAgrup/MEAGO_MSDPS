# Import Data Dealing POI (contoh 1 bulan terakhir) — SISA 59 BARIS

Sumber: `Report_Dealing_BD_Tiktok_GO` (sheet Operasional TTD/Accomodation/Dining),
baris dengan Timestamp ≥ 2026-06-16 (30 hari sebelum timestamp terakhir 2026-07-16)
= total **119 baris**.

## Status saat handoff (2026-07-16)
**60 dari 119 baris SUDAH masuk** ke project live `mvcckptntrvzujqaoxxh`
(semua TTD sampai "Nakamura Therapy Modernland"). Sisa **59 baris** ada di
folder ini dan tinggal dijalankan **berurutan, sekali saja**, via Supabase
SQL Editor (role postgres — RLS bypass; trigger tetap jalan: code DEAL-
di-mint, poin dihitung otomatis):

1. `poi_sub_1.sql` — 20 baris (TTD sisa + Accomodation awal)
2. `poi_sub_2.sql` — 20 baris (Accomodation)
3. `poi_sub_3.sql` — 19 baris (Accomodation sisa + Dining, termasuk realisasi & Berbayar BINGXUE/BURGER BANGOR)

Verifikasi sebelum & sesudah:

```sql
select count(*) from brand_deals where kategori_poi is not null;
-- 60 → jalankan sub_1, sub_2, sub_3
-- 80 → sub_1 sudah; jalankan sub_2, sub_3
-- 100 → tinggal sub_3
-- 119 → selesai
```

Script AMAN diperiksa duplikat: tiap file hanya boleh dijalankan SEKALI
(tidak ada on-conflict; menjalankan dua kali = baris dobel).

## Penyesuaian data yang disengaja saat generate (11 baris)
- 6 baris `Tanggal Visit Berakhir` < mulai (salah input di sumber) → disamakan dengan tanggal mulai.
- 5 baris tanpa nomor WA PIC → placeholder `-` (dinormalisasi trigger jadi string kosong).

## Catatan
- Deal `Berbayar` historis TIDAK dibuatkan transaksi Finance otomatis (hindari
  noise antrian verifikasi); pakai tombol "Buat Transaksi" per baris di `/deals`.
- `bd_id` dipetakan by email: `ajeng@meago.test` + `rafli/claudia/ira/fajar/sembo.bd@meago.dev`.
- Setelah semua masuk, folder ini boleh dihapus.
