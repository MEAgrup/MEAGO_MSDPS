// Parser untuk export TikTok "Creator Analysis" (workbook XLSX 2 sheet: Filter & Data).
// Sama seperti lib/mcn/parsers.ts: TIDAK PERNAH menebak — format tak dikenali -> null,
// baris tak lengkap -> skipped[] beralasan (bukan diam-diam dibuang). Pure, tanpa
// import DB/React, supaya bisa dites & dipakai lintas layer (server ingest & client preview).

import { formatYMD, isValidCalendarDate, validateW1W5Period } from "./weeks";

// ---- parsePlainNumber --------------------------------------------------------------
// Angka desimal-titik POLOS ("306336120.270811", "0.000000") — BUKAN format Rupiah
// Indonesia (lib/mcn/parsers.ts:parseRupiah beda kasus, jangan dipakai di sini). Toleransi
// koma ribuan gaya EN ("1,234.56") dgn cara dibuang dulu. "0.000000" -> 0 (NOL, bukan null).
export function parsePlainNumber(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ---- parseYmdCompact ----------------------------------------------------------------
// "YYYYMMDD" (format tanggal sheet Filter) -> "YYYY-MM-DD". Validasi kalender lewat
// helper weeks.ts (jangan duplikasi date math) — "20260230" mis. tetap ditolak -> null.
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

export type CreatorAnalysisRow = {
  name: string;
  username: string;
  bindingStatus: string | null;
  city: string | null;
  creatorLevel: string | null;
  salesValue: number | null;
  orders: number | null;
  aov: number | null;
  redemptionAmount: number | null;
  redeemedOrders: number | null;
  newPosts: number | null;
  postsWithSales: number | null;
  liveStreams: number | null;
  validLiveStreams: number | null;
};

export type CreatorAnalysisSkip = { rowIndex: number; reason: string };

export type ParseCreatorAnalysisResult =
  | {
      ok: true;
      periodStart: string;
      periodEnd: string;
      creatorLevelFilter: string | null;
      rows: CreatorAnalysisRow[];
      skipped: CreatorAnalysisSkip[];
    }
  | { ok: false; error: string };

export type WorkbookSheet = { name: string; cells: string[][] };

function normalizeHeaderKey(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ");
}

// Header sheet Data persis sesuai spesifikasi export — dipetakan by EXACT match (beda
// dgn parsers.ts:HEADER_ALIASES yg contains/alias ID-EN, di sini formatnya sudah pasti).
const DATA_FIELD_MAP: Record<string, keyof CreatorAnalysisRow> = {
  "creator name": "name",
  "creator id": "username",
  "binding status": "bindingStatus",
  "creator city": "city",
  "creator level": "creatorLevel",
  "sales value": "salesValue",
  "orders": "orders",
  "aov": "aov",
  "redemption amount": "redemptionAmount",
  "redeemed orders": "redeemedOrders",
  "new posts": "newPosts",
  "posts with sales": "postsWithSales",
  "live streams": "liveStreams",
  "valid live streams": "validLiveStreams",
};

const NUMERIC_FIELDS = new Set<keyof CreatorAnalysisRow>([
  "salesValue",
  "orders",
  "aov",
  "redemptionAmount",
  "redeemedOrders",
  "newPosts",
  "postsWithSales",
  "liveStreams",
  "validLiveStreams",
]);

// Cari indeks kolom header yang MENGANDUNG `needle` (case-insensitive) — dipakai utk
// sheet Filter yg header-nya bisa sedikit bervariasi ("Start date" dst), beda dgn sheet
// Data yg exact-match via DATA_FIELD_MAP.
function findColumnIndexContaining(headerRow: string[], needle: string): number {
  return headerRow.findIndex((h) => normalizeHeaderKey(h).includes(needle));
}

function findSheet(sheets: WorkbookSheet[], name: string): WorkbookSheet | null {
  return sheets.find((s) => s.name.trim().toLowerCase() === name) ?? null;
}

export function parseCreatorAnalysisWorkbook(sheets: WorkbookSheet[]): ParseCreatorAnalysisResult {
  const filterSheet = findSheet(sheets, "filter");
  const dataSheet = findSheet(sheets, "data");
  if (!filterSheet || !dataSheet) {
    const missing = [!filterSheet ? "Filter" : null, !dataSheet ? "Data" : null].filter(Boolean).join(" dan ");
    return { ok: false, error: `Workbook tidak lengkap: sheet ${missing} tidak ditemukan.` };
  }

  // ---- Sheet Filter: periode + filter level kreator ----
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
      error: `Tanggal periode di sheet Filter tidak valid (format harus YYYYMMDD): "${filterValues[startCol] ?? ""}" s/d "${filterValues[endCol] ?? ""}".`,
    };
  }

  const w1w5 = validateW1W5Period(periodStart, periodEnd);
  if (!w1w5.ok) {
    return { ok: false, error: w1w5.message };
  }

  const levelCol = findColumnIndexContaining(filterHeader, "creator level");
  const levelRaw = levelCol !== -1 ? (filterValues[levelCol] ?? "").trim() : "";
  const creatorLevelFilter = levelRaw !== "" ? levelRaw : null;

  // ---- Sheet Data: baris per kreator ----
  const dataHeader = dataSheet.cells[0] ?? [];
  const fieldByColumn: (keyof CreatorAnalysisRow | null)[] = dataHeader.map(
    (h) => DATA_FIELD_MAP[normalizeHeaderKey(h)] ?? null,
  );
  if (!fieldByColumn.includes("username")) {
    return { ok: false, error: 'Sheet Data tidak punya kolom "Creator ID".' };
  }

  const rows: CreatorAnalysisRow[] = [];
  const skipped: CreatorAnalysisSkip[] = [];

  for (let r = 1; r < dataSheet.cells.length; r++) {
    const rowCells = dataSheet.cells[r];
    const rowIndex = r + 1; // nomor baris file asli (1-based, header = baris 1)

    if (rowCells.every((c) => (c ?? "").trim() === "")) {
      continue; // baris kosong total — bukan error, cuma diabaikan tanpa dicatat
    }

    const values: Partial<Record<keyof CreatorAnalysisRow, string>> = {};
    for (let c = 0; c < rowCells.length; c++) {
      const field = fieldByColumn[c];
      if (!field) continue;
      const v = (rowCells[c] ?? "").trim();
      if (v !== "") values[field] = v;
    }

    const username = values.username ?? "";
    if (username === "") {
      skipped.push({ rowIndex, reason: "Baris tanpa Creator ID" });
      continue;
    }

    const nameRaw = values.name?.trim();
    const row: CreatorAnalysisRow = {
      name: nameRaw && nameRaw !== "" ? nameRaw : username,
      username,
      bindingStatus: values.bindingStatus ?? null,
      city: values.city ?? null,
      creatorLevel: values.creatorLevel ?? null,
      salesValue: null,
      orders: null,
      aov: null,
      redemptionAmount: null,
      redeemedOrders: null,
      newPosts: null,
      postsWithSales: null,
      liveStreams: null,
      validLiveStreams: null,
    };

    for (const field of NUMERIC_FIELDS) {
      const raw = values[field];
      if (raw !== undefined) {
        (row[field] as number | null) = parsePlainNumber(raw);
      }
    }

    // Kreator dengan semua metrik nol (mis. GMV 0) TETAP dikembalikan — bukan kriteria skip.
    rows.push(row);
  }

  return { ok: true, periodStart, periodEnd, creatorLevelFilter, rows, skipped };
}

// Deteksi ringan format "Creator Analysis" — dipakai router ingest utk memilih parser
// yang tepat tanpa harus parse penuh (& tanpa menebak isi bila header tak cocok).
export function isCreatorAnalysisWorkbook(sheets: WorkbookSheet[]): boolean {
  return sheets.some((s) => {
    const header = (s.cells[0] ?? []).map(normalizeHeaderKey);
    return header.includes("creator id") && header.includes("sales value");
  });
}
