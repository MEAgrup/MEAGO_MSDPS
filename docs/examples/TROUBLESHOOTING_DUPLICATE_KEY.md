# 🔧 Troubleshooting: "duplicate key value violates unique constraint"

## Error Pesan Lengkap
```
Gagal membuat kreator baru: duplicate key value violates unique constraint 
"mcn_creators_platform_username_uniq"
```

---

## Apa Artinya?

Username kreator **sudah ada** di database atau ada **duplikat dalam file**.

Constraint di database:
```sql
create unique index mcn_creators_platform_username_uniq
  on mcn_creators (platform, lower(username)) where username is not null;
```

Artinya:
- ✅ Username harus unik per platform (TikTok)
- ✅ Case-insensitive (@ SitiSaleha = @sitisaleha)
- ❌ Tidak boleh ada 2+ kreator dengan username sama

---

## 🎯 3 Skenario Penyebab Error

### Skenario 1️⃣: Username Sudah Ada dari Upload Sebelumnya

**Tanda-tanda:**
- Anda upload file dengan kreator yang sama seperti minggu lalu
- Pesan error saat insert kreator baru

**Solusi:**
✅ Gunakan checkbox **"Proses ulang jika file duplikat"** saat upload:
```
☑ Proses ulang jika file duplikat
  (Force reprocess jika file sama periode sebelumnya)
```

Atau update data kreator lama dengan tambahkan kolom `username` ke kreator yang belum punya (via database).

---

### Skenario 2️⃣: Username Duplikat dalam File Sendiri

**Contoh file bermasalah:**

| Creator name | Creator ID | Sales value | Orders |
|---|---|---|---|
| Siti Saleha | @sitisaleha_beauty | 15500000 | 324 |
| Siti S | @sitisaleha_beauty | 5000000 | 100 | ❌ DUPLIKAT! |

**Penyebab:** Kreator yang sama masuk 2x dalam 1 file (mungkin dari 2 laporan berbeda yang ter-merge)

**Solusi:**
1. Cek file Anda: apakah ada creator ID yang muncul >1x?
2. Jika ada: **gabungkan data mereka** (jumlahkan sales value, orders, dll)
3. Atau: **hapus baris duplikat**, pakai yg paling lengkap

**Cara cek di Excel/CSV:**
```
Filter → Creator ID → Sort A-Z → Lihat yang sama berdampingan
```

---

### Skenario 3️⃣: Spasi Tersembunyi atau Karakter Aneh

**Contoh file bermasalah:**

```
" @sitisaleha_beauty"   ← Spasi di depan
"@sitisaleha_beauty"    ← Normal
"@sitisaleha_beauty "   ← Spasi di belakang
"@sitisaleha_beauty\n"  ← Newline tersembunyi
```

**Cara cek:**
- Di Excel: Klik cell Creator ID → Lihat formula bar
- Di CSV: Text editor → Cari spasi/karakter aneh

**Solusi:**
- Gunakan **Trim** di Excel:
  ```excel
  =TRIM(A1)  ← Hapus spasi di depan/belakang
  ```
- Copy hasilnya → Paste as Value
- Ganti kolom original

---

### Skenario 4️⃣: Username Case Berbeda (Jarang)

Sistem case-insensitive, tapi jika ada error aneh:

```
@SitiSaleha     ← Kapital
@sitisaleha     ← Lowercase
```

**Solusi:**
- Gunakan **Lowercase** consistent untuk semua username
- Copy semua username → Paste as Value → Format Cells → Lowercase

---

## ✅ Checklist Pre-Upload

- [ ] **File Creator Analysis** (.xlsx dengan sheet "Filter" & "Data")
- [ ] **Kolom "Creator ID"**: Penuh, tidak ada yang kosong
- [ ] **Setiap Creator ID unik** dalam file (tidak ada duplikat)
- [ ] **Creator ID bersih**: Tidak ada spasi di depan/belakang
  - Tip: Gunakan TRIM() di Excel
- [ ] **Format Creator ID konsisten**: Semua lowercase atau capital (pilih 1)
- [ ] **Periode W1-W5**: Jatuh dalam salah satu window (tgl 1-7, 8-14, dll)
- [ ] Jika creator sudah ada sebelumnya: ✓ Centang "Proses ulang jika file duplikat"

---

## 🚀 Langkah-Langkah Fix

### Step 1: Identifikasi Masalah
```
File Anda: creator-data.xlsx

Buka Sheet "Data"
↓
Cek kolom "Creator ID" (column B)
↓
Apakah ada value yang:
  - Kosong?
  - Duplikat (muncul >1x)?
  - Punya spasi/karakter aneh?
↓
Jika ada: Bersihkan
```

### Step 2: Bersihkan Data

#### 2a. Hapus duplikat username
- Cek setiap Creator ID apakah muncul lebih dari 1x
- Jika duplikat:
  - Gabungkan data mereka (jumlahkan angka)
  - Atau hapus baris yg datanya kurang lengkap

#### 2b. Trim spasi
Di Excel (insert kolom helper):
```excel
Column B (asli): Creator ID
Column C (helper): =TRIM(B2)

Hasilnya copy → Paste as Value ke B2
Delete column C
```

#### 2c. Normalize case
Semua username lowercase:
```excel
=LOWER(B2)
Copy → Paste as Value
```

### Step 3: Verifikasi Sebelum Upload
```
1. Open file Anda
2. Select kolom Creator ID
3. Data → Remove Duplicates (atau Manual check)
4. Cek tidak ada duplikat
5. Upload ulang
```

---

## 📞 Debugging dengan Admin

Jika masih error setelah langkah di atas, hubungi admin dengan:

**Informasi yang perlu:**
1. **List creator ID yang Anda upload:**
   ```
   @sitisaleha_beauty
   @budifashion
   @rinacooking
   ```

2. **Error message lengkap** (copy-paste dari form)

3. **Periode upload:** 15-21 Juli 2024 (contoh)

4. **File sudah pernah diupload sebelumnya?** Ya / Tidak

**Admin bisa:**
- Cek di database apakah username sudah ada
- Lihat constraint error detail
- Clean up duplikat jika ada

---

## 📚 Referensi

- File: `/lib/actions/mcn-ingest.ts` line 707
- Constraint: `mcn_creators_platform_username_uniq`
- Migration: `supabase/migrations/0309_creator_analysis.sql`
- Table: `mcn_creators` (kolom `username`, `platform`)

---

## 🎁 Template File Bersih

Gunakan template:
- `creator-weekly-upload-example.xlsx` (sudah bersih, copy + ganti data)

Pastikan:
- Username unik
- Tidak ada spasi
- Tidak ada duplikat
- Sheet names: "Filter" & "Data" (exact case)
