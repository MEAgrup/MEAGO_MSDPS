# Tutorial Penggunaan — Modul Campaign MEA GO

Dokumen ini adalah panduan lengkap penggunaan modul **Campaign** untuk tim internal
(SPV Creator Management / BizDev / Account (AM) / OD / Director). Ditulis dari kode
sumber yang berjalan hari ini (`app/(app)/meago/campaigns`, `lib/actions/*`,
migrasi Supabase `0341`–`0358`), bukan rencana — jadi kalau ada bagian yang berbeda
dari yang Anda lihat di layar, tandai dan laporkan sebagai temuan, jangan ikuti
dokumen ini secara membabi buta.

Referensi terkait:
- `docs/RUNBOOK_CAMPAIGN_PERTAMA.md` — prosedur menjalankan satu campaign uji
  end-to-end dengan data nyata (lebih ringkas, asumsi Anda sudah paham konsepnya).
- `docs/GLOSARIUM.md` — istilah umum MSDPS.

---

## 1. Alur besar (peta 9 langkah)

```
1. Buat campaign (Draft)
2. Aktifkan campaign (Draft → Aktif)
3. Kreator mendaftar lewat Portal Kreator
4. Tim mengurasi PENDAFTAR (approve/reject)
5. Kreator submit bukti (link video / bukti live)
6. Tim ingest export TikTok "Content Analysis › Video List"   ← upload file
7. Tim jalankan "Validasi Bukti" per campaign                  ← BUKAN upload, klik tombol
8. Tim buat & tutup "Batch Kurasi" (periode) → payout terbit
9. Finance memproses payout di /finance
```

Dua langkah yang paling sering tertukar — **Langkah 6 (upload file)**,
**Langkah 7 (klik Validasi)**, dan **Langkah 8 (Batch Kurasi)** — dibahas
mendalam di §6, §7, dan §8, karena itu yang jadi pertanyaan paling umum di tim.

---

## 2. Siapa boleh apa (role matrix)

Sumber kebenaran: `lib/campaign-access.ts` (cermin fungsi SQL `is_campaign_owner()` /
`is_campaign_staff()`, migrasi `0358`).

| Peran | Buat campaign / ubah budget & stage / ads spend | Kurasi pendaftar, ingest TikTok, validasi, batch kurasi | Lihat halaman `/meago/campaigns` |
|---|---|---|---|
| **OD / Director** | ✅ | ✅ | ✅ |
| **BizDev** (division) | ✅ | ✅ | ✅ |
| **CampaignSpecialist** (division, kalau ada) | ✅ | ✅ | ✅ |
| **SPV Creator Management** (division `CreatorManagement`, rank `lead`) | ✅ | ✅ | ✅ |
| **Staff Creator Management** (rank bukan `lead`) | ❌ | ❌ | ❌ (redirect ke `/dashboard`) |
| **Account (AM)** | ❌ | ✅ (dibatasi ke campaign yang jadi tanggung jawabnya sendiri — `operational_owner_id`) | ✅ |
| **Finance** | ❌ | ❌ | Lihat & proses payout di `/finance`, bukan di halaman campaign |
| **Kreator** (Portal Kreator) | ❌ | ❌ | Hanya `/kreator/campaign` — daftar & submit bukti untuk campaign yang tayang untuknya |

Catatan penting: AM **tidak** membuat campaign atau mengubah budget — dia hanya ikut
mengurasi pendaftar untuk campaign yang funding source-nya `brand` dan dia jadi AM
penerimanya. Kalau muncul redirect ke `/dashboard` saat membuka `/meago/campaigns`,
itu tandanya rank/divisi akun belum memenuhi tabel di atas — bukan bug.

---

## 3. Langkah 1–2 — Buat & aktifkan campaign

**Lokasi:** `/meago/campaigns` → tombol **"+ Campaign Baru"**.

