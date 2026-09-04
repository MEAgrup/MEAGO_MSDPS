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
# ✅ 71 migrasi lolos dari nol (database msdps_reset, port 55432)
```

Butuh paket `postgresql` lokal (`psql` + `initdb`). Skrip membuat cluster sementara,
memasang stub minimal lingkungan Supabase (`auth.uid()`, role `anon`/`authenticated`,
`pg_cron`, `storage.buckets`), lalu menjalankan seluruh `supabase/migrations/*.sql`
berurutan. Keluar bukan-nol pada file pertama yang gagal, lengkap dengan pesan ERROR-nya.

Ini menguji **bisa-tidaknya** rantai dijalankan — bukan kesetaraan dengan production.

## Membandingkan dua database (`scripts/schema_fingerprint.sql`)

`pg_test_reset.sh` hanya menjawab "rantai migrasi BISA jalan dari nol". Ia tidak tahu
apa-apa soal apakah staging setara production — dan justru di celah itulah drift
2026-09-04 bersembunyi (lihat bagian di bawah). Prosedur perbandingan versi lama di
dokumen ini juga hanya melihat **kolom**, sehingga constraint, RLS policy, fungsi,
trigger, bucket Storage, dan job pg_cron bisa menyimpang tanpa terdeteksi.

`scripts/schema_fingerprint.sql` menutup keduanya: satu kueri, satu baris per objek,
formatnya `kind|nama|hash`. Cakupannya: kolom, constraint, index, RLS policy, status
RLS per tabel, fungsi (`pg_get_functiondef`, jadi SECURITY DEFINER & `search_path` ikut
terbandingkan), trigger, view (termasuk `security_invoker`), enum, bucket Storage, job
pg_cron, dan daftar nama migrasi yang tercatat.

Ambil sidik jari tiap sisi, lalu diff:

```bash
# hasil reset lokal
psql -h /tmp -p 55432 -U postgres -d msdps_reset -tAq \
  -f scripts/schema_fingerprint.sql | LC_ALL=C sort > /tmp/fp_local.txt

# staging & production: jalankan isi file yang sama lewat MCP Supabase
# (execute_sql) pada vgjzvdpxrdoefoncuazw dan mvcckptntrvzujqaoxxh, simpan
# keluarannya satu baris per objek.

LC_ALL=C diff /tmp/fp_staging.txt /tmp/fp_prod.txt
```

- baris yang hanya ada di satu sisi → objek hilang / kelebihan
- nama sama, hash beda → definisinya menyimpang

Untuk keluaran yang lebih ringkas saat pertama menyisir, bandingkan dulu agregat per
`kind` (11 baris, bukan ~780) dan baru turun ke `kind` yang hashnya beda:

```sql
-- bungkus CTE `fp` dari scripts/schema_fingerprint.sql dengan ini
select kind, count(*) as n,
       md5(string_agg(kind||'|'||name||'|'||hash, '~' order by name)) as kind_hash
  from fp group by kind order by kind;
```

`pg_test_reset.sh` sekarang juga mencatat setiap file migrasi yang berhasil ke stub
`supabase_migrations.schema_migrations`, dan stub `cron.schedule()` benar-benar menulis
ke tabel `cron.job` (bukan lagi fungsi yang membuang argumennya). Jadi baris `migration|…`
dan `cron_job|…` pada sidik jari hasil reset bisa langsung dibandingkan dengan live —
inilah yang menjawab pertanyaan "migrasi mana yang belum masuk ke environment ini".

**Peringatan soal nama migrasi:** nama yang tercatat di `schema_migrations` tidak
konsisten antar-environment (production menyimpan `poi_sop_tracking`, staging
`0336_poi_sop_tracking`, ada juga era `phase0_0001_extensions` / `faseB_02_module1_leads`).
Bandingkan setelah memangkas prefiksnya, mis.
`regexp_replace(name, '^[0-9]{4}[a-z]?_|^phase0_[0-9]{4}[a-z]?_|^fase[BC]_[0-9]{2}_', '')`.
Dan riwayat itu **tidak bisa dipercaya sendirian** — production punya kolom/bucket/job
milik `0315_weekly_retention_dedup` tanpa pernah mencatat migrasinya. Selalu konfirmasi
dengan sidik jari struktur, bukan cuma daftar nama.

## Status terakhir (2026-09-04, setelah 0349 + 0350 & perbaikan staging)

- Rantai migrasi: **71 file, lolos dari nol** (`bash scripts/pg_test_reset.sh`).
- Paritas staging ↔ production: identik pada kolom, constraint, RLS policy, fungsi,
  trigger, view, enum, bucket Storage, dan job pg_cron — kecuali tiga objek yang
  dicatat sebagai "drift yang masih terbuka" di bagian temuan 2026-09-04 di bawah.
- Sisa selisih repo ↔ live yang diketahui & disengaja:

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

## Temuan 2026-09-04: staging kehilangan 12 migrasi — SUDAH DIPERBAIKI

Ditemukan saat menindaklanjuti `docs/HANDOFF_FaseG.md`. Handoff itu mencatat gejalanya
(`0342_poi_notes.sql` gagal di staging: `relation "poi_sop_progress" does not exist`)
tapi **diagnosisnya keliru** — disebut "staging punya riwayat migrasi yang mencatat
`poi_sop_tracking` sebagai sudah diterapkan". Yang sebenarnya terjadi: staging tidak
pernah mencatat maupun menerapkan migrasi-migrasi itu sama sekali.

Terverifikasi lewat `supabase_migrations.schema_migrations` + `information_schema.tables`
kedua environment. Yang hilang di staging:

| Migrasi | Akibatnya di staging |
|---|---|
| `0315_weekly_retention_dedup` | 3 kolom `upload_batches` (`file_hash_full`, `archive_path`, `archive_deleted_at`), bucket `weekly-archives`, fungsi `mcn_purge_expired_weekly_data()`, job cron `msdps_retention_monthly` — semuanya tidak ada |
| `0330_leads_bd_intake` | kolom intake BD `leads`, 5 nilai enum `lead_source`, partial unique index nomor HP |
| `0331_leads_crm_pipeline` | `lead_business_types`, `lead_benefit_options`, seluruh kolom alur status CRM, policy `leads_delete` |
| `0332_deal_transactions` | `brand_deals.unique_id`/`lead_id`/`ops_name`/tanggal kontrak/`total_jam_live` |
| `0333_deal_transaction_validate` | `brand_deals_validate()` versi lama (blok wajib POI belum selaras) |
| `0334`, `0335` | policy delete (`brand_deals`, `prospect_attempts`) |
| `0336_poi_sop_tracking` | `poi_sop_progress`, `poi_sop_steps` |
| `0337_poi_dining_sop_tracking` | `poi_dining_cycles`, `poi_dining_steps` |
| `0338_lead_status_history` | `lead_status_history` |
| `0342_poi_notes`, `0343_poi_sla_settings` | kolom `notes` POI, `poi_sla_settings` (gagal karena prasyarat 0336/0337 tak ada) |

Diperbaiki dengan menerapkan kedua belas file itu ke staging **berurutan nomor**, memakai
isi file dari repo (bukan SQL karangan baru). Dua penyesuaian yang perlu, keduanya
membungkus DDL yang tidak idempoten:

- `0332`: `add constraint brand_deals_ops_name_check` / `bentuk_kerjasama_check` /
  `nominal_harga_check` dibungkus `do $$ … exception when duplicate_object then null; end $$;`
- `0315`: `select cron.schedule(...)` dibungkus guard `if not exists (select 1 from cron.job where jobname = …)`

Urutannya penting dan aman: `0334` (create policy `brand_deals_delete` dengan guard
`duplicate_object`) jadi **no-op** karena `0341_deals_edit_delete_director_only` sudah
lebih dulu ada di staging, sehingga rekonsiliasi RLS `0348` **tidak** tertimpa —
dikonfirmasi ulang lewat `pg_policies` setelah selesai. `0332` memuat
`delete from brand_deals;`; aman karena `brand_deals` staging 0 baris (dicek dulu).

### Verifikasi sesudahnya (staging vs production)

| Aspek | Hasil |
|---|---|
| Kolom per tabel | identik untuk **seluruh** tabel bersama |
| Constraint (definisi, per tabel) | identik, kecuali `creator_video_gmv` (lihat sisa drift) |
| RLS policy (nama/cmd/qual/with check) | identik |
| Fungsi (106 signature) | daftarnya identik byte-per-byte |
| Trigger | 147 di kedua sisi, sidik jari sama |
| View | 21 di kedua sisi, nama identik |
| Enum | 158 label, sidik jari sama |
| Bucket Storage | 3 di kedua sisi (`campaign-proofs`, `creator-reports`, `weekly-archives`) |
| Job pg_cron | 4 di kedua sisi |

### Drift yang MASIH terbuka (bukan bagian dari perbaikan ini)

Keduanya **staging-lebih-maju**, berasal dari migrasi yang hanya pernah ada di staging
dan tidak punya file di repo — jadi `db reset` maupun production tidak memilikinya.
Butuh keputusan (dipakai atau dibuang), bukan sekadar apply:

| Objek | Keadaan | Migrasi staging-only yang membuatnya |
|---|---|---|
| `acquisitions` (18 kolom vs 14 di prod) + policy `acquisitions_delete` | staging-lebih-maju | `0317_acquisition_extra_fields`, `0318_acquisition_delete_policy` |
| `acquisition_followups` (tabel + 2 policy) | staging-only | `0319_acquisition_followups` |
| `creator_video_gmv` (23 kolom vs 16 di prod) | staging-lebih-maju | `0317_gmv_video_weekly_tracking_fix`, `0318_gmv_video_per_creator_week`, `0320_gmv_video_weekly` |

Perhatikan nomornya bertabrakan dengan `0317_gmv_video_weekly_tracking` /
`0318_auth_users_token_null_guard` / `0320_brand_deals_poi_reconcile` yang ada di repo —
kelas masalah yang sama dengan tabrakan `0341`-`0343` pada Fase G.

### Drift repo ↔ production yang ikut ketemu — SUDAH DIPERBAIKI (`0350`)

`brand_deals_ops_name_check` di production menerima `'Fifas'`; riwayat production
mencatatnya sebagai `0336_ops_name_add_fifas` (2026-08-31) tapi **file migrasinya tidak
pernah ada di repo**. Jadi hasil `db reset` lebih ketat dari production — form
"Daftarkan Transaksi" akan menolak ops `Fifas` di environment baru padahal production
menerimanya. `0350_brand_deals_ops_name_fifas.sql` merekonsiliasinya (idempoten, no-op
di production) dan sudah diterapkan ke staging + production.

Nomor `0350` dipakai karena `0349` sudah diklaim `0349_deal_change_requests.sql` (PR #30,
sesi paralel yang berjalan bersamaan dengan sesi ini) — dicek lewat riwayat migrasi kedua
environment **dan** `git log`/branch remote sebelum memilih nomor.

## Catatan: drift perilaku, bukan hanya struktur

Perbandingan sidik jari di atas hanya melihat **kolom**. Fungsi, trigger, dan RLS bisa
menyimpang tanpa terdeteksi olehnya. Satu contoh nyata yang ditemukan pada audit yang
sama: `brand_deals.poin` dihitung trigger dari `visit_checked` + `kreator_realized`,
tetapi tidak ada satu pun baris kode aplikasi yang menulis kolom-kolom itu — yang
benar-benar diisi tim adalah `poi_sop_progress.actual_vt`. Struktur cocok, perilaku
tidak. Untuk hal seperti ini, bandingkan `pg_get_functiondef` / `pg_get_triggerdef`
antara reset lokal dan live secara manual saat menyentuh modul terkait.
