# Panduan Format Upload Data Mingguan Kreator

## Dua Format Upload yang Didukung

Sistem mendukung 2 format upload data mingguan kreator:

### ✅ Format 1: Creator Analysis (Recommended) - XLSX

**Deskripsi:** Format native TikTok yang paling direkomendasikan. File berisi 2 sheet: "Filter" dan "Data".

**Keuntungan:**
- Struktur standar TikTok Creator Analytics
- Auto-sync binding status dan city info
- Support metrics lengkap (AOV, redemption, live streams, dll)

**File:** `creator-weekly-upload-example.xlsx`

#### Sheet 1: Filter
| Kolom | Format | Contoh | Keterangan |
|-------|--------|--------|-----------|
| Start Date | YYYYMMDD | 20240715 | Awal periode |
| End Date | YYYYMMDD | 20240721 | Akhir periode |
| Creator Level Filter | Text/Kosong | Creator Level | Optional |

**Contoh Sheet Filter:**
```
Start Date: 20240715
End Date: 20240721
Creator Level Filter: [KOSONG]
```

#### Sheet 2: Data (1 baris = 1 kreator per minggu)

| Kolom | Tipe | Contoh | Keterangan |
|-------|------|--------|-----------|
| Creator name | String | Siti Saleha | Nama display (bisa berubah) |
| Creator ID | String | @sitisaleha_beauty | **Username - Primary Key** |
| Binding status | String | Bound creators | null, "Bound creators", "Previously bound" |
| Creator city | String | Jakarta | Optional |
| Creator level | String | Creator Level 2 | Optional |
| Sales value | Number | 15500000 | GMV affiliate (Rupiah) |
| Orders | Number | 324 | Total pesanan |
| AOV | Number | 47840 | Average Order Value |
| Redemption amount | Number | 2400000 | GMV redemption (Rupiah) |
| Redeemed orders | Number | 45 | Pesanan dengan redemption |
| New posts | Number | 12 | Konten baru |
| Posts with sales | Number | 8 | Post yang ada penjualan |
| Live streams | Number | 6 | Total live streams |
| Valid live streams | Number | 5 | Live streams yang monetizable |

**Contoh Data (3 kreator):**
```
Creator name | Creator ID | Binding status | Creator city | Creator level | Sales value | Orders | AOV | Redemption amount | Redeemed orders | New posts | Posts with sales | Live streams | Valid live streams
Siti Saleha | @sitisaleha_beauty | Bound creators | Jakarta | Creator Level 2 | 15500000 | 324 | 47840 | 2400000 | 45 | 12 | 8 | 6 | 5
Budi Fashion | @budifashion | Bound creators | Surabaya | Creator Level 1 | 8750000 | 182 | 48076 | 1200000 | 28 | 15 | 10 | 4 | 3
Rina Cook | @rinacooking | Previously bound | Bandung | Creator Level 3 | 22300000 | 465 | 47957 | 3600000 | 52 | 18 | 14 | 8 | 7
```

---

### Format 2: Legacy Format - CSV/XLSX

**Deskripsi:** Format berbasis per-produk per kreator. Cocok untuk data detail dengan breakdown kategori.

**File:** `creator-weekly-upload-legacy-format.csv`

#### Kolom yang Diperlukan

| Kolom | Alias | Tipe | Contoh | Keterangan |
|-------|-------|------|--------|-----------|
| product_id | product_name | String | 123456 | ID atau nama produk |
| shop_id | shop_name | String | 987654 | ID atau nama toko |
| creator_name | creator_name | String | Siti Saleha | Nama kreator |
| category_l2 | category_l2 | String | Skincare | Sub-kategori |
| gmv | gmv | Number | 5500000 | GMV (Rupiah) |
| items_sold | items_sold | Number | 115 | Jumlah item terjual |
| orders | orders | Number | 95 | Total pesanan |
| live_gmv | live_gmv | Number | 3300000 | GMV dari live |
| video_gmv | video_gmv | Number | 2200000 | GMV dari video |
| refund_gmv | refund_gmv | Number | 275000 | GMV refund |
| ctr | ctr | Number | 0.08 | Click-Through Rate |
| ctor | ctor | Number | 0.05 | Click-to-Order Rate |
| tanggal / periode | periode | Date | 20240715-20240721 | Periode minggu (W1-W5) |

**Contoh Data (5 produk):**
```
product_id,shop_id,creator_name,category_l2,gmv,items_sold,orders,live_gmv,video_gmv,refund_gmv,ctr,ctor,tanggal
123456,987654,Siti Saleha,Skincare,5500000,115,95,3300000,2200000,275000,0.08,0.05,20240715-20240721
123457,987654,Siti Saleha,Makeup,4200000,88,75,2520000,1680000,210000,0.07,0.04,20240715-20240721
123458,987655,Siti Saleha,Fragrance,3800000,65,54,2280000,1520000,190000,0.06,0.03,20240715-20240721
789012,654321,Budi Fashion,Apparel,4100000,82,68,2050000,2050000,205000,0.09,0.06,20240715-20240721
789013,654321,Budi Fashion,Accessories,2650000,53,45,1325000,1325000,133000,0.07,0.04,20240715-20240721
```

---

## Aturan Validasi Penting

### ✅ Periode Harus W1-W5
Upload hanya diterima jika periode jatuh **tepat** dalam salah satu window:
- **W1:** Tanggal 1-7
- **W2:** Tanggal 8-14
- **W3:** Tanggal 15-21
- **W4:** Tanggal 22-28
- **W5:** Tanggal 29-akhir bulan

**Contoh VALID:**
- 20240715 - 20240721 ✓ (W3)
- 20240701 - 20240707 ✓ (W1)

**Contoh INVALID:**
- 20240710 - 20240720 ✗ (W2 + W3, spanning)
- 20240730 - 20240810 ✗ (2 bulan berbeda)

### ✅ Handling Null & Zero
- **Null/Kosong** → Ditampilkan sebagai "—" (tidak dihitung)
- **0 (nol)** → Valid (GMV tetap dihitung, avg_price menjadi null)
- Contoh: `items_sold=0` tapi `gmv=1000000` → GMV valid, harga per item = null

### ✅ Idempotency & Duplikat
- Sistem menggunakan `batch_id = ingest:<periodStart>:<hash8>`
- **Duplikat otomatis deteksi** berdasarkan file hash
- Gunakan checkbox **"Proses ulang jika file duplikat"** untuk force reprocess

### ✅ Auto-Create Kreator
- Jika kreator tidak ada di master, akan dibuat otomatis dengan status "aktif"
- Creator Analysis: Match berdasarkan **Creator ID (username)**
- Legacy format: Match berdasarkan **creator_name**

---

## UI Upload Form

**Lokasi:** `/meago/ingest` atau `/meago/creators`

**Input:**
1. **File Upload:** CSV atau XLSX
2. **Source Type:** Pilih "TikTok" (default)
3. **Checkbox:** "Proses ulang jika file duplikat" (opsional)
4. **Submit:** Klik "Upload & Process"

**Output:**
- Status processing (berapa baris parsed, berapa kreator, berapa error)
- Download hasil: CSV validation report

---

## File Contoh Siap Pakai

Dua file contoh tersedia di folder ini:
- `creator-weekly-upload-example.xlsx` - Format Creator Analysis (Recommended)
- `creator-weekly-upload-legacy-format.csv` - Format Legacy

**Cara menggunakan:**
1. Download salah satu file contoh
2. Sesuaikan dengan data Anda
3. Upload melalui form di `/meago/ingest`
