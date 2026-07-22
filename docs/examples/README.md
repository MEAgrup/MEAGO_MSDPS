# 📊 Contoh Data Upload Mingguan Kreator

Folder ini berisi contoh data dan dokumentasi lengkap untuk upload data mingguan kreator di MEAGO MCN.

## 📁 File-file yang Tersedia

### 1. **creator-weekly-upload-format.md** (📖 BACA DULU)
Dokumentasi lengkap berisi:
- Penjelasan 2 format upload (Creator Analysis vs Legacy)
- Kolom/header yang diperlukan untuk setiap format
- Contoh data konkret untuk masing-masing format
- Aturan validasi penting (periode W1-W5, null vs 0, dll)
- Cara penggunaan UI upload form

**👉 Mulai dari file ini untuk memahami struktur data.**

---

### 2. **creator-weekly-upload-example.xlsx** (✅ FORMAT RECOMMENDED)
File XLSX siap pakai dengan format **Creator Analysis** (native TikTok).

**Struktur:**
- **Sheet "Filter":** Periode awal-akhir (YYYYMMDD format)
- **Sheet "Data":** Tabel kreator dengan 14 kolom data

**Isi Contoh:**
- 5 kreator sampel (Siti Saleha, Budi Fashion, Rina Cook, Dina Beauty, Agus Tech)
- 1 minggu data (15-21 Juli 2024 = W3)
- Semua field lengkap (GMV, orders, AOV, redemption, live streams, posts, dll)

**Cara Pakai:**
1. Download file ini
2. Ganti data dengan data kreator Anda
3. Pastikan format tanggal YYYYMMDD (contoh: 20240715)
4. Upload melalui form `/meago/ingest` atau `/meago/creators`

**Tips:**
- Jangan ubah nama sheet ("Filter" & "Data")
- Jangan ubah urutan/nama kolom di sheet Data
- Kolom "Creator ID" harus unik (username)
- Periode harus jatuh dalam W1-W5

---

### 3. **creator-weekly-upload-legacy-format.csv** (LEGACY FORMAT)
File CSV dengan format **Per-Product** untuk breakdown detail per kategori.

**Struktur:**
- 1 baris = 1 produk per kreator per minggu
- 13 kolom data (product_id, shop_id, creator_name, category_l2, dll)

**Isi Contoh:**
- 10 baris (5 produk × 3 kreator dengan berbagai kategori)
- Format CSV standar dengan pemisah koma
- Tanggal dalam format YYYYMMDD-YYYYMMDD

**Cara Pakai:**
1. Download file ini (atau buka di Excel, ubah, lalu save as CSV)
2. Sesuaikan dengan data Anda (per-product breakdown)
3. Pastikan semua kolom terisi (tidak boleh ada yang kosong/null)
4. Upload sebagai CSV atau XLSX di form ingest

**Tips:**
- Support format date: YYYYMMDD-YYYYMMDD atau "tanggal" field lain
- Header bisa dalam Bahasa Indonesia atau English
- Nilai angka: support format Rupiah (1.000.000 atau 1000000)
- GMV harus dalam satuan terkecil (Rupiah)

---

### 4. **generate_example_xlsx.py** (Script Generator)
Script Python untuk membuat file XLSX contoh dari awal.

**Kegunaan:**
- Template untuk membuat XLSX dengan struktur yang benar
- Referensi kode jika ingin generate file XLSX secara otomatis

**Cara Pakai:**
```bash
python3 generate_example_xlsx.py
```

---

## 🚀 Quick Start - 3 Langkah

### Langkah 1: Pahami Format
Baca `creator-weekly-upload-format.md` section "Dua Format Upload"

### Langkah 2: Pilih Format & Ambil Contoh
- ✅ **Recommended:** Download `creator-weekly-upload-example.xlsx` (Creator Analysis)
- Alternative: Download `creator-weekly-upload-legacy-format.csv` (Legacy)

### Langkah 3: Upload Data
1. Ganti contoh data dengan data kreator Anda
2. Pastikan periode W1-W5 (1-7, 8-14, 15-21, 22-28, 29-end)
3. Upload file ke form di:
   - `/meago/ingest` - Upload form utama
   - `/meago/creators` - Upload form per kreator

---

## 📋 Checklist Sebelum Upload

- [ ] Format file: XLSX (Creator Analysis) atau CSV (Legacy)
- [ ] Tanggal dalam format YYYYMMDD (contoh: 20240715)
- [ ] Periode jatuh dalam window W1-W5 (tidak boleh spanning 2 minggu berbeda)
- [ ] Kolom header sesuai (jangan tambah/kurangi kolom)
- [ ] Data kreator: gunakan username yang konsisten (@ icon)
- [ ] Angka GMV: dalam Rupiah, tanpa simbol currency
- [ ] Tidak ada baris kosong atau summary row
- [ ] File belum pernah diupload sebelumnya (atau gunakan checkbox "Force reprocess")

---

## ✅ Data Sukses Upload - Contoh Respon

Setelah upload berhasil, sistem akan menampilkan:

```
✅ Ingest Berhasil

Batch ID: ingest:20240715:a1b2c3d4
File: creator-weekly-upload-example.xlsx
Status: Processed

📊 Statistik:
- Total baris diparse: 5
- Kreator berhasil: 5
- Rows dengan error: 0
- Durasi: 2.34 detik

🎯 Kreator Terproses:
1. @sitisaleha_beauty - GMV: Rp15.5M, Orders: 324
2. @budifashion - GMV: Rp8.75M, Orders: 182
3. @rinacooking - GMV: Rp22.3M, Orders: 465
4. @dinabeauty - GMV: Rp12.8M, Orders: 267
5. @agustech - GMV: Rp6.5M, Orders: 135

📥 Download Report: validation_20240715.csv
```

---

## ❓ FAQ

**Q: Bisa upload berkali-kali untuk periode yang sama?**
A: Tidak, duplikat otomatis terdeteksi. Gunakan checkbox "Proses ulang jika file duplikat" untuk override.

**Q: Format tanggal harus selalu YYYYMMDD?**
A: Ya, untuk Creator Analysis harus YYYYMMDD (20240715). Legacy bisa lebih fleksibel.

**Q: Gimana kalau ada data yang null/kosong?**
A: Kosong = "—" (tidak dihitung). Angka 0 = valid (distinct dari kosong).

**Q: Bisa upload file besar?**
A: Ya, sistem support upload hingga 10,000 baris per file.

**Q: Jika ada error, apa yang terjadi?**
A: Upload ditolak di validation stage, detail error ditampilkan di form (row mana, kolom apa, masalahnya apa).

---

## 📞 Bantuan

Jika ada pertanyaan atau menemukan data yang tidak sesuai, silakan hubungi tim MEAGO MCN.

**Terakhir diupdate:** 22 Juli 2024
**Format Version:** 1.0