### Field wajib saat membuat (`*`)
| Field | Catatan |
|---|---|
| Nama Brand / Campaign | Bebas, tapi jelas — akan jadi identitas campaign di semua laporan |
| **Funding Source** | `internal` (Budget Internal) → tim operasional otomatis `CreatorManagement` kalau dibuat SPV CM, atau `CampaignSpecialist` untuk yang lain. `brand` (Budget Brand) → **wajib pilih AM Penerima** |
| **Track** | `video` atau `live` — menentukan jenis bukti yang diterima nanti (§5) dan cara hitung "completed" di §8 |
| **Base Fee / kreator (Rp)** | Boleh `0`, **tidak boleh kosong**. Ini nominal FLAT per kreator, bukan dibagi rata dari budget |
| **Kuota Kreator** | Jumlah slot yang boleh di-approve di kurasi pendaftar (§4) |
| **Creator Budget (Rp)** | Plafon total. Sistem hitung `alokasi = base_fee × kuota kreator`; kalau alokasi > creator budget → **Over Budget**, wajib isi alasan, dan hanya **Lead ke atas** yang boleh tetap mengaktifkan |

### Field opsional yang penting
- **Target Location ID (TikTok)** — **wajib diisi sebelum aktivasi**. Ini **TikTok Location ID** merchant, BUKAN `shop_id`, bukan nama merchant. Salah isi field ini = validasi di Langkah 7 akan gagal total dengan verdict `merchant_tidak_sesuai` atau `tidak_ditemukan`. Cara ambil Location ID yang benar: dari export TikTok "Content Analysis › Video List" milik merchant terkait, atau dari tim yang pegang akses TikTok Seller/Partner Center.
- **Window Post Mulai/Selesai** — kalau diisi, post yang tanggalnya di luar rentang ini otomatis dapat verdict `di_luar_periode` saat validasi (§7).
- **Deadline Submit Bukti** — informasi ke kreator, tidak mengunci submission secara otomatis.
- **Segmentasi Kelayakan Pendaftar** (`details` yang bisa dibuka/tutup) — filter siapa yang **melihat** campaign ini di Portal Kreator: industry, kota, level, jenis kreator, roster status, status kontrak, ambang GMV. **Follower TIDAK dipakai sebagai filter** (keputusan terkunci).

  ⚠️ **Peringatan operasional** (dari `docs/RUNBOOK_CAMPAIGN_PERTAMA.md`): di data production hari ini kolom `eligible_*` di kreator sebagian besar KOSONG. Mengisi salah satu filter ini bisa membuat hampir nol kreator lolos, dan gejalanya membingungkan — campaign aktif tapi tidak muncul di portal siapa pun. Kalau campaign ditujukan untuk semua kreator MCN (bukan segmen khusus), **kosongkan semua field di sini**. Field kosong = tidak difilter.

### Aktivasi (Draft → Aktif)
Di halaman detail campaign (`/meago/campaigns/[id]`) → dropdown **"Ubah Stage"**.
Sistem menolak aktivasi (`enforce_campaign_stage_transition`, migrasi `0342`) selama
salah satu ini masih kosong, dan UI menampilkan daftarnya:
- Funding source, Track, Tim operasional, Base fee, Kuota kreator, Creator budget,
  Target Location ID.

Transisi ke `cancelled` (dari status manapun) butuh wewenang **Lead ke atas**.

Hanya campaign dengan `campaign_stage = 'active'` yang tampil di Portal Kreator.

---

## 4. Langkah 3–4 — Pendaftaran & kurasi pendaftar

**Kreator** login ke Portal Kreator → menu **Campaign** (`/kreator/campaign`) →
campaign yang lolos filter segmentasi (§3) muncul di daftar → klik **Daftar**.
Status awal: **"Menunggu Kurasi"**.

**Tim** (lihat matriks §2) buka `/meago/campaigns/[id]` → card **"Pendaftar (N)"** →
untuk tiap baris berstatus "Menunggu Kurasi": klik **Setujui** atau **Tolak**
(alasan penolakan **wajib diisi**).

