// Pilihan dropdown untuk CRM Admin Ops (adaptasi web app Google Apps Script
// "Forms Leads Masuk & Dashboard CRM"). Satu sumber tunggal supaya form input,
// form update status, dan validasi server action tidak pernah menyimpang.
//
// Nilai-nilai ini HARUS cocok dengan check constraint di migrasi 0321 untuk
// kolom yang di-constraint (kategori_brand, status, bentuk_kerjasama,
// kategori_poi). Sisanya (source, wilayah, jenis usaha, approach, benefit)
// sengaja text bebas di DB — tim Admin Ops boleh menambah nilai baru lewat opsi
// "Tambah Manual…" tanpa migrasi.

export const KATEGORI_BRAND = ["Accommodation", "Dining", "TTD"] as const;
export type KategoriBrand = (typeof KATEGORI_BRAND)[number];

// Jenis usaha per kategori brand (JENIS_USAHA_PRESETS di index.html lama).
export const JENIS_USAHA_PRESETS: Record<KategoriBrand, string[]> = {
  Accommodation: [
    "ACC - Hotel",
    "ACC - Resort",
    "ACC - Villa",
    "ACC - Guesthouse",
    "ACC - Glamping",
    "ACC - Hostel",
    "ACC - Homestay",
    "ACC - Boutique Hotel",
  ],
  Dining: [
    "Dining - Restaurant",
    "Dining - Café",
    "Dining - Coffee Shop",
    "Dining - Beach Club",
    "Dining - Bar / Lounge",
    "Dining - Bakery / Pastry",
    "Dining - Local Food / Warung",
  ],
  TTD: [
    "TTD - Shopping Center",
    "TTD - Theme Park",
    "TTD - Waterpark",
    "TTD - Museum / Art Gallery",
    "TTD - Spa / Wellness",
    "TTD - Tour & Activity Organizer",
    "TTD - Zoo & Safari",
    "TTD - Natural Attraction / Ticketed POI",
  ],
};

export const CRM_SOURCES = [
  "Outbond/Scouting Mandiri",
  "Event",
  "Referral Internal",
  "Referral Partner",
  "Referral Creator",
  "Referral TikTok GO",
] as const;

export const WILAYAH = [
  "Aceh",
  "Bali",
  "Banten",
  "Bengkulu",
  "DI Yogyakarta",
  "DKI Jakarta",
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

// ---- Update Status ----------------------------------------------------------

export const CRM_STATUSES = [
  "Leads",
  "Approaching",
  "Follow Up",
  "Dealing",
  "Rejected",
  "Renewal",
] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

// Transisi legal — HARUS sama dengan rows status_transitions('crm_lead') di
// migrasi 0321. Dipakai UI untuk hanya menawarkan status yang bisa dituju,
// supaya user tidak menabrak trigger DB.
export const CRM_STATUS_NEXT: Record<CrmStatus, CrmStatus[]> = {
  Leads: ["Approaching", "Follow Up", "Rejected"],
  Approaching: ["Follow Up", "Dealing", "Rejected", "Leads"],
  "Follow Up": ["Dealing", "Rejected", "Approaching", "Leads"],
  Dealing: ["Renewal", "Rejected", "Follow Up"],
  Renewal: ["Dealing", "Rejected", "Follow Up"],
  Rejected: ["Leads", "Approaching", "Follow Up", "Dealing"],
};

// Status yang mengaktifkan blok Benefit / Nominal / Kontrak pada form update.
export const DEAL_STATUSES: CrmStatus[] = ["Dealing", "Renewal"];

export const CRM_STATUS_CLASS: Record<CrmStatus, string> = {
  Leads: "slate",
  Approaching: "indigo",
  "Follow Up": "amber",
  Dealing: "green",
  Renewal: "blue",
  Rejected: "red",
};

export const APPROACH_VIA = [
  "Call",
  "Email",
  "Instagram DM",
  "LinkedIn",
  "TikTok DM",
  "Visit",
  "WhatsApp",
] as const;

export const HASIL_APPROACH = [
  "Belum dibalas",
  "Sudah dibalas - Sedang Dipertimbangkan",
  "Sudah dibalas - Tertarik",
  "Sudah dibalas - Ditolak",
  "Sudah dibalas - Scheduling Meeting",
  "Sudah dibalas - Meminta Proposal",
] as const;

export const BENEFIT_DEALING = [
  "Accommodation - Free Stay",
  "Accommodation - Free Visit",
  "Dining - Free Meals",
  "Dining - Content Package",
  "Dining - Creator Package",
  "TTD - Free Ticket",
] as const;

// ---- Pendataan Transaksi ----------------------------------------------------

export const BENTUK_KERJASAMA = ["Berbayar", "Free"] as const;

export const BENEFIT_DIBERIKAN = [
  "Dining - Free Meals by Visit Grup",
  "Dining - Content Package",
  "Dining - Creator Package",
  "Accomodation - Open Room Only",
  "Accomodation - Free Stay",
  "TTD - Free Ticket",
] as const;

// Kategori POI yang mewajibkan Durasi Kerjasama (awal & akhir).
export const KATEGORI_WAJIB_DURASI = "Dining";

// Sentinel value untuk opsi "Tambah Manual…" pada select yang boleh diisi bebas.
export const MANUAL = "__MANUAL__";
