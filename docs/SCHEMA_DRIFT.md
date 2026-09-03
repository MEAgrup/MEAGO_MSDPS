# Schema Drift — cara mendeteksi & mencegahnya

## Kenapa dokumen ini ada

Beberapa perubahan skema pernah di-apply **langsung ke Supabase live** tanpa file
migrasi pendamping di repo. Komentar di `0332`/`0333` menyebutnya "migrasi lampau yang
tidak tercermin di riwayat migrasi lokal".

Akibatnya (audit 2026-09-02): **rantai migrasi repo tidak bisa dijalankan dari nol.**
Diverifikasi empiris di PostgreSQL 16 bersih dengan menjalankan `0001`→`0338` berurutan:

```
0332_deal_transactions.sql:56
ERROR: column "bentuk_kerjasama" does not exist
```

21 kolom `brand_deals` ada di live tapi tak pernah dibuat migrasi mana pun. `0332`
memanggil `alter column nominal_harga …` dan `add constraint … check (bentuk_kerjasama …)`,
`0336`/`0337` memasang trigger `update of kategori_poi, bentuk_kerjasama` — semuanya
divalidasi Postgres saat DDL, jadi gagal keras. `supabase db reset`, provisioning
environment baru, dan CI dari nol semuanya mati di titik itu.

Diperbaiki oleh `0320_brand_deals_poi_reconcile.sql` dan `0339_schema_reconcile.sql`.

## Aturan (agar tidak terulang)

1. **Setiap** perubahan skema live wajib punya file di `supabase/migrations/`.
   Tidak ada pengecualian — termasuk perbaikan cepat lewat SQL Editor.
2. Bila terlanjur di-apply lewat SQL Editor: **segera** tulis file migrasi
   idempoten (`if not exists` / guard `pg_constraint`) yang menghasilkan keadaan
   yang sama, dan taruh pada **posisi kronologis yang benar** — sebelum migrasi
   mana pun yang memakainya. Menaruhnya di ujung tidak memperbaiki rantai.
3. Jalankan `bash scripts/pg_test_reset.sh` sebelum merge migrasi apa pun.

## Uji rantai migrasi (cepat, lokal)

```bash
bash scripts/pg_test_reset.sh
# ✅ 57 migrasi lolos dari nol (database msdps_reset, port 55432)
```

Butuh paket `postgresql` lokal (`psql` + `initdb`). Skrip membuat cluster sementara,
memasang stub minimal lingkungan Supabase (`auth.uid()`, role `anon`/`authenticated`,
`pg_cron`, `storage.buckets`), lalu menjalankan seluruh `supabase/migrations/*.sql`
berurutan. Keluar bukan-nol pada file pertama yang gagal, lengkap dengan pesan ERROR-nya.

Ini menguji **bisa-tidaknya** rantai dijalankan — bukan kesetaraan dengan production.

## Membandingkan hasil reset dengan live

Setelah `pg_test_reset.sh` sukses, ambil sidik jari kedua sisi dan bandingkan.

Lokal:
```bash
psql -h /tmp -p 55432 -U postgres -d msdps_reset -tAqc \
  "select table_name||'|'||md5(string_agg(column_name||':'||data_type||':'||is_nullable, ',' order by column_name))
   from information_schema.columns where table_schema='public' group by table_name order by table_name;" \
  | LC_ALL=C sort > /tmp/local_fp.txt
```

Live — jalankan kueri yang sama lewat MCP Supabase (`execute_sql`) pada
`mvcckptntrvzujqaoxxh`, simpan hasilnya ke `/tmp/live_fp.txt`, lalu:
```bash
export LC_ALL=C
comm -23 <(cut -d'|' -f1 live_fp.txt|sort) <(cut -d'|' -f1 local_fp.txt|sort)   # live-only
comm -13 <(cut -d'|' -f1 live_fp.txt|sort) <(cut -d'|' -f1 local_fp.txt|sort)   # repo-only
join -t'|' live_fp.txt local_fp.txt | awk -F'|' '$2!=$3{print $1}'              # struktur beda
```

## Status terakhir (2026-09-02, setelah 0320 + 0339)

- Rantai migrasi: **57 file, lolos dari nol.**
- Paritas kolom: **79 objek identik**, nol selisih struktur.
- Sisa selisih yang diketahui & disengaja:

| Objek | Keadaan | Keputusan |
|---|---|---|
| `crm_leads` | live-only, **0 baris**, tidak dirujuk `app/` maupun `lib/` | Tidak dibuat ulang di repo. Drop dari live menunggu konfirmasi — menghapus objek produksi tidak bisa dibatalkan. |
| `crm_transaksi` | live-only, **0 baris**, tidak dirujuk `app/` maupun `lib/` | idem |

Modul Leads yang benar-benar dipakai adalah `leads` (M1, migrasi `0101`/`0330`/`0331`).
Bila sudah dipastikan tak terpakai:

```sql
drop table if exists crm_transaksi;
drop table if exists crm_leads;
```

## Catatan: drift perilaku, bukan hanya struktur

Perbandingan sidik jari di atas hanya melihat **kolom**. Fungsi, trigger, dan RLS bisa
menyimpang tanpa terdeteksi olehnya. Satu contoh nyata yang ditemukan pada audit yang
sama: `brand_deals.poin` dihitung trigger dari `visit_checked` + `kreator_realized`,
tetapi tidak ada satu pun baris kode aplikasi yang menulis kolom-kolom itu — yang
benar-benar diisi tim adalah `poi_sop_progress.actual_vt`. Struktur cocok, perilaku
tidak. Untuk hal seperti ini, bandingkan `pg_get_functiondef` / `pg_get_triggerdef`
antara reset lokal dan live secara manual saat menyentuh modul terkait.
