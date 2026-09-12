# Glosarium — istilah yang bertabrakan antar sumber

Dokumen pendek yang mengunci arti istilah yang **ejaannya sama tapi maknanya berbeda**
di MSDPS, MEA GO, dan file export TikTok. Setiap kali menulis kode yang menyentuh dua
kosakata sekaligus (mis. ingest export), baca ini dulu.

---

## "Merchant" — dua arti yang berlawanan

| Kosakata | Arti | Di mana |
|---|---|---|
| **MSDPS / MEA GO** | **Brand / POI yang bekerja sama.** Ini yang di-deal BizDev, yang dikunjungi kreator, yang jadi target campaign. | Tabel `merchants` (`nama_toko`), `brand_deals.brand_name`, label UI "Brand / Merchant / POI", "POI / Merchant" |
| **Export TikTok** (`Content Analysis › Video List`) | **Daftar platform OTA/delivery** tempat POI itu bisa dipesan — `"Agoda,Expedia,Klook,Traveloka"`, `"GoFood by Gojek"`. | Kolom `Merchant` |

**Padanan yang benar:**

```
merchant MEA GO  ==  Location (TikTok)     → kolom `Location ID` / `Location name`
kolom `Merchant` (TikTok)                  → platform OTA/delivery, info-only
```

**Konsekuensi di kode:**
- `lib/mcn/content-analysis.ts` memetakan kolom `Merchant` ke field
  **`otaPlatformsRaw`** — sengaja BUKAN `merchant*`, supaya tidak ada yang keliru
  memakainya sebagai merchant MEA GO. Dijaga oleh assertion di
  `scripts/qc_content_analysis.mjs`.
- Pencocokan merchant untuk validasi bukti campaign memakai **`Location ID`**
  (numerik, stabil), bukan `Location name` — satu Location ID bisa punya dua ejaan
  kapitalisasi (`"THE HARVEST - Bandung Setiabudi"` vs `"The Harvest - …"`), jadi nama
  tidak layak jadi kunci.

---

## "Accommodation" — tiga ejaan

| Sumber | Nilai |
|---|---|
| `lib/leads/intake.ts` → `BRAND_CATEGORIES` | `Accomodation` (satu `m`) |
| `lib/mcn/industries.ts` → `INDUSTRIES` (**kanonik**) | `Accommodation` (dua `m`) |
| Export TikTok, kolom `Location industry` | `Accommodations` (dua `m`, pakai `s`) |

Ketiganya menunjuk hal yang sama. Nilai DB **tidak** di-rename (77 baris deal + check
constraint + seed bergantung padanya); yang dilakukan adalah normalisasi saat
membandingkan, lewat `lib/mcn/industry-normalize.ts`:

```ts
normalizeIndustry("Accomodation")   // → "Accommodation"
normalizeIndustry("Accommodations") // → "Accommodation"
sameIndustry("Accomodation", "Accommodations") // → true
```

Label tak dikenal menghasilkan `null` (bukan tebakan) dan dilaporkan lewat
`unknownIndustries` supaya bisa didaftarkan setelah diverifikasi.

Padanan lain: `TTD` (leads) == `Things to Do` (INDUSTRIES).

---

## "Campaign" — tiga entitas berbeda

| Istilah | Entitas | Modul |
|---|---|---|
| **Campaign** (M3, `/campaigns`) | Kampanye **marketing** untuk cari lead. Tidak ada hubungannya dengan kreator. | `campaigns` (migr. `0100`) |
| **Campaign request** (`CRQ-`) | Routing tawaran deal ke satu kreator. **0 baris di live** — fitur tidak pernah dipakai. | `campaign_requests` (migr. `0306`) |
| **Campaign kreator MEA GO** | Yang dibahas Fase G: budget, brief, pendaftaran kreator, bukti, payout. | `brand_deals` + `campaign_*` |

---

## "Creator" — dua master terpisah

| Tabel | Isi | Modul |
|---|---|---|
| `creators` | KOL untuk booking merchant service. | M9 (`0203`) |
| `mcn_creators` | Kreator affiliate TikTok MEA GO. Punya akun Portal Kreator. | Fase E (`0302`) |

Keduanya **tidak** dihubungkan. `creator_payouts` (`PYO-`) terikat ke `creators` M9 —
itu sebabnya payout campaign MEA GO butuh tabel sendiri, bukan menumpang di sana.

---

## "Video" vs "Konten" vs "VT"

`brand_deals.konten_needed` dan `videos_needed` sama-sama ada (yang kedua dari `0312`,
info-only untuk portal). Di lapangan tim menyebut satu video sebagai **"VT"**
("Post 50 VT"). Satu VT = satu baris di export TikTok = satu `Post ID`.

---

## "Order" / `ORD-` — bukan entitas MSDPS

