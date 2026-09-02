// Parser export TikTok GO "Content Analysis › Video List"
// (nama file: ContentAnalysis_VideoList_YYYYMMDD_YYYYMMDD.xlsx).
//
// Ini format KETIGA, berbeda dari dua parser yang sudah ada — jangan tertukar:
//   · `creator-analysis.ts` — "Creator Analysis", 1 baris = 1 kreator per minggu (W1–W5).
//   · `video-ingest.ts`     — "Video Performance", per video, TANPA kolom lokasi/merchant.
//   · file ini              — per POSTINGAN, DENGAN Location ID/name + verdict TikTok.
//
// Dipakai untuk memvalidasi bukti campaign kreator: post yang di-submit kreator dicocokkan
// ke baris export berdasarkan `Post ID`. Menggantikan rumus Google Spreadsheet manual
// (deteksi post id double, cek merchant tertaut, cek tanggal post).
//
// Konvensi rumah: TIDAK PERNAH menebak. Header wajib tidak cocok -> ok:false; baris tak
// lengkap -> masuk `skipped[]` beralasan, bukan dibuang diam-diam. Pure — tanpa import
// DB/React, supaya bisa diuji tanpa infrastruktur.

import { isValidCalendarDate, formatYMD, type YMD } from "./weeks";
import { normalizeIndustry, type Industry } from "./industry-normalize";

// ---- Helper angka ------------------------------------------------------------------
// Desimal-titik polos ("306336120.270811", "0.000000", "0.0094339"). BUKAN Rupiah —
// `parsers.ts:parseRupiah` kasusnya beda, jangan dipakai di sini. "0.000000" -> 0 (NOL,
// bukan null): nol adalah nilai sah, hanya sel kosong/tak terbaca yang jadi null.
export function parsePlainNumber(s: string): number | null {
  const trimmed = s.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseIntegerStrict(s: string): number | null {
  const n = parsePlainNumber(s);
  if (n === null) return null;
  return Number.isInteger(n) ? n : Math.trunc(n);
}

// "YYYYMMDD" -> "YYYY-MM-DD". Kalender divalidasi (mis. "20260230" -> null).
export function parseYmdCompact(s: string): YMD | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  if (!isValidCalendarDate(y, mo, d)) return null;
  return formatYMD(y, mo, d);
}

// ---- Tipe --------------------------------------------------------------------------

/** Verdict TikTok sendiri atas sebuah post. Nilai mentah dipertahankan di `statusRaw`. */
export type TiktokPostStatus = "valid" | "invalid";

export type ContentAnalysisRow = {
  /** Kunci utama. Unik di dalam satu file (terverifikasi 3334/3334 di sampel). */
  postId: string;
  postTitle: string | null;
  postDate: YMD;
  durationSec: number | null;

  /** Verdict TikTok: "Valid posts" / "Invalid posts". */
  status: TiktokPostStatus | null;
  statusRaw: string | null;
  /** "Collaboration package" (creator package) vs "Others" (manual). */
  taskType: string | null;
  /** "Managed creators" / "Other creators". */
  creatorType: string | null;

  /**
   * KUNCI PENCOCOKAN MERCHANT. Numerik & stabil.
   * JANGAN pakai `locationName` (ada varian kapitalisasi untuk Location ID yang sama)
   * dan JANGAN pakai `merchantRaw` (itu daftar platform OTA/delivery, bukan POI).
   */
  locationId: string;
  locationName: string | null;
  locationCity: string | null;
  /** Industri baris ini, sudah dinormalisasi ke kanonik `INDUSTRIES`. */
  locationIndustry: Industry | null;
  locationIndustryRaw: string | null;
  /** Daftar platform OTA/delivery ("Agoda,Klook,Traveloka"). BUKAN nama merchant. */
  merchantRaw: string | null;

  /** Username TikTok — sepadan dengan `mcn_creators.username`. */
  creatorUsername: string;
  creatorName: string | null;
  creatorLinkStatus: string | null;
  creatorCity: string | null;
  creatorLevel: string | null;

  salesValue: number | null;
  orders: number | null;
  redemptionAmount: number | null;
  redeemedOrders: number | null;
  videoViews: number | null;
  ctr: number | null;
  cvr: number | null;
  aov: number | null;
  videoCompletionRate: number | null;
  likeRate: number | null;
  commentRate: number | null;
};

export type ContentAnalysisSkip = { rowIndex: number; reason: string };

export type ContentAnalysisResult =
  | {
      ok: true;
      /** Window tarikan dashboard, dari sheet `Filter`. Post di luar ini TIDAK ada di file. */
      windowStart: YMD;
      windowEnd: YMD;
      industry: Industry | null;
      industryRaw: string | null;
      postDateScope: string | null;
      rows: ContentAnalysisRow[];
      skipped: ContentAnalysisSkip[];
      /** Label industri tak dikenal yang ditemui — supaya bisa didaftarkan, bukan ditelan. */
      unknownIndustries: string[];
    }
  | { ok: false; error: string };

