/**
 * MCN ingest pipeline: parse raw rows → aggregate → top-N products.
 * Drop-raw design: only 3 aggregates stored.
 */

/**
 * Raw row parsed from CSV/XLSX.
 */
export interface RawRow {
  creator_name?: string;
  shop_id?: string;
  product_id?: string;
  product_name?: string;
  gmv?: number;
  orders?: number;
  items_sold?: number;
  ctr?: number;
  ctor?: number;
  [key: string]: any;
}

/**
 * Aggregated creator-period summary.
 */
export interface CreatorPeriodSummary {
  creator_name: string;
  period_start: string;
  gmv_total: number;
  affiliate_gmv: number;
  affiliate_live_gmv: number;
  affiliate_video_gmv: number;
  live_orders: number;
  video_orders: number;
  orders: number;
  items_sold: number;
  refund_gmv: number;
  ctr: number | null;
  ctor: number | null;
  live_pct: number | null;
}

/**
 * Parse platform raw rows (CSV/XLSX cells).
 * Skips "Summary" rows, normalizes header, validates each row.
 * Returns {rows, skipped, creatorNames, headerDiagnostic}.
 */
export function parsePlatformRows(
  cells: string[][],
  headerMapping?: Record<string, number>
): {
  rows: RawRow[];
  skipped: Array<{ row: number; reason: string }>;
  creatorNames: Set<string>;
  headerDiagnostic: {
    found: string[];
    expected: string[];
  };
} {
  const expected = [
    'creator_name',
    'shop_id',
    'product_id',
    'product_name',
    'gmv',
    'orders',
    'items_sold',
  ];

  if (cells.length < 1) {
    return {
      rows: [],
      skipped: [{ row: 0, reason: 'file kosong' }],
      creatorNames: new Set(),
      headerDiagnostic: { found: [], expected },
    };
  }

  // Guess header row (row 0 or search for recognizable column)
  let headerRow = cells[0];
  let headerRowIdx = 0;

  // Check if row 0 looks like a header
  const firstRowIsHeader = expected.some((exp) =>
    headerRow.some((cell) =>
      cell.toLowerCase().includes(exp.replace(/_/g, ' '))
    )
  );

  if (!firstRowIsHeader && cells.length > 1) {
    // Try to find header row
    for (let i = 0; i < Math.min(cells.length, 5); i++) {
      if (
        expected.some((exp) =>
          cells[i].some((cell) =>
            cell.toLowerCase().includes(exp.replace(/_/g, ' '))
          )
        )
      ) {
        headerRow = cells[i];
        headerRowIdx = i;
        break;
      }
    }
  }

  // Build mapping if not provided
  let mapping = headerMapping;
  if (!mapping) {
    const aliases: Record<string, string> = {
      'creator name': 'creator_name',
      'creator': 'creator_name',
      'shop id': 'shop_id',
      'shop': 'shop_id',
      'product id': 'product_id',
      'product': 'product_id',
      'product name': 'product_name',
      'gmv': 'gmv',
      'total gmv': 'gmv',
      'orders': 'orders',
      'order': 'orders',
      'items sold': 'items_sold',
      'quantity': 'items_sold',
      'ctr': 'ctr',
      'ctor': 'ctor',
    };

    mapping = {};
    for (let i = 0; i < headerRow.length; i++) {
      const key = headerRow[i].toLowerCase().trim();
      const normalized = aliases[key] || key;
      mapping[normalized] = i;
    }
  }

  // Parse rows (skip summary, validate)
  const rows: RawRow[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];
  const creatorNames = new Set<string>();

  for (let i = headerRowIdx + 1; i < cells.length; i++) {
    const cell = cells[i];

    // Skip "Summary" rows
    if (cell.some((c) => c.toLowerCase() === 'summary')) {
      skipped.push({ row: i + 1, reason: 'baris summary' });
      continue;
    }

    // Extract fields
    const creatorName = cell[mapping['creator_name'] ?? -1];
    const shopId = cell[mapping['shop_id'] ?? -1];
    const productId = cell[mapping['product_id'] ?? -1];
    const productName = cell[mapping['product_name'] ?? -1];

    // Validate mandatory
    if (!shopId || !productId) {
      skipped.push({
        row: i + 1,
        reason: 'shop_id atau product_id kosong',
      });
      continue;
    }

    // Parse numbers
    const gmv = parseFloat(cell[mapping['gmv'] ?? -1] || '0');
    const orders = parseInt(cell[mapping['orders'] ?? -1] || '0', 10);
    const itemsSold = parseInt(cell[mapping['items_sold'] ?? -1] || '0', 10);
    const ctr = parseFloat(cell[mapping['ctr'] ?? -1] || '');
    const ctor = parseFloat(cell[mapping['ctor'] ?? -1] || '');

    if (creatorName) {
      creatorNames.add(creatorName);
    }

    rows.push({
      creator_name: creatorName || 'Unknown',
      shop_id: shopId,
      product_id: productId,
      product_name: productName || '',
      gmv: isNaN(gmv) ? 0 : gmv,
      orders: isNaN(orders) ? 0 : orders,
      items_sold: isNaN(itemsSold) ? 0 : itemsSold, // note: 0 is kept, not skipped
      ctr: isNaN(ctr) ? undefined : ctr,
      ctor: isNaN(ctor) ? undefined : ctor,
    });
  }

  const headerDiagnostic = {
    found: Object.keys(mapping),
    expected,
  };

  return { rows, skipped, creatorNames, headerDiagnostic };
}

