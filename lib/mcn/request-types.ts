// Jenis creator_requests (migrasi 0306 + 0311). Kontrak bersama portal kreator
// (/kreator), BizDev, dan CM Workspace — jangan duplikasi label di halaman.
// 'sample'/'ads'/'hsl' = jenis lama form CM (masih valid; nasibnya pertanyaan
// terbuka F.2). Empat jenis baru = model portal MEA GO (F.1).

export const PORTAL_REQUEST_TYPES = [
  "free_meal",
  "visit",
  "ads_live",
  "special_price_live",
] as const;

export type PortalRequestType = (typeof PORTAL_REQUEST_TYPES)[number];

export const REQUEST_TYPE_LABELS: Record<string, string> = {
  sample: "Sample",
  ads: "Ads",
  hsl: "HSL",
  free_meal: "Free Meal",
  visit: "Visit",
  ads_live: "Ads Budget Live",
  special_price_live: "Harga Special Live",
};

// Jenis dengan target merchant (dropdown v_portal_merchants + opsi teks bebas)
// dan filter kategori merchant-nya (cocokkan case-insensitive, kategori M4 teks bebas).
export const MERCHANT_TARGET_TYPES: Record<string, string[]> = {
  free_meal: ["dining"],
  visit: ["accommodation", "things to do"],
};

// Jenis dengan nominal (rupiah): budget ads / harga special.
export const NOMINAL_TYPES = ["ads_live", "special_price_live"];

export function requestTypeLabel(type: string): string {
  return REQUEST_TYPE_LABELS[type] ?? type;
}
