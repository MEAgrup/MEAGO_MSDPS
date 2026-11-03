// Bridge MSDPS→CDPS otomatis (migrasi 0377) — validasi rencana layanan CDPS.
//
// Murni (tanpa Supabase): dipakai bersama oleh form "Daftarkan Transaksi"
// (registerDealTransaction), modal "Layanan CDPS" (saveCdpsPlan), dan sweep
// enqueue (lib/bridge/enqueue.ts) — satu aturan, satu tempat. CHECK
// deal_bridge_lines (0360/0362) tetap otoritas akhir saat baris benar-benar
// dibuat.

import type { BridgeLineRow } from "./payload";

export const BRIDGE_JENIS = ["Account", "Ads", "Creative", "Store Operation", "KOL-Non-Roster", "Live Stream"] as const;
export type BridgeJenis = (typeof BRIDGE_JENIS)[number];

export function isBridgeJenis(v: string): v is BridgeJenis {
  return (BRIDGE_JENIS as readonly string[]).includes(v);
}

// Bentuk mentah satu baris dari form (semua string, seperti isian <input>).
export type PlanLineInput = {
  jenis?: unknown;
  qty?: unknown;
  catatan?: unknown;
  alasan_non_roster?: unknown;
  nilai_cross_charge?: unknown;
};

export type CdpsPlan = { tidak_perlu: true; lines: [] } | { tidak_perlu: false; lines: BridgeLineRow[] };

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Validasi + normalisasi baris rencana. Pesan error ramah, per baris. */
export function parsePlanLines(raw: unknown): { lines: BridgeLineRow[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Data layanan CDPS tidak valid." };
  if (raw.length === 0) return { error: "Pilih minimal satu layanan CDPS, atau centang \"Tidak perlu CDPS\"." };

  const lines: BridgeLineRow[] = [];
  for (let i = 0; i < raw.length; i++) {
    const li = (raw[i] ?? {}) as PlanLineInput;
    const jenis = str(li.jenis);
    if (!isBridgeJenis(jenis)) return { error: `Layanan CDPS baris ${i + 1}: jenis layanan tidak dikenal.` };

    const alasan = str(li.alasan_non_roster);
    if (jenis === "KOL-Non-Roster" && alasan === "") {
      return { error: `Layanan CDPS baris ${i + 1}: KOL-Non-Roster wajib mengisi alasan non-roster.` };
    }

    const qtyRaw = str(li.qty);
    const qty = qtyRaw === "" ? null : Number(qtyRaw);
    if (qty !== null && (!Number.isInteger(qty) || qty < 0)) {
      return { error: `Layanan CDPS baris ${i + 1}: qty harus bilangan bulat ≥ 0.` };
    }

    const nccRaw = str(li.nilai_cross_charge).replace(/[^\d.-]/g, "");
    const nilai_cross_charge = nccRaw === "" ? null : Number(nccRaw);
    if (nilai_cross_charge !== null && (!Number.isFinite(nilai_cross_charge) || nilai_cross_charge < 0)) {
      return { error: `Layanan CDPS baris ${i + 1}: nilai cross-charge tidak valid.` };
    }

    lines.push({
      jenis,
      qty,
      catatan: str(li.catatan) || null,
      alasan_non_roster: alasan || null,
      nilai_cross_charge,
    });
  }
  return { lines };
}

/**
 * Baca rencana dari FormData: `cdps_tidak_perlu` ("on"/"true") ATAU
 * `cdps_lines_json` (satu field JSON — React 19/Next 15 membuang
 * name/value submitter, jadi array baris dikemas jadi satu string,
 * BUILD_PLAN.md:46).
 */
export function readCdpsPlan(formData: FormData): { plan: CdpsPlan } | { error: string } {
  const flag = str(formData.get("cdps_tidak_perlu")).toLowerCase();
  if (flag === "on" || flag === "true" || flag === "1") return { plan: { tidak_perlu: true, lines: [] } };

  let raw: unknown;
  try {
    raw = JSON.parse(str(formData.get("cdps_lines_json")) || "[]");
  } catch {
    return { error: "Data layanan CDPS tidak valid." };
  }
  const parsed = parsePlanLines(raw);
  if ("error" in parsed) return parsed;
  return { plan: { tidak_perlu: false, lines: parsed.lines } };
}
