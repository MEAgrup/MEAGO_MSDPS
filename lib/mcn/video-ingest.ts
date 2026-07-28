// Parser untuk export TikTok Creator Analytics "Video Performance" (per-video GMV mingguan).
// Format: 2-sheet XLSX (Filter & Data) sama seperti Creator Analysis.
// Strict header validation — format tak dikenali atau kolom kurang → null, bukan guessing.
// Pure function: no DB, no React, testable & reusable across layers.

import { formatYMD, isValidCalendarDate, validateW1W5Period } from "./weeks";

// ---- parsePlainNumber ----
// "306336120.270811", "0.000000", "1,234.56" (EN-style thousands) → number.
// Desimal-titik polos, bukan format Rupiah (lib/mcn/parsers.ts:parseRupiah berbeda).
export function parsePlainNumber(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ---- parseIntTolerant ----
// Integer dengan toleransi: ".0", ",000" → 123; bukan angka → null.
export function parseIntTolerant(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/,/g, "").split(".")[0];
  if (!/^\d+$/.test(cleaned)) return null;
  const n = parseInt(cleaned, 10);
  return !isNaN(n) ? n : null;
}

// ---- parseYmdCompact ----
// "YYYYMMDD" → "YYYY-MM-DD". Validasi kalender via weeks.ts.
export function parseYmdCompact(s: string): string | null {
  const trimmed = s.trim();
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  if (!isValidCalendarDate(y, m, d)) return null;
  return formatYMD(y, m, d);
}

// ---- parseDecimalPct ----
// Persen desimal: "45.67", "0.5" → 45.67, 0.5 (bukan 4567, 50).
// Validation: [0, 100] untuk conversion_rate. Jika luar range → null.
export function parseDecimalPct(s: string, minVal = 0, maxVal = 100): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const n = parseFloat(trimmed);
  if (!Number.isFinite(n) || n < minVal || n > maxVal) return null;
  return n;
}

// ---- Type Definitions ----
export type VideoGmvRow = {
  username: string;
  name: string;
  videoId: string;
  videoTitle: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  salesValue: number | null;
  orders: number | null;
  conversionRate: number | null;
};

export type VideoGmvSkip = { rowIndex: number; reason: string };

export type ParseVideoGmvResult =
  | {
      ok: true;
      periodStart: string;
      periodEnd: string;
      rows: VideoGmvRow[];
      skipped: VideoGmvSkip[];
    }
  | { ok: false; error: string };

export type WorkbookSheet = { name: string; cells: string[][] };

// ---- Helper: normalize header keys ----
function normalizeHeaderKey(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ");
}

// ---- Column mapping (strict exact-match) ----
// TikTok Creator Analytics export: exact column names per spesifikasi.
// Jika format berubah → validation fail (better error message than silent mismatch).
const DATA_FIELD_MAP: Record<string, keyof VideoGmvRow> = {
  "creator id": "username",
  "creator name": "name",
  "video id": "videoId",
  "video title": "videoTitle",
  "video views": "views",
  "video likes": "likes",
  "video comments": "comments",
  "video shares": "shares",
  "video gmv": "salesValue",
  "video orders": "orders",
  "conversion rate (%)": "conversionRate",
};

const NUMERIC_FIELDS = new Set<keyof VideoGmvRow>([
  "views",
  "likes",
  "comments",
  "shares",
  "salesValue",
  "orders",
  "conversionRate",
]);

// ---- Helper: find column index by contains (Filter sheet) ----
function findColumnIndexContaining(headerRow: string[], needle: string): number {
  return headerRow.findIndex((h) => normalizeHeaderKey(h).includes(needle));
}

// ---- Helper: find sheet by name ----
function findSheet(sheets: WorkbookSheet[], name: string): WorkbookSheet | null {
  return sheets.find((s) => s.name.trim().toLowerCase() === name) ?? null;
}

