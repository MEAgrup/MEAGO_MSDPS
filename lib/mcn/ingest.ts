// Parsing & agregasi laporan performa TikTok (Upload Data Mingguan). Proses-on-ingest,
// drop-raw: baris mentah TIDAK PERNAH masuk DB — modul ini hanya menghasilkan 3
// agregat (summary per creator, subcat x segmen harga, top-N produk) yang lalu
// ditulis lapisan action ke creator_period_summary / creator_subcat_segment_gmv /
// creator_top_products. cells[][] datang dari lib/mcn/file-read.ts (CSV/XLSX -> string[][]).

import { parseCommission, parseFlexibleDate, parseIntTolerant, parsePercent, parseRupiah } from "./parsers";

// ---- Header normalization & alias ID->EN -------------------------------------------

function normalizeHeaderKey(raw: string): string {
  return raw.toLowerCase().trim().replace(/\s+/g, " ");
}

// Alias header umum dari export TikTok (Indonesia & Inggris) -> nama field kanonik.
// Header yang tak dikenal jatuh ke fallback generik (spasi -> underscore) di
// resolveHeaderField, jadi kolom "asing" tak pernah bikin proses gagal — ia cuma
// diabaikan (tak dipetakan ke field manapun yang kita pakai).
const HEADER_ALIASES: Record<string, string> = {
  "nama produk": "product_name",
  "product name": "product_name",
  "id produk": "product_id",
  "product id": "product_id",
  "sku": "product_id",
  "id toko": "shop_id",
  "shop id": "shop_id",
  "toko id": "shop_id",
  "nama toko": "shop_name",
  "shop name": "shop_name",
  "nama kreator": "creator_name",
  "nama creator": "creator_name",
  "creator": "creator_name",
  "creator name": "creator_name",
  "kreator": "creator_name",
  "kategori": "category_l2",
  "kategori produk": "category_l2",
  "category": "category_l2",
  "sub kategori": "category_l2",
  "subcategory": "category_l2",
  "sub-category": "category_l2",
  "penjualan kotor": "gmv",
  "penjualan kotor (rp)": "gmv",
  "gmv": "gmv",
  "gross revenue": "gmv",
  "komisi": "commission",
  "commission": "commission",
  "estimasi komisi": "commission",
  "item terjual": "items_sold",
  "items sold": "items_sold",
  "produk terjual": "items_sold",
  "unit terjual": "items_sold",
  "pesanan": "orders",
  "orders": "orders",
  "jumlah pesanan": "orders",
  "pesanan live": "live_orders",
  "live orders": "live_orders",
  "pesanan video": "video_orders",
  "video orders": "video_orders",
  "gmv live": "live_gmv",
  "penjualan live": "live_gmv",
  "gmv video": "video_gmv",
  "penjualan video": "video_gmv",
  "pengembalian": "refund_gmv",
  "refund": "refund_gmv",
  "gmv refund": "refund_gmv",
  "nilai pengembalian": "refund_gmv",
  "ctr": "ctr",
  "click through rate": "ctr",
  "ctor": "ctor",
  "click to order rate": "ctor",
  "tanggal": "date_range",
  "periode": "date_range",
  "period": "date_range",
  "date": "date_range",
  "tanggal mulai": "period_start_col",
  "start date": "period_start_col",
  "periode mulai": "period_start_col",
  "tanggal selesai": "period_end_col",
  "end date": "period_end_col",
  "periode selesai": "period_end_col",
};

function resolveHeaderField(rawHeader: string): string {
  const key = normalizeHeaderKey(rawHeader);
  if (key in HEADER_ALIASES) return HEADER_ALIASES[key];
  return key.replace(/\s+/g, "_"); // fallback generik, kolom tak dikenal tetap "ada" tapi tak dipakai
}

// Kolom inti yang idealnya ditemukan — dipakai utk diagnostik bila 0 baris valid.
const EXPECTED_CORE_FIELDS = ["product_id", "shop_id", "gmv", "creator_name", "items_sold", "category_l2"];

