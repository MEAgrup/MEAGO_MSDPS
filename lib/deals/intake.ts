// Taksonomi form "Daftarkan Transaksi" (tab "Merchant Deals").
//
// HARUS sama persis dengan check constraint DB di migrasi 0332 (brand_deals).
// Kategori POI memakai daftar yang sama dengan `BRAND_CATEGORIES` di
// lib/leads/intake.ts (kolom `kategori_poi` di brand_deals punya check
// constraint dengan nilai identik).

export const OPS_NAMES = ["Fajri", "Aliya", "Tammy", "Fifas"] as const;
export type OpsName = (typeof OPS_NAMES)[number];

export const BENTUK_KERJASAMA = ["Berbayar", "Free/Barter"] as const;
export type BentukKerjasama = (typeof BENTUK_KERJASAMA)[number];

export function isOpsName(value: string): value is OpsName {
  return (OPS_NAMES as readonly string[]).includes(value);
}

export function isBentukKerjasama(value: string): value is BentukKerjasama {
  return (BENTUK_KERJASAMA as readonly string[]).includes(value);
}