export type WorkbookSheet = { name: string; cells: string[][] };

// ---- Pemetaan header ---------------------------------------------------------------

function normalizeHeaderKey(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ");
}

type Field = keyof ContentAnalysisRow;

// Exact match — header export sudah pasti (terverifikasi byte-identik di dua file sampel
// dengan industri berbeda). Kolom tak dikenal diabaikan, tidak bikin gagal.
const DATA_FIELD_MAP: Record<string, Field> = {
  "location industry": "locationIndustryRaw",
  status: "statusRaw",
  "creator type": "creatorType",
  "post id": "postId",
  "post title": "postTitle",
  "post date": "postDate",
  duration: "durationSec",
  "task type": "taskType",
  "location id": "locationId",
  "location name": "locationName",
  "location city": "locationCity",
  merchant: "merchantRaw",
  "creator name": "creatorName",
  "creator id": "creatorUsername",
  "creator link status": "creatorLinkStatus",
  "creator city": "creatorCity",
  "creator level": "creatorLevel",
  "sales value": "salesValue",
  orders: "orders",
  "redemption amount": "redemptionAmount",
  "redeemed orders": "redeemedOrders",
  "video views": "videoViews",
  ctr: "ctr",
  cvr: "cvr",
  aov: "aov",
  "video completion rate": "videoCompletionRate",
  "like rate": "likeRate",
  "comment rate": "commentRate",
};

const DECIMAL_FIELDS: Field[] = [
  "salesValue",
  "redemptionAmount",
  "ctr",
  "cvr",
  "aov",
  "videoCompletionRate",
  "likeRate",
  "commentRate",
];

const INTEGER_FIELDS: Field[] = ["orders", "redeemedOrders", "videoViews", "durationSec"];

// Tanpa ketiganya sebuah baris tidak bisa dipakai memvalidasi apa pun.
const REQUIRED_FIELDS: Field[] = ["postId", "locationId", "creatorUsername"];

function findColumnIndexContaining(headerRow: string[], needle: string): number {
  return headerRow.findIndex((h) => normalizeHeaderKey(h).includes(needle));
}

function findSheet(sheets: WorkbookSheet[], name: string): WorkbookSheet | null {
  return sheets.find((s) => s.name.trim().toLowerCase() === name) ?? null;
}

function parseStatus(raw: string | null): TiktokPostStatus | null {
  if (raw === null) return null;
  const k = raw.toLowerCase().trim();
  if (k.startsWith("valid")) return "valid";
  if (k.startsWith("invalid")) return "invalid";
  return null;
}

// ---- Parser utama ------------------------------------------------------------------