`ORD-YYYYMM-NNNN` adalah kode `external_orders` di **CDPS** (`MEAgrup/AgencyAPP`),
dimint di sana saat delivery job Bridge MSDPS→CDPS Fase 1 (migrasi `0360`, tabel
`cdps_outbox`/`deal_bridge_lines`) berhasil mengirim satu deal. MSDPS **tidak
pernah** memint kode itu sendiri — ia hanya menyimpannya balik ke
`deal_bridge_lines.ord_code`/`cdps_outbox.ord_code` setelah CDPS membalasnya.
Jangan tertukar dengan:

- `brand_deals.code` (`DEAL-…`) — deal MSDPS itu sendiri.
- `transactions.code` (`TRX-…`) — transaksi Finance MSDPS.
- `campaign_requests.code` (`CRQ-…`) — routing kreator, entitas terpisah, 0 baris
  di live (lihat "Campaign" di atas).

Satu deal MSDPS ⇒ **paling banyak satu** `ORD-` seumur Fase 1 (idempotency_key
`cdps_outbox` terkunci ke `<DEAL code>:1`, lihat `docs/BRIDGE_MSDPS_CONTRACT.md`
sisi CDPS) — belum ada mekanisme "tambah baris ke order yang sudah terkirim".

---

## "Account & Service" / "eksekusi layanan" — artinya berubah 2026-09-12

Ini jebakan baca terbesar di repo sesudah pensiun: hampir semua dokumen yang
ditulis sebelum tanggal ini memakai kata "Account & Service" dalam arti lama.

| Kosakata | Arti | Di mana |
|---|---|---|
| **MSDPS sebelum 2026-09-12** | M6–M11 + portal/manajemen (M12–M15): strategi, brief, SKU, ADC, booking KOL, live stream, board, speed score, health, skor performa. | `/account /ecommerce /ads /kol /livestream /board /portal /management` — **PENSIUN, halaman nisan** (migr. 0361) |
| **MSDPS sekarang** | MSDPS berhenti di *closing* + *bridge*: deal → transaksi terverifikasi Finance → `ORD-` ke CDPS. | `/deals`, `/merchants`, `deal_bridge_lines`, `cdps_outbox` (0360) |
| **CDPS** | Tempat eksekusi layanan sebenarnya berjalan sejak 2026-09-11. | repo/app terpisah (`MEAgrup/AgencyAPP`) — **tidak disentuh dari MSDPS** |

Tiga hal yang sering salah disimpulkan dari pensiun ini:

1. **Datanya tidak hilang.** Migrasi 0361 nol `drop`/`delete`/`truncate`. Seluruh
   baris `briefs`, `strategies`, `complaints`, `sku_work_units`,
   `ad_campaign_records`, `creator_bookings`, `live_stream_results`,
   `merchant_health_snapshots`, `performance_scores` beserta audit log-nya tetap
   utuh dan terbaca OD/Director lewat SQL. Yang berhenti hanya pintu masuk
   manusianya dan tiga pg_cron M13/M14.
2. **`/merchants` dan `/campaigns` TIDAK ikut pensiun.** Keduanya dulu berada di
   grup nav yang sama, tapi bukan modul eksekusi: `merchants`/`services` adalah
   induk yang dipakai `close_deal` dan bridge, `campaigns` (M3) menyuapi Leads
   (M1) dan ROAS Marketing (M2). Sekarang mereka di grup **"Merchant & Kampanye"**.
3. **File `forms.tsx` dan `lib/actions/{account,ecommerce,ads,kol,livestream,blocks}.ts`
   yang tampak yatim itu disengaja.** Baca header `components/retired.tsx` sebelum
   menghapusnya — ketiadaan import-nya justru yang menutup endpoint Server Action.

## "OKR" / "attainment" / "target role" — juga berubah tanggal yang sama

| | Sebelum | Sesudah |
|---|---|---|
| Divisi dinilai | Ecommerce, Ads, KOL, AM | BizDev, Creator Management, Akuisisi, Marketing, Keuangan |
| Tabel target | `okr_targets` (kolom `role`, enum `perf_role`) — **DIBEKUKAN**, jangan ditulisi lagi | `okr_targets_meago` (kolom `division`, text + CHECK) |
| Attainment | `v_okr_attainment` (M14), ditampilkan di `/management` | `v_okr_attainment_meago`, ditampilkan di `/okr` sendiri |
| Mesin skor | `generate_performance_scores` mingguan lewat pg_cron | tidak ada — attainment dihitung on-read oleh view |

`perf_role` sengaja **tidak** diperluas: Postgres tidak punya `drop value`, dan
menambah label justru akan membuat `generate_performance_scores` (0209:94) mulai
menghasilkan angka untuk divisi yang mesinnya baru saja dihentikan. Alasan
lengkapnya di header migrasi `0361`.
