// Baca workbook XLSX/CSV jadi RawSheet[] DENGAN tipe sel asli (raw:true) —
// bukan string terformat seperti lib/mcn/file-read.ts. Tipe asli dibutuhkan
// untuk mendeteksi Post ID / Location ID yang tersimpan sebagai ANGKA (sudah
// dibulatkan Excel, mis. 7.61e+18) supaya sheet itu ditolak, bukan diam-diam
// disimpan dengan ID salah. Dipakai server action & scripts/qc_merchant_report.mjs.

import * as XLSX from "xlsx";
import type { RawSheet, RawCell } from "./video-list";

export function readWorkbookBuffer(buf: Buffer | Uint8Array, fileName = ""): RawSheet[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    // CSV: semua sel teks (tidak ada tipe angka) — tidak ada risiko pembulatan.
    const wb = XLSX.read(Buffer.from(buf).toString("utf-8"), { type: "string", raw: true });
    return toSheets(wb);
  }
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, cellText: false });
  return toSheets(wb);
}

function toSheets(wb: XLSX.WorkBook): RawSheet[] {
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<RawCell[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    return { name, rows: rows.map((r) => r.map((c) => (c === undefined ? null : (c as RawCell)))) };
  });
}
