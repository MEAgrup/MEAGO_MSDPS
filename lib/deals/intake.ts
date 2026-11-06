// Taksonomi form "Daftarkan Transaksi" (tab "Merchant Deals").
//
// HARUS sama persis dengan check constraint DB di migrasi 0332 (brand_deals).
// Kategori POI memakai daftar yang sama dengan `BRAND_CATEGORIES` di
// lib/leads/intake.ts (kolom `kategori_poi` di brand_deals punya check
// constraint dengan nilai identik).

import { parseRupiah } from "../mcn/parsers";

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

// ---- Baseline & Target GMV (migrasi 0379, email Tim OD 2026-10-30) ---------
// Murni (tanpa Supabase) supaya bisa diuji: scripts/qc_deal_merchant_target.mjs.
// CHECK brand_deals (0379) tetap otoritas akhir.

export type MerchantTargetFields = {
  merchant_gmv_baseline: number | null;
  merchant_target_gmv: number | null;
  link_akun_merchant: string | null;
  kategori_merchant: string | null;
};

/**
 * Baca 4 isian merchant target. `requireTarget` = true untuk deal BARU
 * (Daftarkan Transaksi) — Target GMV wajib. Edit/approval deal lama tidak
 * mewajibkannya (deal sebelum 0379 & hasil Import Bulking belum punya nilai).
 */
export function readMerchantTarget(
  get: (key: string) => string,
  opts: { requireTarget: boolean }
): { fields: MerchantTargetFields } | { error: string } {
  const baselineRaw = get("merchant_gmv_baseline").trim();
  const targetRaw = get("merchant_target_gmv").trim();
  const link = get("link_akun_merchant").trim();
  const kategori = get("kategori_merchant").trim();

  let merchant_gmv_baseline: number | null = null;
  if (baselineRaw) {
    merchant_gmv_baseline = parseRupiah(baselineRaw);
    if (merchant_gmv_baseline === null || !Number.isFinite(merchant_gmv_baseline) || merchant_gmv_baseline < 0) {
      return { error: "[GMV baseline tidak valid]" };
    }
  }

  let merchant_target_gmv: number | null = null;
  if (targetRaw) {
    merchant_target_gmv = parseRupiah(targetRaw);
    if (merchant_target_gmv === null || !Number.isFinite(merchant_target_gmv) || merchant_target_gmv <= 0) {
      return { error: "[target GMV tidak valid, harus lebih dari 0]" };
    }
  } else if (opts.requireTarget) {
    return { error: "[target GMV wajib diisi]" };
  }

  if (link && !/^https?:\/\/\S+$/i.test(link)) {
    return { error: "[link akun merchant harus diawali http:// atau https://]" };
  }
  if (kategori.length > 100) return { error: "[kategori merchant maksimal 100 karakter]" };

  return {
    fields: {
      merchant_gmv_baseline,
      merchant_target_gmv,
      link_akun_merchant: link || null,
      kategori_merchant: kategori || null,
    },
  };
}