// ---- Main parser ----
export function parseVideoGmvWorkbook(sheets: WorkbookSheet[]): ParseVideoGmvResult {
  const filterSheet = findSheet(sheets, "filter");
  const dataSheet = findSheet(sheets, "data");
  if (!filterSheet || !dataSheet) {
    const missing = [!filterSheet ? "Filter" : null, !dataSheet ? "Data" : null].filter(Boolean).join(" dan ");
    return { ok: false, error: `Workbook tidak lengkap: sheet ${missing} tidak ditemukan.` };
  }

  // ---- Sheet Filter: periode ----
  const filterHeader = filterSheet.cells[0];
  const filterValues = filterSheet.cells[1];
  if (!filterHeader || !filterValues) {
    return { ok: false, error: "Sheet Filter tidak punya baris header/nilai." };
  }

  const startCol = findColumnIndexContaining(filterHeader, "start date");
  const endCol = findColumnIndexContaining(filterHeader, "end date");
  if (startCol === -1 || endCol === -1) {
    return { ok: false, error: "Sheet Filter tidak punya kolom Start date / End date." };
  }

  const periodStart = parseYmdCompact(filterValues[startCol] ?? "");
  const periodEnd = parseYmdCompact(filterValues[endCol] ?? "");
  if (periodStart === null || periodEnd === null) {
    return {
      ok: false,
      error: `Tanggal periode di sheet Filter tidak valid (format YYYYMMDD): "${filterValues[startCol] ?? ""}" s/d "${filterValues[endCol] ?? ""}".`,
    };
  }

  const w1w5 = validateW1W5Period(periodStart, periodEnd);
  if (!w1w5.ok) {
    return { ok: false, error: w1w5.message };
  }

  // ---- Sheet Data: baris per video ----
  const dataHeader = dataSheet.cells[0] ?? [];
  const fieldByColumn: (keyof VideoGmvRow | null)[] = dataHeader.map(
    (h) => DATA_FIELD_MAP[normalizeHeaderKey(h)] ?? null,
  );

  // Validasi header ketat: kolom wajib harus ada
  const requiredFields: (keyof VideoGmvRow)[] = ["username", "videoId"];
  for (const req of requiredFields) {
    if (!fieldByColumn.includes(req)) {
      const missingCol = Object.entries(DATA_FIELD_MAP).find(([_, v]) => v === req)?.[0];
      return {
        ok: false,
        error: `Sheet Data tidak punya kolom wajib: "${missingCol}".`,
      };
    }
  }

  const rows: VideoGmvRow[] = [];
  const skipped: VideoGmvSkip[] = [];

  for (let r = 1; r < dataSheet.cells.length; r++) {
    const rowCells = dataSheet.cells[r];
    const rowIndex = r + 1; // nomor baris file asli (1-based)

    if (rowCells.every((c) => (c ?? "").trim() === "")) {
      continue; // baris kosong total — diabaikan tanpa catat
    }

    const values: Partial<Record<keyof VideoGmvRow, string>> = {};
    for (let c = 0; c < rowCells.length; c++) {
      const field = fieldByColumn[c];
      if (!field) continue;
      const v = (rowCells[c] ?? "").trim();
      if (v !== "") values[field] = v;
    }

    const username = values.username ?? "";
    const videoId = values.videoId ?? "";

    if (username === "") {
      skipped.push({ rowIndex, reason: "Baris tanpa Creator ID" });
      continue;
    }
    if (videoId === "") {
      skipped.push({ rowIndex, reason: "Baris tanpa Video ID" });
      continue;
    }

    const row: VideoGmvRow = {
      username,
      name: values.name?.trim() ?? username,
      videoId,
      videoTitle: values.videoTitle ?? null,
      views: null,
      likes: null,
      comments: null,
      shares: null,
      salesValue: null,
      orders: null,
      conversionRate: null,
    };

    // Parse numeric fields
    for (const field of NUMERIC_FIELDS) {
      const raw = values[field];
      if (raw !== undefined) {
        if (field === "conversionRate") {
          (row[field] as number | null) = parseDecimalPct(raw);
        } else if (field === "orders") {
          (row[field] as number | null) = parseIntTolerant(raw);
        } else if (field === "salesValue") {
          (row[field] as number | null) = parsePlainNumber(raw);
        } else {
          (row[field] as number | null) = parseIntTolerant(raw);
        }
      }
    }

    rows.push(row);
  }

  return { ok: true, periodStart, periodEnd, rows, skipped };
}

// ---- Lightweight format detection (untuk router ingest) ----
export function isVideoGmvWorkbook(sheets: WorkbookSheet[]): boolean {
  return sheets.some((s) => {
    const header = (s.cells[0] ?? []).map(normalizeHeaderKey);
    return header.includes("creator id") && header.includes("video id") && header.includes("video gmv");
  });
}
