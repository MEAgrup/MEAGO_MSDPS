// Taksonomi form intake lead BD (tab "Leads & Prospek" → section "Daftarkan Lead").
//
// HARUS sama persis dengan enum DB di migrasi 0318: `brand_category`,
// `brand_business_type`, dan nilai tambahan enum `lead_source`. Form client dan
// server action `createLead` sama-sama membaca konstanta ini supaya pilihan di UI
// tidak pernah menyimpang dari nilai yang diterima DB.
// Bukan file "use server", jadi boleh diimpor dari keduanya.

export const BRAND_CATEGORIES = ["Accomodation", "Dining", "TTD"] as const;
export type BrandCategory = (typeof BRAND_CATEGORIES)[number];

// Jenis usaha = dependent dropdown dari kategori brand. Prefiks label ("ACC - ",
// "Dining - ", "TTD - ") sekaligus jadi penanda kategori induknya, dipakai trigger
// DB untuk menolak kombinasi kategori/jenis usaha yang tidak cocok.
export const BUSINESS_TYPES: Record<BrandCategory, readonly string[]> = {
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
// ditambahkan di migrasi 0318.
export const INTAKE_SOURCES = [
  "Outbound/Scouting Mandiri",
  "Event",
  "Referal Internal",
  "Referal Partner",
  "Referal Creator",
  "Referal TikTok GO",
] as const;

export function isBrandCategory(value: string): value is BrandCategory {
  return (BRAND_CATEGORIES as readonly string[]).includes(value);
}

export function isIntakeSource(value: string): boolean {
  return (INTAKE_SOURCES as readonly string[]).includes(value);
}

// Jenis usaha valid hanya jika ia turunan dari kategori yang dipilih.
export function isBusinessTypeOf(category: string, businessType: string): boolean {
  if (!isBrandCategory(category)) return false;
  return BUSINESS_TYPES[category].includes(businessType);
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
