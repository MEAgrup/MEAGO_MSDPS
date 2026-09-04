# RUNBOOK — Menjalankan campaign Fase G pertama dengan data nyata

Ditulis 2026-09-04 sesudah roster kreator terverifikasi ada di production
(`docs/HANDOFF_LANJUTAN.md` item 1). Ini prosedur untuk **item 2** daftar kerja:
membuktikan alur campaign jalan ujung ke ujung, bukan sekadar lolos unit test.

Runbook ini mengikuti tiga keputusan user 2026-09-04:
1. Dua baris sisa QA (`MCR-0032`, `MCR-0033`) **dibiarkan** di production.
2. Akun Portal Kreator dibuka **bertahap**, dibuat manual per kreator.
3. Campaign pertama dijalankan **tanpa filter segmentasi**.

---

## Kenapa harus tanpa filter

`creator_meets_campaign_eligibility()` (migrasi `0343`) membandingkan kolom
`eligible_*` di `brand_deals` langsung ke kolom kreator. Di production kolom itu
hampir seluruhnya kosong — `niche` 1/2.250, `jenis_creator` 1/2.250, `city` 33,
`creator_level` 32. Mengisi salah satu kolom `eligible_*` = **nyaris nol kreator
lolos**, dan gejalanya membingungkan: campaign-nya aktif tapi tidak muncul di
portal siapa pun.

Aturannya sederhana: **kosongkan seluruh field di card "Segmentasi Kelayakan
Pendaftar"**. Field kosong → `splitStringList()` mengembalikan `NULL` → tidak
difilter. Itu perilaku yang disengaja, bukan akal-akalan.

Jangan tergoda memakai `eligible_status_kontrak = kontrak` karena "kelihatannya
aman". Seluruh 2.250 baris bernilai `'kontrak'` hasil backfill `0339` — itu nilai
asumsi, jadi filternya terasa jalan padahal tidak menyaring apa pun.

---

## Langkah 0 — pastikan build yang jalan sudah punya kotak pencarian

Card "Akun Portal Kreator" di `/meago/creators` dulu merender seluruh roster. Dengan
2.250 kreator itu berarti 2.250 form email+password dalam satu halaman. Perbaikannya
ada di branch `claude/roaster-creator-production-7nr0r7`. Kalau di halaman itu belum
ada kotak pencarian, **deploy dulu** — tanpa itu Langkah 1 tidak praktis.

## Langkah 1 — buatkan akun portal untuk kreator uji

Butuh **email** per kreator. Roster tidak membawa email, jadi kumpulkan manual dulu
(WA/DM) untuk 2–3 kreator yang bersedia jadi peserta uji. Pakai email asli yang bisa
mereka buka — bukan alias, karena kreator harus benar-benar login.

1. Masuk sebagai **CM Lead / OD / Director** (role lain tidak melihat card ini).
2. Buka `/meago/creators` → card **Akun Portal Kreator**.
3. Ketik nama / username / kode kreator di kotak pencarian → **Cari**.
4. Di baris kreatornya, isi **email** + **password** (minimal 8 karakter) → simpan.
5. Baris berubah jadi badge hijau **"Akun portal aktif"** beserta emailnya.

Catatan:
- Satu kreator hanya boleh punya satu akun; kalau sudah tertaut, form-nya tidak muncul.
- Email yang sudah dipakai akun lain ditolak dengan pesan jelas.
- Kalau muncul keluhan soal `SUPABASE_SERVICE_ROLE_KEY`, akun tidak jadi dibuat —
  perbaiki environment dulu, jangan diulang-ulang.
- Kirim email + password ke kreator lewat jalur pribadi, dan minta mereka menggantinya.

## Langkah 2 — buat campaign

Di `/meago/campaigns` → **Buat Campaign**. Yang wajib supaya bisa diaktifkan nanti:

| Field | Catatan |
|---|---|
| Brand name | bebas, tandai jelas ini uji (mis. "UJI COBA — <brand>") |
| Funding source | `internal` → tim operasional otomatis CampaignSpecialist. `brand` mewajibkan pilih AM. |
| Track | video / live |
| Base fee | boleh 0, tapi **tidak boleh kosong** |
| Kuota kreator | isi kecil dulu, mis. 2–3 |
| Creator budget | tidak boleh kosong |
| **Target Location ID** | **TikTok Location ID**, bukan nama merchant. Lihat jebakan §7–8 di `HANDOFF_FaseG.md` — jangan pakai `shop_id`. |