Aturan yang digerbang DB (bukan bisa dilewati dari UI):
- Jumlah yang **Disetujui** dibatasi oleh **Kuota Kreator** campaign (ditampilkan
  sebagai "Disetujui: X/kuota" di atas tabel). Kalau kuota penuh, approve
  berikutnya ditolak dengan pesan jelas dari DB.
- Hanya yang berstatus **Disetujui** yang boleh mengirim bukti deliverable (§5).

Ini disebut **"kurasi pendaftar"** — berbeda dari **"Batch Kurasi"** di §8. Kedua
istilah sama-sama pakai kata "kurasi" tapi objeknya beda: yang ini menyaring
*siapa yang boleh ikut*, yang di §8 menutup *periode pembayaran*.

---

## 5. Langkah 5 — Kreator submit bukti

Kreator kembali ke `/kreator/campaign`, untuk campaign yang statusnya **Disetujui**:
- **Track video** → form **"Submit Bukti Video"**: isi link video TikTok
  (`https://www.tiktok.com/@.../video/...`) + screenshot opsional.
- **Track live** → form **"Submit Bukti Live"**: tanggal live, durasi (menit),
  link bukti/replay opsional + screenshot opsional.

Kreator boleh **Hapus** submission miliknya sendiri sebelum divalidasi. Semua
submission yang masuk tampil ke tim di card **"Bukti Deliverable"** pada halaman
detail campaign.

---

## 6. Langkah 6 — Ingest export TikTok (INI YANG "UPLOAD FILE")

**Lokasi:** `/meago/campaigns` (halaman **daftar** campaign, bukan halaman detail
per-campaign) → card paling bawah **"Ingest Export TikTok"** → form **"Upload &
Proses"**.

### Apa yang harus diupload
File **"Content Analysis › Video List"** asli dari TikTok (format `.xlsx`/`.xls`),
diambil dari akun TikTok Seller/Partner Center milik merchant. Parser
(`lib/mcn/content-analysis.ts`) memvalidasi kolom yang wajib ada: **Post ID**,
**Location ID**, **Creator ID** (dan sejumlah kolom performa lain: views, GMV,
CTR, dst).

### Apa yang TERJADI saat upload — **ini jawaban untuk pertanyaan "upload file = validasi konten?"**

**Tidak.** Upload di sini **hanya mengisi index GLOBAL** (tabel
`tiktok_post_index`), **belum memvalidasi bukti campaign manapun**. Ini
disengaja, bukan langkah yang terlewat — alasannya ditulis di komentar migrasi
`0346`:

> Satu file export TikTok berisi post dari BANYAK campaign/merchant sekaligus,
> dan post yang sama muncul lagi di export minggu berikutnya dengan angka
> GMV/views yang bertambah (kumulatif). Index di-upsert per `post_id` (angka
> terbaru menang) — **merchant mana yang berhak atas post tertentu diputuskan
> saat VALIDASI, bukan saat ingest.**

Jadi upload file ini setara "menyetor data mentah ke gudang", bukan "mencocokkan
siapa dapat apa". Yang mencocokkan adalah langkah terpisah di §7, dan itu harus
**dijalankan manual per campaign** — tidak otomatis setelah upload.

### Yang perlu diperhatikan saat upload
- Kolom kunci untuk pencocokan nanti adalah **`Location ID`**, BUKAN kolom
  `Merchant` (itu daftar OTA/ads-related, bukan identitas lokasi) dan BUKAN
  `Location name` (satu Location ID kadang punya dua ejaan nama berbeda).
- Ingest **tidak membuat kreator baru** di sistem — satu file export bisa
  memuat ratusan kreator yang bukan anggota MCN MEA. Kalau username kreator di
  file tidak dikenali sistem, itu memang seharusnya begitu, bukan bug.
- Boleh diupload berkali-kali (idempoten per `post_id` — data terbaru menimpa
  yang lama). Upload file minggu ini tidak menghapus data minggu lalu untuk
  `post_id` yang berbeda.
- Kalau file ditolak dengan pesan format salah, cek dulu kolom **Post ID**,
  **Location ID**, **Creator ID** ada dan sesuai nama header aslinya dari TikTok
  — jangan diedit manual di Excel sebelum upload.