/**
 * Aggregate rows per creator-period into summary, subcat-segment, top-N products.
 * CTR/CTOR weighted by GMV; live_pct guarded against div-0 → null.
 */
export function aggregateRows(
  rows: RawRow[],
  periodStart: string,
  periodEnd: string,
  config?: {
    top_n_products?: number;
    price_bounds?: Record<string, number>;
  }
): {
  summaries: CreatorPeriodSummary[];
  subcatSegments: Array<{
    creator_name: string;
    category_l2: string;
    price_segment: string | null;
    gmv: number;
    items_sold: number;
  }>;
  topProducts: Array<{
    creator_name: string;
    product_id: string;
    product_name: string;
    shop_id: string;
    gmv: number;
    items_sold: number;
    rank: number;
  }>;
} {
  const topN = config?.top_n_products ?? 20;

  // Group by creator
  const byCreator: Record<string, RawRow[]> = {};
  for (const row of rows) {
    const name = row.creator_name || 'Unknown';
    if (!byCreator[name]) byCreator[name] = [];
    byCreator[name].push(row);
  }

  // Aggregate per creator
  const summaries: CreatorPeriodSummary[] = [];
  const allProducts: Array<{
    creator_name: string;
    product_id: string;
    product_name: string;
    shop_id: string;
    gmv: number;
    items_sold: number;
  }> = [];

  for (const [creatorName, creatorRows] of Object.entries(byCreator)) {
    let gmvTotal = 0;
    let affiliateGmv = 0;
    let affiliateLiveGmv = 0;
    let affiliateVideoGmv = 0;
    let liveOrders = 0;
    let videoOrders = 0;
    let orders = 0;
    let itemsSold = 0;
    let refundGmv = 0;
    let ctrWeighted = 0;
    let ctorWeighted = 0;
    let gmvWeightTotal = 0;

    for (const row of creatorRows) {
      gmvTotal += row.gmv ?? 0;
      affiliateGmv += row.gmv ?? 0;
      orders += row.orders ?? 0;
      itemsSold += row.items_sold ?? 0;

      // Weighted CTR/CTOR by GMV
      if ((row.ctr ?? 0) > 0 && (row.gmv ?? 0) > 0) {
        ctrWeighted += row.ctr * row.gmv;
        gmvWeightTotal += row.gmv;
      }
      if ((row.ctor ?? 0) > 0 && (row.gmv ?? 0) > 0) {
        ctorWeighted += row.ctor * row.gmv;
      }

      // Collect for top-N
      allProducts.push({
        creator_name: creatorName,
        product_id: row.product_id || '',
        product_name: row.product_name || '',
        shop_id: row.shop_id || '',
        gmv: row.gmv ?? 0,
        items_sold: row.items_sold ?? 0,
      });
    }

    // Calculate weighted averages; guard live_pct div-0 → null
    const ctr = gmvWeightTotal > 0 ? ctrWeighted / gmvWeightTotal : null;
    const ctor = gmvWeightTotal > 0 ? ctorWeighted / gmvWeightTotal : null;
    const livePct = orders > 0 ? liveOrders / orders : null;

    summaries.push({
      creator_name: creatorName,
      period_start: periodStart,
      gmv_total: gmvTotal,
      affiliate_gmv: affiliateGmv,
      affiliate_live_gmv: affiliateLiveGmv,
      affiliate_video_gmv: affiliateVideoGmv,
      live_orders: liveOrders,
      video_orders: videoOrders,
      orders,
      items_sold: itemsSold,
      refund_gmv: refundGmv,
      ctr,
      ctor,
      live_pct: livePct,
    });
  }

  // Top-N products (per creator, ranked by GMV)
  const topProducts: Array<{
    creator_name: string;
    product_id: string;
    product_name: string;
    shop_id: string;
    gmv: number;
    items_sold: number;
    rank: number;
  }> = [];

  for (const [creatorName, creatorProducts] of Object.entries(
    allProducts.reduce(
      (acc, p) => {
        if (!acc[p.creator_name]) acc[p.creator_name] = [];
        acc[p.creator_name].push(p);
        return acc;
      },
      {} as Record<string, typeof allProducts>
    )
  )) {
    const sorted = creatorProducts.sort((a, b) => b.gmv - a.gmv);
    for (let i = 0; i < Math.min(topN, sorted.length); i++) {
      topProducts.push({
        ...sorted[i],
        rank: i + 1,
      });
    }
  }

  return {
    summaries,
    subcatSegments: [], // TODO: implement subcat analysis if needed
    topProducts,
  };
}