**Card "Segmentasi Kelayakan Pendaftar": kosongkan semuanya.** Termasuk
`min_gmv` — `creator_period_summary` cuma punya 63 baris untuk 2.250 kreator, jadi
filter GMV pun akan menyapu habis pendaftar.

Campaign tersimpan sebagai **Draft**.

## Langkah 3 — aktifkan

Di detail campaign → card **Stage Campaign** → `draft` → `active`.

Gerbang kelengkapan (`enforce_campaign_stage_transition()`, migrasi `0342`) menolak
aktivasi kalau masih ada yang kosong: Funding source, Track, Tim operasional, Base
fee, Kuota kreator, Creator budget, Target location ID. UI menampilkan daftar yang
kurang sebelum Anda mencoba.

Hanya campaign dengan `campaign_stage = 'active'` yang muncul di portal kreator
(`v_portal_campaigns`).

## Langkah 4 — kreator mendaftar

Kreator buka `/login`, masuk dengan email+password Langkah 1 → otomatis mendarat di
`/kreator/performa` → buka menu **Campaign** (`/kreator/campaign`) → campaign-nya
tampil → daftar.

**Kalau campaign tidak muncul di sisi kreator**, urutan pemeriksaannya:
1. `campaign_stage` sudah `active`?
2. Ada kolom `eligible_*` yang tidak sengaja terisi? (penyebab paling sering)
3. Kreatornya benar punya `auth_user_id`? (badge hijau di Langkah 1)

## Langkah 5 — kurasi pendaftar

Detail campaign → card **Pendaftar** → approve / reject. Yang di-approve inilah yang
boleh mengirim bukti.

## Langkah 6 — kreator submit bukti

Kreator kembali ke `/kreator/campaign` dan mengirim bukti deliverable (link post).
Muncul di card **Bukti Deliverable** di detail campaign.

## Langkah 7 — ingest export TikTok yang asli

Ambil file **"Content Analysis › Video List"** dari TikTok, lalu ingest lewat detail
campaign. Kuncinya `Location ID`, bukan kolom `Merchant` (itu daftar OTA) dan bukan
`Location name` (satu ID bisa dua ejaan).

Ingest **tidak boleh** membuat kreator baru — satu file export bisa memuat ratusan
kreator yang bukan anggota MCN. Kalau ada yang tidak dikenali, itu memang seharusnya
tidak cocok.

Kalau Anda menyentuh parser-nya, jalankan dulu:
```bash
node scripts/qc_content_analysis.mjs <file1.xlsx> <file2.xlsx>   # → 75/75
```

## Langkah 8 — validasi & tutup batch kurasi

Jalankan **validate** di detail campaign (RPC `validate_campaign_posts`, migrasi
`0346`). Tiap submission dapat alasan dengan prioritas TETAP:

`tidak_ditemukan → di_luar_periode → merchant_tidak_sesuai → bukan_milik_kreator → ditolak_tiktok → duplikat → valid`

Baca alasannya satu per satu. Kalau semuanya `tidak_ditemukan`, kemungkinan besar
salah Location ID atau file export-nya beda periode — bukan bug validator.

Lalu tutup **Batch Kurasi**.

## Langkah 9 — payout

Payout muncul di card **Payout** dan di `/finance`.

---

## Verifikasi — bagian yang paling sering dilewati

Menutup runbook ini **bukan** "tidak ada error". Yang harus dicek:

- Jumlah payout = jumlah peserta yang buktinya `valid`, bukan jumlah pendaftar.
- Nominal per kreator cocok dengan `base_fee` / skema di card Budget.
- Total payout tidak melebihi `creator_budget` (kecuali over-budget memang di-override
  dengan alasan tertulis).
- `Hasil Campaign` (`v_campaign_result`) angkanya masuk akal terhadap `target_gmv` /
  `target_views`.
- Tidak ada peserta yang dibayar dua kali.

Kalau ada satu saja yang janggal, **catat angkanya** dan laporkan apa adanya. Fase G
belum pernah dipakai dengan data nyata sama sekali (0 baris di semua tabel campaign
per 2026-09-04), jadi temuan pertama justru yang paling berharga.

---

## Sesudah selesai

1. Perbarui `docs/HANDOFF_LANJUTAN.md` item 2 dengan angka nyata — bukan "sudah dicoba".
2. Perbarui `docs/BUILD_PLAN.md` untuk Fase G.
3. Kalau ada perubahan skema karena temuan, **file migrasi dulu**, apply ke staging,
   verifikasi, baru production (`docs/SCHEMA_DRIFT.md`).
