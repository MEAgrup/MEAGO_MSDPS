// Sumber tunggal daftar divisi karyawan.
//
// HARUS sama persis dengan enum `division` di DB: 8 divisi dasar (migrasi 0002)
// + CreatorManagement & Acquisition (migrasi 0300). Form "Tambah Karyawan" dan
// server action createEmployee sama-sama membaca konstanta ini supaya pilihan di
// UI tidak pernah menyimpang dari nilai yang diterima DB.
export const DIVISIONS = [
  "Marketing",
  "BizDev",
  "Finance",
  "Account",
  "Ecommerce",
  "Ads",
  "KOL",
  "LiveStream",
  "CreatorManagement",
  "Acquisition",
] as const;

export type Division = (typeof DIVISIONS)[number];

// Label tampilan (nilai enum DB ditulis PascalCase tanpa spasi).
export const DIVISION_LABELS: Record<Division, string> = {
  Marketing: "Marketing",
  BizDev: "BizDev",
  Finance: "Finance",
  Account: "Account",
  Ecommerce: "Ecommerce",
  Ads: "Ads",
  KOL: "KOL",
  LiveStream: "LiveStream",
  CreatorManagement: "Creator Management",
  Acquisition: "Acquisition",
};

export function isDivision(value: string): value is Division {
  return (DIVISIONS as readonly string[]).includes(value);
}
