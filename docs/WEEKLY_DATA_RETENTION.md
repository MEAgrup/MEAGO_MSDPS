# Lifecycle Data Mingguan MCN — Upload, Arsip, Purge

Dokumentasi mekanisme ingest, retensi, dan purge data performa mingguan kreator MCN. Desain final mengikuti prinsip drop-raw: file mentah tidak persisten, hasil agregat disimpan terbatas 6 bulan, arsip tersentralisasi di Storage.

---

## 1. Upload & Proses (Process-on-Ingest)

User upload file CSV/XLSX performa mingguan di workspace `/meago/workspace` atau `/meago/creators` (upload handler).

- File dibaca ke memori, di-parse, diagregasi ke **3 tabel hasil**: `creator_period_summary`, `creator_subcat_segment_gmv`, `creator_top_products`
- **Mentah tidak pernah disimpan**: request selesai → file otomatis hilang (tidak ke DB, tidak ke Storage)
- Header batch dicatat di `upload_batches` dengan kolom:
  - `batch_id = ingest:<period_start>:<hash8>` (unique identifier)
  - `file_hash_full` (sha256 penuh untuk deteksi duplikat)
  - Timestamp ingest, status, path arsip

---

## 2. Arsip Render (Storage Privat, 6 Bulan)

Setelah ingest sukses, hasil olahan dirender jadi JSON dan disimpan ke Storage:

- **Bucket**: `weekly-archives` (privat, akses hanya service-role)
- **Path**: `<period_start>/<hash8>.json` (misal: `2026-01-06/a1b2c3d4.json`)
- Path dicatat di `upload_batches.archive_path` untuk referensi audit
- Berguna untuk restore data atau audit histori lengkap (sebelum masa purge berakhir)

---

## 3. Retensi 6 Bulan (Configurable)

Durasi default 6 bulan diatur di `app_config` key `mcn.retention_months` (dapat diubah runtime).

Dua mekanisme saling melengkapi:

1. **pg_cron bulanan** (`msdps_retention_monthly`)
   - Jalankan fungsi `mcn_purge_expired_weekly_data()`
   - Hapus baris 3 tabel agregat dengan `period_start < cutoff`
   - Catatan: pg_cron **tidak bisa** menghapus objek Storage fisik — hanya DB

2. **Sweep di tiap ingest sukses**
   - Hapus baris agregat kedaluwarsa + hapus objek arsip Storage kedaluwarsa (admin client)
   - Tandai `upload_batches.archive_deleted_at` sebagai soft-delete audit trail
   - Header `upload_batches` dipertahankan **selamanya** sebagai lightweight audit log

---

## 4. Deteksi Duplikat & Revisi

### Duplikat File
- SHA256 penuh disimpan di `upload_batches.file_hash_full`
- Upload file identik yang sudah berstatus `processed` → **DITOLAK** dengan pesan berisi periode dan waktu upload sebelumnya
- Checkbox "Proses ulang jika file duplikat" → override (idempoten: periode itu di-replace, tidak dobel)

### Revisi Data
- File **berbeda** untuk periode sama = revisi: replace data **scoped per (creator × minggu)**
- Periode **tumpang tindih** dengan batch lain → DITOLAK (overlap guard)

---

## 5. Catatan & Batasan

1. **Rata-rata GMV bulanan master kreator** = dihitung dari histori tersisa di DB
   - Setelah purge: basis hanya jendela 6 bulan berjalan
   - Kalkulasi otomatis reflect data yang masih aktif

2. **pg_cron harus diaktifkan** dari Dashboard Supabase
   - Cek status cron jobs di Extensions atau Dashboard
   - Tanpa cron, hanya sweep saat ingest yang aktif

3. **Arsip yang dipurge tidak dapat dipulihkan**
   - Rencana jangka panjang: download arsip sebelum kedaluwarsa, atau naikkan `mcn.retention_months`
   - Pertimbangkan compliance/audit trail sebelum menurunkan durasi retensi