---

## 7. Langkah 7 — "Validasi Bukti" (INI YANG BENAR-BENAR MENGECEK KONTEN)

**Lokasi:** `/meago/campaigns/[id]` (halaman **detail** campaign yang bersangkutan)
→ card **"Bukti Deliverable"** → tombol **"Validasi Bukti dari Export TikTok"**.

Ini **RPC** (`validate_campaign_posts`, migrasi `0346`), dipanggil per campaign,
dan **inilah** langkah yang benar-benar mencocokkan tiap submission kreator
terhadap index global yang sudah masuk dari §6. Jalankan tombol ini **setelah**
upload file di §6 — kalau belum pernah upload file yang relevan, hasil validasi
akan penuh `tidak_ditemukan`.

### Urutan pemeriksaan (prioritas TETAP, tidak bisa diubah dari UI)
Tiap submission dicek satu per satu, berhenti di kondisi pertama yang cocok:

| Urutan | Verdict | Artinya |
|---|---|---|
| 1 | **Tidak Ditemukan** | `post_id` submission tidak ada di index global — file export yang relevan belum pernah diupload, atau link post-nya salah |
| 2 | **Di Luar Periode** | Tanggal post ada di index, tapi di luar `Window Post Mulai`–`Selesai` campaign |
| 3 | **Merchant Tidak Sesuai** | `Location ID` post ≠ `Target Location ID` campaign |
| 4 | **Bukan Milik Kreator** | Username kreator di post index ≠ username kreator yang terdaftar sebagai pemilik submission |
| 5 | **Ditolak TikTok** | Status post di TikTok sendiri = `invalid` |
| 6 | **Duplikat** | Post yang sama sudah dipakai submission lain |
| 7 | **Valid** | Lolos semua pemeriksaan di atas |

### Cara membaca hasil
- Boleh diklik berulang kali — **idempoten**, verdict lama ditimpa verdict
  terbaru berdasarkan isi index saat itu (misalnya setelah upload file baru).
- Kalau **semua** submission jadi `tidak_ditemukan`, itu **hampir selalu** berarti:
  (a) salah `Target Location ID` saat setup campaign (§3), atau (b) file export
  yang diupload beda periode/merchant — **bukan bug validator**. Cek dua hal itu
  dulu sebelum melapor sebagai error sistem.
- Hasil per submission tampil sebagai badge warna di tabel "Bukti Deliverable":
  hijau = Valid, merah = ditolak dengan berbagai alasan, abu-abu = belum
  ditemukan, kuning = di luar periode.
- Ringkasan angka (GMV, views, ROAS) dari post yang **Valid** saja bisa dilihat
  di card **"Hasil Campaign"** pada halaman yang sama.

---

## 8. Langkah 8 — Batch Kurasi (tutup periode → payout terbit)

**Lokasi:** `/meago/campaigns/[id]` → card **"Batch Kurasi"** (di bawah card
Bukti Deliverable).

### Apa itu "Batch Kurasi" — **jawaban untuk pertanyaan "batch kurasi ini maksudnya apa?"**

**Batch Kurasi = periode formal pembayaran per campaign.** Ini **bukan** kurasi
pendaftar (§4) dan **bukan** validasi bukti (§7) — dua hal itu sudah selesai
lebih dulu. Batch kurasi adalah wadah yang:

1. **Dibuat** sebagai draft dengan rentang tanggal (**Periode Mulai** – **Periode
   Selesai**) — murni label periode, tidak otomatis memfilter data by tanggal itu.
2. Selama masih **draft**, sistem menghitung **preview**: berapa kreator yang
   "completed" dan totalnya berapa Rupiah — ini yang tampil sebagai teks
   *"Preview: N kreator completed, total Rp X"* di atas tombol **Tutup Periode**.
3. Saat tombol **"Tutup Periode"** diklik → status berubah **closed** →
   sistem **mengunci** hasil itu menjadi baris-baris **payout** (tabel
   `campaign_payouts`) yang otomatis masuk ke antrian **`/finance`**.

