// Taksonomi form intake lead BD + alur status CRM (tab "Leads & Prospek").
//
// HARUS sama persis dengan enum/check constraint DB di migrasi 0330 & 0331.
// Form client dan server action `lib/actions/leads.ts` sama-sama membaca
// konstanta ini supaya pilihan di UI tidak pernah menyimpang dari nilai yang
// diterima DB. Bukan file "use server", jadi boleh diimpor dari keduanya.

export const BRAND_CATEGORIES = ["Accomodation", "Dining", "TTD"] as const;
export type BrandCategory = (typeof BRAND_CATEGORIES)[number];

// Preset awal jenis usaha per kategori (migrasi 0331 men-seed tabel
// `lead_business_types` dengan nilai ini). Sejak 0331 kolom `leads.business_type`
// adalah free text — user boleh mengetik jenis usaha baru dan itu otomatis
// tersimpan ke `lead_business_types` (trigger `leads_validate`) sehingga muncul
// sebagai pilihan untuk semua user berikutnya. Konstanta ini hanya dipakai untuk
// seed migrasi; daftar pilihan yang sesungguhnya datang dari DB (lihat
// `BusinessTypeOption` di page.tsx).
export const BUSINESS_TYPE_SEED: Record<BrandCategory, readonly string[]> = {
  Accomodation: [
    "ACC - Hotel",
    "ACC - Resort",
    "ACC - Villa",
    "ACC - Guest House",
    "ACC - Homestay",
    "ACC - Glamping",
    "ACC - Apartment",
  ],
  Dining: [
    "Dining - Restoran",
    "Dining - Cafe",
    "Dining - Bakery & Pastry",
    "Dining - Dessert Shop",
    "Dining - Street Food/ Kuliner UMKM",
    "Dining - Food Court",
    "Dining - All You Can Eat (AYCE)",
    "Dining - Fine Dining",
    "Dining - Bar & Lounge",
  ],
  TTD: [
    "TTD - Tempat Wisata Alam",
    "TTD - Theme Park",
    "TTD - Waterpark",
    "TTD - Kebun Binatang/ Aquarium",
    "TTD - Museum/ Galery Seni",
    "TTD - Camping Ground",
    "TTD - Karaoke",
    "TTD - Bioskop",
    "TTD - Game Center",
    "TTD - Bowling",
    "TTD - Billiard",
    "TTD - Spa & Massage",
    "TTD - Salon & Barbershop",
    "TTD - Klinik Kecantikan",
    "TTD - Fitness Center & Pilates Studio",
    "TTD - Shopping Center",
  ],
};

// Sumber lead versi BD. 'Event' sudah ada di enum lead_source sejak M1; sisanya
// ditambahkan di migrasi 0330.
export const INTAKE_SOURCES = [
  "Outbound/Scouting Mandiri",
  "Event",
  "Referal Internal",
  "Referal Partner",
  "Referal Creator",
  "Referal TikTok GO",
] as const;

// 38 provinsi RI (termasuk pemekaran Papua 2022). HARUS sama persis dengan
// check constraint `leads_wilayah_check` di migrasi 0331.
export const WILAYAH = [
  "Aceh",
  "Bali",
  "Banten",
  "Bengkulu",
  "Daerah Istimewa Yogyakarta",
  "Daerah Khusus Ibukota Jakarta",
  "Gorontalo",
  "Jambi",
  "Jawa Barat",
  "Jawa Tengah",
  "Jawa Timur",
  "Kalimantan Barat",
  "Kalimantan Selatan",
  "Kalimantan Tengah",
  "Kalimantan Timur",
  "Kalimantan Utara",
  "Kepulauan Bangka Belitung",
  "Kepulauan Riau",
  "Lampung",
  "Maluku",
  "Maluku Utara",
  "Nusa Tenggara Barat",
  "Nusa Tenggara Timur",
  "Papua",
  "Papua Barat",
  "Papua Barat Daya",
  "Papua Pegunungan",
  "Papua Selatan",
  "Papua Tengah",
  "Riau",
  "Sulawesi Barat",
  "Sulawesi Selatan",
  "Sulawesi Tengah",
  "Sulawesi Tenggara",
  "Sulawesi Utara",
  "Sumatera Barat",
  "Sumatera Selatan",
  "Sumatera Utara",
] as const;
export type Wilayah = (typeof WILAYAH)[number];

// ---- Alur status CRM (tombol "Update Status Leads") -------------------------

export const CRM_STATUSES = ["Leads", "Approaching", "Follow Up", "Dealing", "Rejected", "Renewal"] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

// "Renewal" hanya boleh dipilih dari status "Dealing" — satu-satunya aturan
// transisi yang ditegakkan DB (trigger leads_validate, migrasi 0331). Selain
// itu alur bebas; "Leads → Approaching → Follow Up → Dealing/Rejected" cuma
// panduan (ditampilkan sebagai catatan di form, bukan validasi).
export const RENEWAL_REQUIRES_STATUS: CrmStatus = "Dealing";

// Status yang mengaktifkan blok Benefit Dealing / Nominal Bayar / Durasi Kontrak.
export const DEAL_STATUSES: readonly CrmStatus[] = ["Dealing", "Renewal"];

export const APPROACH_VIA = ["Call", "Email", "Instagram DM", "LinkedIn", "TikTok DM", "Visit", "WhatsApp"] as const;

export const HASIL_APPROACH = [
  "Belum dibalas",
  "Sudah dibalas - Sedang Dipertimbangkan",
  "Sudah dibalas - Tertarik",
  "Sudah dibalas - Ditolak",
  "Sudah dibalas - Scheculing Meeting",
  "Sudah dibalas - Meminta Proposal",
] as const;

// Preset awal Benefit Dealing (migrasi 0331 men-seed tabel `lead_benefit_options`).
// Sama seperti jenis usaha: free text + tambahan manual tersimpan untuk semua user.
export const BENEFIT_DEALING_SEED = [
  "Accommodation - Free Stay",
  "Accommodation - Free Visit",
  "Dining - Free Meals",
  "Dining - Content Package",
  "Dining - Creator Package",
  "TTD - Free Ticket",
] as const;

export function isBrandCategory(value: string): value is BrandCategory {
  return (BRAND_CATEGORIES as readonly string[]).includes(value);
}

export function isIntakeSource(value: string): boolean {
  return (INTAKE_SOURCES as readonly string[]).includes(value);
}

export function isWilayah(value: string): boolean {
  return (WILAYAH as readonly string[]).includes(value);
}

export function isCrmStatus(value: string): value is CrmStatus {
  return (CRM_STATUSES as readonly string[]).includes(value);
}

export function isApproachVia(value: string): boolean {
  return (APPROACH_VIA as readonly string[]).includes(value);
}

export function isHasilApproach(value: string): boolean {
  return (HASIL_APPROACH as readonly string[]).includes(value);
}

export function isDealStatus(status: string): boolean {
  return (DEAL_STATUSES as readonly string[]).includes(status);
}

// Cermin JS dari normalize_phone_62() di DB (migrasi 0330): buang non-digit,
// pastikan hasilnya berawalan 62 — "0812…" / "+62 812…" / "812…" → "62812…".
// DB tetap otoritasnya; ini hanya supaya isian langsung terlihat rapi di form.
export function normalizePhone62(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  if (digits.startsWith("62")) return digits;
  return "62" + digits;
}
