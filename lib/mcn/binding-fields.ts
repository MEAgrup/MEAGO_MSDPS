// Field binding akuisisi (migrasi 0382, laporan Siti / ACC Yohan 2026-11-06).
// Pure function — dipakai recordAcquisition & di-QC lewat scripts/qc_acquisition.mjs.
//
// Jenis Kontrak & PIC CM TIDAK disimpan di acquisitions: keduanya sudah ada di
// master kreator (mcn_creators.status_kontrak / owner_cpm_id) — lihat DECISIONS.

import { parseRupiah } from "./parsers";
import { parseYMD } from "./weeks";

export const JENIS_KONTRAK = ["kontrak", "non kontrak"] as const;

export type BindingFields = {
  creator_uid: string;
  whatsapp: string; // 62xxxx
  gmv_potential: number;
  binding_end_date: string; // YYYY-MM-DD
  status_kontrak: (typeof JENIS_KONTRAK)[number];
  pic_cm_id: string;
};

// Sama persis dengan normalize_phone_62() di DB (0330).
export function normalizeWa(raw: string): string | null {
  const d = raw.replace(/[^0-9]/g, "");
  if (d === "") return null;
  if (d.startsWith("0")) return "62" + d.slice(1);
  if (d.startsWith("62")) return d;
  return "62" + d;
}

const WAJIB = "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]";

export function readBindingFields(
  get: (k: string) => string,
  bindingDate: string
): { fields: BindingFields } | { error: string } {
  const v = (k: string) => (get(k) ?? "").trim();
  const uid = v("creator_uid");
  const waRaw = v("whatsapp");
  const gmvRaw = v("gmv_potential");
  const end = v("binding_end_date");
  const kontrak = v("status_kontrak");
  const pic = v("pic_cm_id");
  if (!uid || !waRaw || !gmvRaw || !end || !kontrak || !pic) return { error: WAJIB };

  if (!/^[0-9]{5,25}$/.test(uid)) return { error: "[UID TikTok harus berupa angka]" };

  const wa = normalizeWa(waRaw);
  if (!wa || !/^62[0-9]{7,13}$/.test(wa)) return { error: "[nomor WhatsApp tidak valid]" };

  const gmv = parseRupiah(gmvRaw);
  if (gmv === null || gmv < 0) return { error: "[GMV Potential tidak valid]" };

  if (!parseYMD(end)) {
    return { error: "[tanggal binding akhir tidak valid]" };
  }
  if (end < bindingDate) return { error: "[tanggal binding akhir tidak boleh sebelum tanggal binding]" };

  if (!(JENIS_KONTRAK as readonly string[]).includes(kontrak)) {
    return { error: "[jenis kontrak tidak dikenali]" };
  }

  return {
    fields: {
      creator_uid: uid,
      whatsapp: wa,
      gmv_potential: gmv,
      binding_end_date: end,
      status_kontrak: kontrak as BindingFields["status_kontrak"],
      pic_cm_id: pic,
    },
  };
}