Definisi **"completed"** (berhak dibayar), persis sama di preview maupun saat
ditutup:
1. Status pendaftaran = **Disetujui** (hasil kurasi §4), DAN
2. Punya minimal satu bukti sesuai track campaign:
   - **video** → minimal satu submission video yang **bukan duplikat**
     (verdict validasi §7 tidak wajib `valid` murni — cek kode: syaratnya
     `is_duplicate = false`, jadi pastikan validasi §7 sudah dijalankan supaya
     status duplikat/verdict-nya akurat sebelum menutup batch),
   - **live** → minimal satu submission live (apa pun),
3. **Belum pernah dibayar** di batch lain untuk campaign yang sama — satu
   kreator hanya dibayar **sekali** per campaign, seumur hidup campaign itu,
   lintas batch manapun (**no double-pay**, tidak bisa diakali dengan buka batch
   baru).

Nominal per kreator = **`base_fee` flat** (bukan `creator_budget` dibagi rata).

### Kenapa harus dijalankan lewat "batch", bukan langsung "bayar semua yang completed"
Karena kurasi butuh **satu titik potong resmi** yang bisa diaudit: kapan
persisnya suatu kelompok kreator "dianggap selesai dan diajukan ke Finance".
Begitu batch ditutup:
- **Hasilnya final** — kalau ada bukti baru masuk atau validasi dijalankan ulang
  SESUDAH batch ditutup, itu **tidak** mengubah batch yang sudah closed. Kreator
  yang baru memenuhi syarat setelah itu akan masuk hitungan **batch berikutnya**
  (buat batch baru untuk periode selanjutnya).
- **Tidak bisa dibatalkan/dibuka lagi** — tidak ada tombol reopen. Kalau menutup
  batch terlalu cepat (sebelum semua validasi selesai), solusinya adalah
  membiarkan batch itu apa adanya dan menagih sisanya lewat batch baru — **bukan**
  mengedit data lama.
- **Tombol boleh diklik berkali-kali dengan aman** (idempoten) — kalau tidak
  sengaja diklik dua kali, tidak membuat payout dobel; klik kedua hanya
  mengembalikan angka yang sama dari penutupan pertama.

### Urutan yang benar sebelum menutup batch
1. Pastikan semua submission relevan sudah divalidasi (§7) — kalau ada bukti
   yang belum divalidasi (verdict masih kosong/`NULL`), status duplikatnya
   mungkin belum akurat.
2. Buat batch (isi Periode Mulai/Selesai) → cek angka **Preview** dulu.
3. Kalau angka preview terasa janggal (terlalu kecil/besar dari perkiraan),
   **jangan langsung tutup** — cek dulu status "Disetujui" di §4 dan verdict
   validasi di §7 untuk kreator yang hilang dari hitungan.
4. Baru klik **Tutup Periode**.

### Setelah ditutup
Card **"Payout"** di halaman yang sama menampilkan daftar payout yang barusan
terbit (status awal **"Menunggu Disbursement"**). Payout yang sama juga muncul
di `/finance` untuk diproses tim Finance (transfer → **"Ditransfer"**, atau
batalkan dengan alasan wajib diisi → **"Dibatalkan"**, wewenang Lead ke atas).

---

## 9. Langkah 9 — Finance memproses payout

**Lokasi:** `/finance`.

Tim Finance melihat antrian payout campaign (bersanding dengan payout KOL biasa,
memakai `payout_status` yang sama) → transfer manual di luar sistem → tandai
**"Ditransfer"** + upload bukti transfer. Tim campaign (BizDev/CM/Account) **tidak
berwenang** mengubah status payout — itu murni wewenang Finance/Lead ke atas.

---

## 10. Verifikasi sebelum melapor "campaign selesai"

Jangan anggap selesai hanya karena "tidak ada pesan error". Cek manual:
- Jumlah payout = jumlah peserta yang buktinya valid, **bukan** jumlah pendaftar
  atau jumlah yang disetujui.
