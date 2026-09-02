// Normalisasi industri/kategori POI ke SATU nilai kanonik.
//
// Kenapa file ini ada: satu konsep yang sama dieja tiga cara berbeda di sistem —
//   · `lib/leads/intake.ts`  BRAND_CATEGORIES  : "Accomodation" (satu `m`), "TTD"
//   · `lib/mcn/industries.ts` INDUSTRIES       : "Accommodation" (dua `m`), "Things to Do"
//   · export TikTok "Content Analysis"          : "Accommodations" (dua `m`, pakai `s`)
// Tanpa normalisasi, join antar-modul (kategori deal ↔ industry kreator ↔ industry
// baris export) tidak akan pernah cocok.
//
// Kanonik = nilai `INDUSTRIES` (sumber tunggal per keputusan 2026-07-16). Kolom DB
// TIDAK di-rename — nilai lama tetap tersimpan apa adanya; normalisasi hanya dipakai
// saat MEMBANDINGKAN. Pure, tanpa import DB/React.

import { INDUSTRIES, type Industry } from "./industries";

// Alias -> kanonik. Semua kunci sudah ter-normalisasi lewat `aliasKey()`.
// Hanya varian yang BENAR-BENAR terlihat di kode/data yang didaftarkan — konvensi
// rumah: jangan menebak. Nilai tak dikenal -> null supaya pemanggil bisa melaporkannya
// (dan kita menambahkannya ke sini setelah terverifikasi), bukan diam-diam salah map.
const ALIASES: Record<string, Industry> = {
  // Dining — sama di ketiga sumber
  dining: "Dining",

  // Accommodation — tiga ejaan berbeda
  accomodation: "Accommodation", // BRAND_CATEGORIES (lib/leads/intake.ts)
  accommodation: "Accommodation", // INDUSTRIES (kanonik)
  accomodations: "Accommodation",
  accommodations: "Accommodation", // export TikTok Content Analysis

  // Things to Do
  ttd: "Things to Do", // BRAND_CATEGORIES
  "things to do": "Things to Do", // INDUSTRIES (kanonik)
};

function aliasKey(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Kembalikan bentuk kanonik dari sebuah label industri, atau `null` bila labelnya
 * tidak dikenali. `null` BUKAN "tidak ada" — itu sinyal bahwa ada ejaan baru yang
 * perlu didaftarkan di `ALIASES`; pemanggil sebaiknya melaporkannya, bukan menelannya.
 */
export function normalizeIndustry(raw: string | null | undefined): Industry | null {
  if (raw === null || raw === undefined) return null;
  const key = aliasKey(raw);
  if (key === "") return null;
  return ALIASES[key] ?? null;
}

/** True bila dua label menunjuk industri yang sama, apa pun ejaannya. */
export function sameIndustry(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeIndustry(a);
  const nb = normalizeIndustry(b);
  return na !== null && na === nb;
}

/** Daftar nilai kanonik — re-export supaya pemanggil tak perlu impor dua file. */
export { INDUSTRIES, type Industry };
