// SERVER-ONLY: baca file upload (dari FormData) jadi cells[][] mentah untuk
// lib/mcn/ingest.ts. CSV diparse manual (quote-aware, tanpa lib eksternal — konsisten
// dgn konvensi import bulk lain di repo ini). XLSX lewat SheetJS ("xlsx", server-side
// saja supaya tak ikut ke bundle client). Baris mentah tak pernah disimpan ke DB
// (drop-raw) — pemanggil wajib membuang cells[][] setelah lib/mcn/ingest.ts selesai.

import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export async function readFileToCells(file: File): Promise<string[][]> {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  const isXlsx =
    name.endsWith(".xlsx") || name.endsWith(".xls") || type.includes("spreadsheet") || type.includes("excel");

  const buf = Buffer.from(await file.arrayBuffer());
  return isXlsx ? parseXlsxBuffer(buf) : parseCsvText(stripBom(buf.toString("utf-8")));
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseXlsxBuffer(buf: Buffer): string[][] {
  const workbook = XLSX.read(buf, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  // raw:false -> nilai sel diformat sbg string (biar parser toleran lib/mcn/parsers.ts
  // yang menafsirkan angka/tanggal, bukan xlsx yg menebak tipe).
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  return raw.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
}

// Sama seperti readFileToCells, tapi mengembalikan SEMUA sheet workbook (bukan cuma
// sheet pertama) — dipakai format export multi-sheet spt "Creator Analysis" (sheet
// Filter + Data). CSV tak punya konsep multi-sheet -> dibungkus jadi 1 sheet "Data".
export async function readWorkbookSheets(file: File): Promise<{ name: string; cells: string[][] }[]> {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  const isXlsx =
    name.endsWith(".xlsx") || name.endsWith(".xls") || type.includes("spreadsheet") || type.includes("excel");

  const buf = Buffer.from(await file.arrayBuffer());
  if (isXlsx) return parseXlsxAllSheets(buf);
  return [{ name: "Data", cells: parseCsvText(stripBom(buf.toString("utf-8"))) }];
}

function parseXlsxAllSheets(buf: Buffer): { name: string; cells: string[][] }[] {
  const workbook = XLSX.read(buf, { type: "buffer" });
  return workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
    const cells = raw.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
    return { name: sheetName, cells };
  });
}

// Parser CSV manual, quote-aware: dukung koma di dalam kutip dan CRLF/LF campuran.
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // "" di dalam kutip = escape utk satu literal "
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1; // CR dilewati; LF (bila menyusul) yang menutup baris
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// sha256 8 char pertama — dipakai membentuk batch_id idempoten "ingest:<start>:<hash8>".
export function fileHash8(buf: Buffer | Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

export function buildBatchId(periodStart: string, hash8: string): string {
  return `ingest:${periodStart}:${hash8}`;
}