- Nominal per kreator = persis `base_fee` yang di-set di card Budget.
- Total payout tidak melebihi `creator_budget` (kecuali ada catatan Over Budget
  tertulis dengan alasannya).
- Angka di card **"Hasil Campaign"** (GMV/views/ROAS) masuk akal dibanding
  `target_gmv`/`target_views` yang di-set saat pembuatan campaign.
- Tidak ada kreator yang dibayar dua kali (unique per campaign, dijaga DB —
  tapi tetap cek sekali secara manual di batch pertama pemakaian fitur ini).

Kalau ada satu saja yang janggal: **catat angkanya** dan laporkan apa adanya ke
SPV/OD — jangan menutupi atau menebak penyebabnya.

---

## 11. Ringkasan istilah yang sering tertukar

| Istilah | Di mana | Maksudnya |
|---|---|---|
| **Kurasi pendaftar** | Card "Pendaftar", detail campaign | Approve/reject *siapa boleh ikut* campaign (dibatasi kuota) |
| **Ingest / Upload Export TikTok** | Card "Ingest Export TikTok", halaman **daftar** campaign | Mengisi gudang data mentah GLOBAL semua post TikTok. **Belum** menentukan valid/tidaknya bukti siapa pun |
| **Validasi Bukti** | Tombol "Validasi Bukti dari Export TikTok", detail campaign | Mencocokkan tiap submission vs gudang data itu, menghasilkan verdict per submission, **khusus campaign ini** |
| **Batch Kurasi** | Card "Batch Kurasi", detail campaign | Periode formal yang, saat ditutup, mengunci siapa yang "completed" jadi payout final — **bukan** kurasi pendaftar, **bukan** validasi bukti |

---

## 12. FAQ singkat (pertanyaan yang sering muncul di tim)

**Q: Untuk batch kurasi ini maksudnya apa?**
A: Lihat §8. Singkatnya: batch kurasi adalah "amplop periode" yang, begitu
ditutup, mengubah daftar kreator yang sudah disetujui + punya bukti valid
menjadi payout resmi ke Finance — sekali ditutup, hasilnya terkunci dan tidak
memproses ulang kreator yang sama di batch berikutnya (mencegah bayar dobel).

**Q: Kalau mau validasi konten tinggal update data dashboard, itu upload file?**
A: **Bukan cuma itu.** Ada dua langkah terpisah (lihat §6 dan §7):
1. **Upload file** export TikTok di halaman **daftar** campaign (`/meago/campaigns`)
   — ini cuma mengisi data mentah GLOBAL, belum menilai konten siapa pun.
2. **Klik tombol "Validasi Bukti dari Export TikTok"** di halaman **detail**
   campaign yang bersangkutan (`/meago/campaigns/[id]`) — ini yang benar-benar
   mencocokkan dan memberi verdict (Valid/Tidak Ditemukan/dll) ke tiap submission
   kreator di campaign itu.

Upload saja **tidak** memvalidasi apa pun secara otomatis — harus disusul klik
tombol Validasi per campaign, dan itu bisa diulang kapan saja (misalnya setelah
upload file export minggu berikutnya).

**Q: Kenapa hasil validasi semua "Tidak Ditemukan"?**
A: Hampir selalu salah `Target Location ID` di setup campaign (§3), atau file
export yang diupload adalah periode/merchant yang berbeda dari campaign ini —
cek dua hal itu dulu sebelum melapor sebagai bug.

**Q: Batch yang sudah ditutup salah hitung, bisa dibuka lagi?**
A: Tidak ada tombol buka-ulang. Biarkan batch itu apa adanya dan buat batch baru
untuk menagih kekurangannya — jangan mengedit data lama.

---

*Dokumen ini dibuat berdasarkan pembacaan kode sumber per 2026-09-08. Kalau ada
perubahan alur/field di kode, dokumen ini wajib diperbarui mengikuti — jangan
biarkan dokumentasi dan kode berbeda cerita.*