// Pisah rentang tanggal "2026-07-01 ~ 2026-07-07". Sengaja TIDAK memakai "-" polos
// sbg pemisah (tanpa spasi wajib di sekitarnya) karena ISO date sendiri memakai "-" —
// "2026-07-01" tak boleh ikut kepotong jadi 3 bagian.
function splitDateRangeRaw(raw: string): string[] {
  return raw
    .split(/\s*(?:~|–|—)\s*|\s+(?:s\/d|sampai(?: dengan)?|to|-)\s+/i)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

export type ParsedRow = {
  rowNumber: number; // nomor baris di file asli (1 = header), utk traceability skipped[]
  productId: string;
  productName: string | null;
  shopId: string;
  shopName: string | null;
  creatorName: string; // "" bila kosong di sumber — TETAP diagregasi (bukan kriteria skip)
  categoryL2: string | null;
  gmv: number | null;
  commissionPct: number | null;
  itemsSold: number | null; // 0 = valid (dihitung), bukan skip; null = kolom kosong/tak terparse
  orders: number | null;
  liveOrders: number | null;
  videoOrders: number | null;
  liveGmv: number | null;
  videoGmv: number | null;
  refundGmv: number | null;
  ctr: number | null;
  ctor: number | null;
};

export type SkippedRow = { row: number; reason: string };

export type HeaderDiagnostics = { found: string[]; expectedAny: string[] };

export type ParsePlatformResult = {
  rows: ParsedRow[];
  skipped: SkippedRow[];
  periodStart: string | null; // ISO YYYY-MM-DD
  periodEnd: string | null;
  headerDiagnostics?: HeaderDiagnostics;
};

export function parsePlatformRows(cells: string[][]): ParsePlatformResult {
  const skipped: SkippedRow[] = [];

  if (cells.length === 0) {
    return {
      rows: [],
      skipped,
      periodStart: null,
      periodEnd: null,
      headerDiagnostics: { found: [], expectedAny: EXPECTED_CORE_FIELDS },
    };
  }

  const headerRow = cells[0];
  const fieldByColumn: (string | null)[] = headerRow.map((h) =>
    h && h.trim() !== "" ? resolveHeaderField(h) : null,
  );
  const foundFields = fieldByColumn.filter((f): f is string => f !== null);

  const rows: ParsedRow[] = [];
  let periodStart: string | null = null;
  let periodEnd: string | null = null;

  for (let r = 1; r < cells.length; r++) {
    const rowCells = cells[r];
    const rowNumber = r + 1; // baris file asli (1-based, header = baris 1)

    const firstCell = (rowCells[0] ?? "").trim();
    if (/summary/i.test(firstCell)) {
      skipped.push({ row: rowNumber, reason: "Baris ringkasan (Summary) dilewati" });
      continue;
    }
    if (rowCells.every((c) => (c ?? "").trim() === "")) {
      continue; // baris kosong total — bukan error, cuma diabaikan tanpa dicatat
    }

    const values: Partial<Record<string, string>> = {};
    for (let c = 0; c < rowCells.length; c++) {
      const field = fieldByColumn[c];
      if (!field) continue;
      const v = (rowCells[c] ?? "").trim();
      if (v !== "") values[field] = v;
    }

    const productId = values["product_id"] ?? "";
    const shopId = values["shop_id"] ?? "";
    if (productId === "" || shopId === "") {
      skipped.push({ row: rowNumber, reason: "Baris tanpa product_id atau shop_id" });
      continue;
    }

    // Periode file: ambil dari baris pertama yang punya kolom tanggal valid.
    if (periodStart === null) {
      const dateRangeRaw = values["date_range"];
      if (dateRangeRaw) {
        const parts = splitDateRangeRaw(dateRangeRaw);
        if (parts.length >= 2) {
          periodStart = parseFlexibleDate(parts[0]);
          periodEnd = parseFlexibleDate(parts[parts.length - 1]);
        } else if (parts.length === 1) {
          const d = parseFlexibleDate(parts[0]);
          periodStart = d;
          periodEnd = d;
        }
      } else {
        const startRaw = values["period_start_col"];
        const endRaw = values["period_end_col"];
        if (startRaw) periodStart = parseFlexibleDate(startRaw);
        if (endRaw) periodEnd = parseFlexibleDate(endRaw);
      }
    }

    // items_sold=0 valid & TETAP diagregasi (GMV tetap dihitung; avg_price jadi null
    // di tahap aggregateRows karena pembagi 0).
    const itemsSold = values["items_sold"] !== undefined ? parseIntTolerant(values["items_sold"]!) : null;
    const commission = values["commission"] !== undefined ? parseCommission(values["commission"]!) : null;

    rows.push({
      rowNumber,
      productId,
      productName: values["product_name"] ?? null,
      shopId,
      shopName: values["shop_name"] ?? null,
      creatorName: values["creator_name"] ?? "",
      categoryL2: values["category_l2"] ?? null,
      gmv: values["gmv"] !== undefined ? parseRupiah(values["gmv"]!) : null,
      commissionPct: commission ? commission.pct : null,
      itemsSold,
      orders: values["orders"] !== undefined ? parseIntTolerant(values["orders"]!) : null,
      liveOrders: values["live_orders"] !== undefined ? parseIntTolerant(values["live_orders"]!) : null,
      videoOrders: values["video_orders"] !== undefined ? parseIntTolerant(values["video_orders"]!) : null,
      liveGmv: values["live_gmv"] !== undefined ? parseRupiah(values["live_gmv"]!) : null,
      videoGmv: values["video_gmv"] !== undefined ? parseRupiah(values["video_gmv"]!) : null,
      refundGmv: values["refund_gmv"] !== undefined ? parseRupiah(values["refund_gmv"]!) : null,
      ctr: values["ctr"] !== undefined ? parsePercent(values["ctr"]!) : null,
      ctor: values["ctor"] !== undefined ? parsePercent(values["ctor"]!) : null,
    });
  }

  const result: ParsePlatformResult = { rows, skipped, periodStart, periodEnd };
  if (rows.length === 0) {
    result.headerDiagnostics = { found: foundFields, expectedAny: EXPECTED_CORE_FIELDS };
  }
  return result;
}

// ---- Aggregation --------------------------------------------------------------------

export type PriceBounds = { low: number; entry: number; sweet: number; high: number };

export type IngestConfig = {
  topNProducts: number;
  priceBounds: PriceBounds;
};

export type CreatorSummary = {
  creatorName: string;
  gmvTotal: number;
  affiliateGmv: number;
  affiliateLiveGmv: number;
  affiliateVideoGmv: number;
  liveOrders: number;
  videoOrders: number;
  orders: number;
  itemsSold: number;
  refundGmv: number;
  ctr: number | null; // rata-rata tertimbang GMV per baris
  ctor: number | null; // idem
  livePct: number | null; // liveGmv / (liveGmv+videoGmv); null bila penyebut 0 (null != 0)
};

export type PriceSegment = "low" | "entry" | "sweet" | "high" | "premium";

export type SubcatSegmentGmv = {
  creatorName: string;
  categoryL2: string | null;
  priceSegment: PriceSegment | null; // null bila avg_price tak terdefinisi (items_sold=0/gmv null)
  gmv: number;
  itemsSold: number;
};

export type TopProduct = {
  creatorName: string;
  productId: string;
  productName: string | null;
  shopId: string;
  shopName: string | null;
  gmv: number;
  itemsSold: number;
  rank: number; // 1-based, per creator
};

export type AggregateResult = {
  summaries: CreatorSummary[];
  subcatSegments: SubcatSegmentGmv[];
  topProducts: TopProduct[];
};

function segmentFor(avgPrice: number | null, bounds: PriceBounds): PriceSegment | null {
  if (avgPrice === null) return null;
  if (avgPrice < bounds.low) return "low";
  if (avgPrice < bounds.entry) return "entry";
  if (avgPrice < bounds.sweet) return "sweet";
  if (avgPrice < bounds.high) return "high";
  return "premium";
}

type SummaryAcc = {
  gmvTotal: number;
  affiliateGmv: number;
  affiliateLiveGmv: number;
  affiliateVideoGmv: number;
  liveOrders: number;
  videoOrders: number;
  orders: number;
  itemsSold: number;
  refundGmv: number;
  weightedCtrSum: number;
  ctrWeightBasis: number;
  weightedCtorSum: number;
  ctorWeightBasis: number;
};

type ProductAcc = { productName: string | null; shopId: string; shopName: string | null; gmv: number; itemsSold: number };

// Satu pass atas `rows` yang sekaligus mengisi ketiga agregat (summary per creator,
// subcat x segmen harga, top-N produk) — bukan 3 pass terpisah.
export function aggregateRows(rows: ParsedRow[], config: IngestConfig): AggregateResult {
  const summaryMap = new Map<string, SummaryAcc>();
  const subcatMap = new Map<string, SubcatSegmentGmv>();
  const productMap = new Map<string, Map<string, ProductAcc>>(); // creator -> productId -> acc

  for (const row of rows) {
    const creator = row.creatorName;
    const gmv = row.gmv ?? 0; // baris tanpa GMV terparse kontribusinya 0 ke SUM (bukan klaim "GMV=0")

    // (a) summary per creator
    let acc = summaryMap.get(creator);
    if (!acc) {
      acc = {
        gmvTotal: 0,
        affiliateGmv: 0,
        affiliateLiveGmv: 0,
        affiliateVideoGmv: 0,
        liveOrders: 0,
        videoOrders: 0,
        orders: 0,
        itemsSold: 0,
        refundGmv: 0,
        weightedCtrSum: 0,
        ctrWeightBasis: 0,
        weightedCtorSum: 0,
        ctorWeightBasis: 0,
      };
      summaryMap.set(creator, acc);
    }
    acc.gmvTotal += gmv;
    acc.affiliateGmv += gmv;
    if (row.liveGmv !== null) acc.affiliateLiveGmv += row.liveGmv;
    if (row.videoGmv !== null) acc.affiliateVideoGmv += row.videoGmv;
    if (row.liveOrders !== null) acc.liveOrders += row.liveOrders;
    if (row.videoOrders !== null) acc.videoOrders += row.videoOrders;
    if (row.orders !== null) acc.orders += row.orders;
    if (row.itemsSold !== null) acc.itemsSold += row.itemsSold;
    if (row.refundGmv !== null) acc.refundGmv += row.refundGmv;
    if (row.ctr !== null) {
      acc.weightedCtrSum += row.ctr * gmv;
      acc.ctrWeightBasis += gmv;
    }
    if (row.ctor !== null) {
      acc.weightedCtorSum += row.ctor * gmv;
      acc.ctorWeightBasis += gmv;
    }

    // (b) subcat x segmen harga (segmen dari avg_price BARIS INI, bukan avg agregat)
    const avgPrice = row.itemsSold !== null && row.itemsSold > 0 && row.gmv !== null ? row.gmv / row.itemsSold : null;
    const segment = segmentFor(avgPrice, config.priceBounds);
    const subKey = `${creator} ${row.categoryL2 ?? ""} ${segment ?? ""}`;
    let sub = subcatMap.get(subKey);
    if (!sub) {
      sub = { creatorName: creator, categoryL2: row.categoryL2, priceSegment: segment, gmv: 0, itemsSold: 0 };
      subcatMap.set(subKey, sub);
    }
    sub.gmv += gmv;
    sub.itemsSold += row.itemsSold ?? 0;

    // (c) top produk (akumulasi per produk dulu; ranking & pemotongan top-N di akhir)
    let byProduct = productMap.get(creator);
    if (!byProduct) {
      byProduct = new Map<string, ProductAcc>();
      productMap.set(creator, byProduct);
    }
    let p = byProduct.get(row.productId);
    if (!p) {
      p = { productName: row.productName, shopId: row.shopId, shopName: row.shopName, gmv: 0, itemsSold: 0 };
      byProduct.set(row.productId, p);
    }
    p.gmv += gmv;
    p.itemsSold += row.itemsSold ?? 0;
  }

  const summaries: CreatorSummary[] = [...summaryMap.entries()].map(([creatorName, acc]) => {
    const liveVideoTotal = acc.affiliateLiveGmv + acc.affiliateVideoGmv;
    return {
      creatorName,
      gmvTotal: acc.gmvTotal,
      affiliateGmv: acc.affiliateGmv,
      affiliateLiveGmv: acc.affiliateLiveGmv,
      affiliateVideoGmv: acc.affiliateVideoGmv,
      liveOrders: acc.liveOrders,
      videoOrders: acc.videoOrders,
      orders: acc.orders,
      itemsSold: acc.itemsSold,
      refundGmv: acc.refundGmv,
      ctr: acc.ctrWeightBasis > 0 ? acc.weightedCtrSum / acc.ctrWeightBasis : null,
      ctor: acc.ctorWeightBasis > 0 ? acc.weightedCtorSum / acc.ctorWeightBasis : null,
      livePct: liveVideoTotal > 0 ? acc.affiliateLiveGmv / liveVideoTotal : null, // guard div-0: null != 0
    };
  });

  const subcatSegments = [...subcatMap.values()];

  const topN = Math.max(0, Math.trunc(config.topNProducts));
  const topProducts: TopProduct[] = [];
  for (const [creatorName, byProduct] of productMap.entries()) {
    const ranked = [...byProduct.entries()]
      .map(([productId, p]) => ({
        creatorName,
        productId,
        productName: p.productName,
        shopId: p.shopId,
        shopName: p.shopName,
        gmv: p.gmv,
        itemsSold: p.itemsSold,
      }))
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, topN)
      .map((p, idx) => ({ ...p, rank: idx + 1 }));
    topProducts.push(...ranked);
  }

  return { summaries, subcatSegments, topProducts };
}
