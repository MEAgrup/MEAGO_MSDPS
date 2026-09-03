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
