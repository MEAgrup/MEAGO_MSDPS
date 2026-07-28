// Parser export TikTok "Creator Analysis — PostOnly / Managed Creators" (workbook XLSX
// 2 sheet: Filter & Data). Ini slice VIDEO/POST saja (tanpa live), jadi "Sales value"
// pada file ini = GMV dari video/post — sumber angka "GMV Video Mingguan".
//
// PENTING: satu baris = satu KREATOR untuk satu minggu (BUKAN satu video). File tidak
// punya kolom Video ID; metrik post diagregasi platform (New posts, Video views, CTR…).
//
// Sama seperti lib/mcn/parsers.ts & creator-analysis.ts: TIDAK PERNAH menebak — header
// tak cocok -> error yang MENYEBUT nama kolomnya, baris tak lengkap -> skipped[]
// beralasan (bukan diam-diam dibuang). Pure: tanpa import DB/React.

import { formatYMD, isValidCalendarDate, validateW1W5Period } from "./weeks";

// ---- parsePlainNumber --------------------------------------------------------------
// Angka desimal-titik POLOS ("299648500.776416", "0.042779853628402795", "0.000000") —
// BUKAN format Rupiah Indonesia (parseRupiah beda kasus, jangan dipakai di sini).
// Toleransi koma ribuan gaya EN ("1,234.56") dgn cara dibuang dulu. "0" -> 0 (NOL,
// bukan null) supaya kreator tanpa penjualan tetap tercatat sebagai nol.
export function parsePlainNumber(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ---- parseIntTolerant --------------------------------------------------------------
// Kolom hitungan (Orders, New posts, Video views…) yang kadang datang dgn ".0" atau
// koma ribuan. Desimal dipotong (bukan dibulatkan) — nilai aslinya memang integer.
export function parseIntTolerant(s: string): number | null {
  const n = parsePlainNumber(s);
  return n === null ? null : Math.trunc(n);
}

// ---- parseYmdCompact ---------------------------------------------------------------
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

// Satu baris = satu kreator untuk minggu tsb. CTR/CVR disimpan sebagai FRAKSI apa adanya
// dari file (0.0427… = 4,27%) — konversi ke persen hanya dilakukan saat menampilkan.
export type VideoGmvRow = {
  name: string;
  username: string;
  bindingStatus: string | null;
  city: string | null;
  creatorLevel: string | null;
  salesValue: number | null; // GMV video/post minggu ini
  orders: number | null;
  aov: number | null;
  redemptionAmount: number | null;
  redeemedOrders: number | null;
  newPosts: number | null;
  postsWithViews: number | null;
  postsWithSales: number | null;
  videoViews: number | null;
  ctr: number | null; // fraksi 0..1
  cvr: number | null; // fraksi 0..1
  avgViewsPerPost: number | null;
  avgSalesValuePerPost: number | null;
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

function normalizeHeaderKey(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ");
}

// Header sheet Data PERSIS sesuai file export — dipetakan by EXACT match (beda dgn
// parsers.ts:HEADER_ALIASES yg contains/alias ID-EN; di sini formatnya sudah pasti,
// dan justru perubahan formatlah yang ingin kita deteksi).
const DATA_FIELD_MAP: Record<string, keyof VideoGmvRow> = {
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
  "posts with views": "postsWithViews",
  "posts with sales": "postsWithSales",
  "video views": "videoViews",
  "ctr": "ctr",
  "cvr": "cvr",
  "avg. views per post": "avgViewsPerPost",
  "avg. sales value per post": "avgSalesValuePerPost",
};

// Kolom yang WAJIB ada. Bila export TikTok berubah bentuk, upload ditolak dgn menyebut
// nama kolom yang hilang — bukan diam-diam mengisi null (requirement validasi header).
const REQUIRED_HEADERS = Object.keys(DATA_FIELD_MAP);

const INT_FIELDS = new Set<keyof VideoGmvRow>([
  "orders",
  "redeemedOrders",
  "newPosts",
  "postsWithViews",
  "postsWithSales",
  "videoViews",
]);

const DECIMAL_FIELDS = new Set<keyof VideoGmvRow>([
  "salesValue",
  "aov",
  "redemptionAmount",
  "ctr",
  "cvr",
  "avgViewsPerPost",
  "avgSalesValuePerPost",
]);

// Cari indeks kolom header yang MENGANDUNG `needle` — dipakai utk sheet Filter yg
// header-nya bisa sedikit bervariasi ("Start date" dst), beda dgn sheet Data yg
// exact-match via DATA_FIELD_MAP.
function findColumnIndexContaining(headerRow: string[], needle: string): number {
  return headerRow.findIndex((h) => normalizeHeaderKey(h).includes(needle));
}

function findSheet(sheets: WorkbookSheet[], name: string): WorkbookSheet | null {
  return sheets.find((s) => s.name.trim().toLowerCase() === name) ?? null;
}

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
    return { ok: false, error: 'Sheet Filter tidak punya kolom "Start date" / "End date".' };
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

  // ---- Sheet Data: validasi header KETAT dulu, sebelum menyentuh baris data ----
  const dataHeader = dataSheet.cells[0] ?? [];
  const presentKeys = new Set(dataHeader.map(normalizeHeaderKey).filter((h) => h !== ""));
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !presentKeys.has(h));
  if (missingHeaders.length > 0) {
    // Sebut nama kolom apa adanya (pakai label seperti di file) supaya OD/CM langsung
    // tahu kolom mana yang berubah di export, tanpa harus membuka kode.
    const labels = missingHeaders.map((h) => `"${h}"`).join(", ");
    return {
      ok: false,
      error:
        `Format export berubah — kolom wajib tidak ditemukan di sheet Data: ${labels}. ` +
        `Header yang terbaca: ${[...presentKeys].map((h) => `"${h}"`).join(", ")}.`,
    };
  }

  const fieldByColumn: (keyof VideoGmvRow | null)[] = dataHeader.map(
    (h) => DATA_FIELD_MAP[normalizeHeaderKey(h)] ?? null,
  );

  const rows: VideoGmvRow[] = [];
  const skipped: VideoGmvSkip[] = [];

  for (let r = 1; r < dataSheet.cells.length; r++) {
    const rowCells = dataSheet.cells[r] ?? [];
    const rowIndex = r + 1; // nomor baris file asli (1-based, header = baris 1)

    if (rowCells.every((c) => (c ?? "").trim() === "")) {
      continue; // baris kosong total — bukan error, cuma diabaikan tanpa dicatat
    }

    const values: Partial<Record<keyof VideoGmvRow, string>> = {};
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
    const row: VideoGmvRow = {
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
      postsWithViews: null,
      postsWithSales: null,
      videoViews: null,
      ctr: null,
      cvr: null,
      avgViewsPerPost: null,
      avgSalesValuePerPost: null,
    };

    for (const field of INT_FIELDS) {
      const raw = values[field];
      if (raw !== undefined) (row[field] as number | null) = parseIntTolerant(raw);
    }
    for (const field of DECIMAL_FIELDS) {
      const raw = values[field];
      if (raw !== undefined) (row[field] as number | null) = parsePlainNumber(raw);
    }

    // Kreator dengan semua metrik nol (mis. GMV 0) TETAP dikembalikan — bukan kriteria skip.
    rows.push(row);
  }

  return { ok: true, periodStart, periodEnd, rows, skipped };
}

// Deteksi ringan format PostOnly — dipakai form GMV Video utk menolak file yang salah
// jenis sebelum parsing penuh. "Video views" + "CTR" adalah penanda slice post/video;
// export Creator Analysis biasa (yang mengisi creator_period_summary) tidak punya
// keduanya, ia punya "Live streams". Jadi pengecekan ini memisahkan kedua format.
export function isVideoGmvWorkbook(sheets: WorkbookSheet[]): boolean {
  return sheets.some((s) => {
    const header = (s.cells[0] ?? []).map(normalizeHeaderKey);
    return header.includes("creator id") && header.includes("video views") && header.includes("ctr");
  });
}