export function parseContentAnalysisWorkbook(sheets: WorkbookSheet[]): ContentAnalysisResult {
  const filterSheet = findSheet(sheets, "filter");
  const dataSheet = findSheet(sheets, "data");
  if (!filterSheet || !dataSheet) {
    const missing = [!filterSheet ? "Filter" : null, !dataSheet ? "Data" : null].filter(Boolean).join(" dan ");
    return { ok: false, error: `Workbook tidak lengkap: sheet ${missing} tidak ditemukan.` };
  }

  // ---- Sheet Filter: window tarikan + industri ----
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

  const windowStart = parseYmdCompact(filterValues[startCol] ?? "");
  const windowEnd = parseYmdCompact(filterValues[endCol] ?? "");
  if (windowStart === null || windowEnd === null) {
    return {
      ok: false,
      error:
        `Window di sheet Filter tidak valid (format harus YYYYMMDD): ` +
        `"${filterValues[startCol] ?? ""}" s/d "${filterValues[endCol] ?? ""}".`,
    };
  }
  if (windowEnd < windowStart) {
    return { ok: false, error: `Window terbalik: End date (${windowEnd}) sebelum Start date (${windowStart}).` };
  }
  // CATATAN: window di sini SENGAJA tidak divalidasi sebagai W1–W5 (beda dgn
  // creator-analysis.ts). Window campaign bebas — sampel nyata 1–3 Agustus (3 hari).

  const industryCol = findColumnIndexContaining(filterHeader, "industry");
  const industryRaw = industryCol !== -1 ? (filterValues[industryCol] ?? "").trim() || null : null;
  const industry = normalizeIndustry(industryRaw);

  const scopeCol = findColumnIndexContaining(filterHeader, "post date");
  const postDateScope = scopeCol !== -1 ? (filterValues[scopeCol] ?? "").trim() || null : null;

  // ---- Sheet Data: 1 baris = 1 postingan ----
  const dataHeader = dataSheet.cells[0] ?? [];
  const fieldByColumn: (Field | null)[] = dataHeader.map((h) => DATA_FIELD_MAP[normalizeHeaderKey(h)] ?? null);

  const missingRequired = REQUIRED_FIELDS.filter((f) => !fieldByColumn.includes(f));
  if (missingRequired.length > 0) {
    const labels: Record<string, string> = {
      postId: "Post ID",
      locationId: "Location ID",
      creatorUsername: "Creator ID",
    };
    return {
      ok: false,
      error: `Sheet Data tidak punya kolom wajib: ${missingRequired.map((f) => labels[f] ?? f).join(", ")}.`,
    };
  }
  if (!fieldByColumn.includes("postDate")) {
    return { ok: false, error: 'Sheet Data tidak punya kolom "Post date".' };
  }

  const rows: ContentAnalysisRow[] = [];
  const skipped: ContentAnalysisSkip[] = [];
  const unknownIndustrySet = new Set<string>();

  for (let r = 1; r < dataSheet.cells.length; r++) {
    const cells = dataSheet.cells[r];
    const rowIndex = r + 1; // nomor baris file asli (1-based, header = baris 1)

    if (!cells || cells.every((c) => (c ?? "").trim() === "")) continue; // baris kosong: abaikan diam-diam

    const values: Partial<Record<Field, string>> = {};
    for (let c = 0; c < cells.length; c++) {
      const field = fieldByColumn[c];
      if (!field) continue;
      const v = (cells[c] ?? "").trim();
      if (v !== "") values[field] = v;
    }

    const postId = values.postId ?? "";
    if (postId === "") {
      skipped.push({ rowIndex, reason: "Baris tanpa Post ID" });
      continue;
    }
    const locationId = values.locationId ?? "";
    if (locationId === "") {
      skipped.push({ rowIndex, reason: `Post ${postId}: tanpa Location ID` });
      continue;
    }
    const creatorUsername = values.creatorUsername ?? "";
    if (creatorUsername === "") {
      skipped.push({ rowIndex, reason: `Post ${postId}: tanpa Creator ID` });
      continue;
    }
    const postDate = parseYmdCompact(values.postDate ?? "");
    if (postDate === null) {
      skipped.push({ rowIndex, reason: `Post ${postId}: Post date tidak valid ("${values.postDate ?? ""}")` });
      continue;
    }

    const industryRawRow = values.locationIndustryRaw ?? null;
    const industryRow = normalizeIndustry(industryRawRow);
    if (industryRawRow !== null && industryRow === null) unknownIndustrySet.add(industryRawRow);

    const statusRaw = values.statusRaw ?? null;

    const row: ContentAnalysisRow = {
      postId,
      postTitle: values.postTitle ?? null,
      postDate,
      durationSec: null,
      status: parseStatus(statusRaw),
      statusRaw,
      taskType: values.taskType ?? null,
      creatorType: values.creatorType ?? null,
      locationId,
      locationName: values.locationName ?? null,
      locationCity: values.locationCity ?? null,
      locationIndustry: industryRow,
      locationIndustryRaw: industryRawRow,
      merchantRaw: values.merchantRaw ?? null,
      creatorUsername: creatorUsername.toLowerCase(),
      creatorName: values.creatorName ?? null,
      creatorLinkStatus: values.creatorLinkStatus ?? null,
      creatorCity: values.creatorCity ?? null,
      creatorLevel: values.creatorLevel ?? null,
      salesValue: null,
      orders: null,
      redemptionAmount: null,
      redeemedOrders: null,
      videoViews: null,
      ctr: null,
      cvr: null,
      aov: null,
      videoCompletionRate: null,
      likeRate: null,
      commentRate: null,
    };

    for (const f of DECIMAL_FIELDS) {
      const raw = values[f];
      if (raw !== undefined) (row[f] as number | null) = parsePlainNumber(raw);
    }
    for (const f of INTEGER_FIELDS) {
      const raw = values[f];
      if (raw !== undefined) (row[f] as number | null) = parseIntegerStrict(raw);
    }

    rows.push(row);
  }

  return {
    ok: true,
    windowStart,
    windowEnd,
    industry,
    industryRaw,
    postDateScope,
    rows,
    skipped,
    unknownIndustries: [...unknownIndustrySet],
  };
}

// Deteksi ringan format — dipakai router ingest untuk memilih parser yang tepat tanpa
// harus parse penuh. Sengaja memeriksa kombinasi kolom yang HANYA ada di format ini
// ("location id" + "post id"), supaya tidak bentrok dengan Creator Analysis / Video
// Performance yang juga punya "creator id".
export function isContentAnalysisWorkbook(sheets: WorkbookSheet[]): boolean {
  return sheets.some((s) => {
    const header = (s.cells[0] ?? []).map(normalizeHeaderKey);
    return header.includes("post id") && header.includes("location id") && header.includes("creator id");
  });
}
