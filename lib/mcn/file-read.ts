/**
 * File reading utilities for MCN ingest.
 * Supports CSV and XLSX (via xlsx library); computes file hash for batch_id.
 */

import { createHash } from 'crypto';

/**
 * Read File from FormData and compute sha256 hash (8-char prefix).
 * @returns {content: string, hash8: string} for CSV content directly; XLSX must be processed separately
 */
export async function readAndHashFile(file: File): Promise<{
  content: string;
  hash8: string;
}> {
  const buffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(buffer);

  // Compute hash
  const hash = createHash('sha256');
  hash.update(Buffer.from(uint8));
  const fullHash = hash.digest('hex');
  const hash8 = fullHash.substring(0, 8);

  // Read content
  let content = '';
  if (file.name.endsWith('.csv')) {
    // CSV: decode UTF-8 string
    const decoder = new TextDecoder('utf-8');
    content = decoder.decode(uint8);
  } else if (file.name.endsWith('.xlsx')) {
    // XLSX: will be processed by parseXlsxToRows; return empty for now
    content = '';
  } else {
    throw new Error('[format file tidak didukung; gunakan CSV atau XLSX]');
  }

  return { content, hash8 };
}

/**
 * Parse CSV string to 2D array (cell rows).
 * Handles quote-escaped fields and line breaks.
 * @returns cells: string[][]
 */
export function parseCsvToRows(csv: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const nextChar = csv[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        currentCell += '"';
        i++;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field delimiter
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // Row delimiter
      if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.length > 0) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentCell = '';
      }
      // Skip \r\n or \n\r
      if ((char === '\n' && nextChar === '\r') || (char === '\r' && nextChar === '\n')) {
        i++;
      }
    } else {
      currentCell += char;
    }
  }

  // Final cell/row
  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.length > 0) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Normalize CSV header row: alias ID→EN, strip whitespace.
 * Aliases: "Nama Kampanye" / "Nama_Campaiagn" (typo) → "campaign_name", etc.
 * @returns {normalized: string[], mapping: Record<string, number>} for header lookups
 */
export function normalizeHeaders(headerRow: string[]): {
  normalized: string[];
  mapping: Record<string, number>;
} {
  const aliases: Record<string, string> = {
    // ID → EN (common typos included)
    'creator name': 'creator_name',
    'creator_name': 'creator_name',
    'handle': 'creator_name',
    'nama_creator': 'creator_name',
    'nama creator': 'creator_name',

    'period': 'period',
    'minggu': 'period',
    'week': 'period',

    'shop id': 'shop_id',
    'shop_id': 'shop_id',
    'shop': 'shop_id',

    'product id': 'product_id',
    'product_id': 'product_id',
    'product': 'product_id',

    'product name': 'product_name',
    'product_name': 'product_name',

    'gmv': 'gmv',
    'gmv_total': 'gmv',
    'total gmv': 'gmv',

    'orders': 'orders',
    'order': 'orders',

    'items sold': 'items_sold',
    'items_sold': 'items_sold',
    'quantity': 'items_sold',

    'ctr': 'ctr',
    'clickthrough rate': 'ctr',

    'ctor': 'ctor',
    'conversion rate': 'ctor',

    // Campaign aliases
    'campaign name': 'campaign_name',
    'campaign_name': 'campaign_name',
    'nama campaign': 'campaign_name',
    'nama_campaign': 'campaign_name',
    'nama_campiagn': 'campaign_name', // typo

    'brand name': 'brand_name',
    'brand': 'brand_name',

    'pic': 'pic',
    'pic name': 'pic',
  };

  const normalized = headerRow.map((h) => {
    const key = h.toLowerCase().trim();
    return aliases[key] || key;
  });

  const mapping: Record<string, number> = {};
  for (let i = 0; i < normalized.length; i++) {
    mapping[normalized[i]] = i;
  }

  return { normalized, mapping };
}

/**
 * Extract date range from header/content.
 * Looks for patterns like "Week of 5-11 Aug 2025" or date columns.
 * Returns {start: YYYY-MM-DD, end: YYYY-MM-DD} or null.
 */
export function extractPeriodFromContent(
  headerRow: string[],
  content: string
): { start: string; end: string } | null {
  // Look for "Week of X-Y [Month] YYYY" pattern in header or first few rows
  const weekPattern = /week\s+of\s+(\d{1,2})\s*-\s*(\d{1,2})\s+([a-z]+)\s+(\d{4})/i;
  const match =
    headerRow.join(' ').match(weekPattern) ||
    content.split('\n')[0]?.match(weekPattern);

  if (match) {
    const [, startDay, endDay, monthName, yearStr] = match;
    const months: Record<string, number> = {
      january: 1, jan: 1,
      february: 2, feb: 2,
      march: 3, mar: 3,
      april: 4, apr: 4,
      may: 5,
      june: 6, jun: 6,
      july: 7, jul: 7,
      august: 8, aug: 8,
      september: 9, sep: 9,
      october: 10, oct: 10,
      november: 11, nov: 11,
      december: 12, dec: 12,
      januari: 1,
      februari: 2,
      maret: 3,
      mei: 5,
      juni: 6,
      juli: 7,
      agustus: 8,
      oktober: 10,
      november: 11,
      desember: 12,
    };

    const monthNum = months[monthName.toLowerCase()];
    const year = parseInt(yearStr, 10);

    if (monthNum) {
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        start: `${year}-${pad(monthNum)}-${pad(parseInt(startDay, 10))}`,
        end: `${year}-${pad(monthNum)}-${pad(parseInt(endDay, 10))}`,
      };
    }
  }

  return null;
}
