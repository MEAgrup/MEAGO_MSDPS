/**
 * MCN data parsers following porting guide §0.1–0.3
 * All functions: null if uncertain, never guess. Tolerant on input; strict on output.
 */

/**
 * Parse Rupiah amounts tolerant of koma/titik ribuan, kurung = negative.
 * @example "Rp 1.500.000" | "1,500,000" | "(500.000)" → number or null
 */
export function parseRupiah(raw: string | null | undefined): number | null {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip Rp prefix and whitespace
  let cleaned = trimmed.replace(/^Rp\s*/i, '').trim();

  // Detect kurung (negative)
  const isNegative = cleaned.startsWith('(') && cleaned.endsWith(')');
  if (isNegative) {
    cleaned = cleaned.slice(1, -1);
  }

  // Try both separators: strip non-digits except both . and ,
  // Logic: if last . or , is before 3 digits from end, it's thousands sep
  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let digitsOnlyStr: string;

  if (lastDot > lastComma) {
    // . is last sep; it could be decimal or thousands
    // If exactly 3 digits after ., treat as decimal; else thousands
    const afterDot = cleaned.substring(lastDot + 1);
    if (afterDot.length === 2 && /^\d{2}$/.test(afterDot)) {
      // Likely European: . = thousands, last , = decimal
      // But we don't see a , here, so just strip dots
      digitsOnlyStr = cleaned.replace(/\./g, '');
    } else if (afterDot.length === 3 && /^\d{3}$/.test(afterDot)) {
      // Likely thousands sep; remove it
      digitsOnlyStr = cleaned.replace(/\./g, '');
    } else {
      // Ambiguous; not confident
      return null;
    }
  } else if (lastComma > lastDot) {
    // , is last sep; same logic
    const afterComma = cleaned.substring(lastComma + 1);
    if (afterComma.length === 2 && /^\d{2}$/.test(afterComma)) {
      // Could be decimal; take as-is
      digitsOnlyStr = cleaned.replace(/\./g, '').replace(',', '.');
    } else if (afterComma.length === 3 && /^\d{3}$/.test(afterComma)) {
      // Thousands sep; remove
      digitsOnlyStr = cleaned.replace(/,/g, '');
    } else {
      return null;
    }
  } else {
    // No sep or both missing; try to parse as-is
    digitsOnlyStr = cleaned.replace(/[.,]/g, '');
  }

  const num = parseFloat(digitsOnlyStr);
  if (isNaN(num)) return null;

  return isNegative ? -num : num;
}

/**
 * Parse commission range min–max, optional %, optional isRange flag.
 * Returns {min, max, isRange, pct} or null if invalid.
 * Both min/max must be 0–100 if range; single value also accepted.
 * @example "5%" → {min: 5, max: 5, isRange: false, pct: 5}
 * @example "5-10%" → {min: 5, max: 10, isRange: true, pct: 5}
 * @example "invalid" → null
 */
export function parseCommission(raw: string | null | undefined): {
  min: number;
  max: number;
  isRange: boolean;
  pct: number;
} | null {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  // Remove trailing %
  let noPercent = trimmed.endsWith('%') ? trimmed.slice(0, -1).trim() : trimmed;

  // Detect range: split by - or ~
  const parts = noPercent.split(/[-~]/).map((p) => p.trim());
  let min: number | null = null;
  let max: number | null = null;

  if (parts.length === 1) {
    // Single value
    const num = parseFloat(parts[0]);
    if (isNaN(num) || num < 0 || num > 100) return null;
    min = max = num;
  } else if (parts.length === 2) {
    // Range
    const minNum = parseFloat(parts[0]);
    const maxNum = parseFloat(parts[1]);
    if (
      isNaN(minNum) ||
      isNaN(maxNum) ||
      minNum < 0 ||
      maxNum > 100 ||
      minNum > maxNum
    ) {
      return null;
    }
    min = minNum;
    max = maxNum;
  } else {
    return null;
  }

  return {
    min,
    max,
    isRange: min !== max,
    pct: min,
  };
}

/**
 * Parse flexible date: ID month names (Jan–Des), EN (Jan–Dec), day-first by default.
 * Falls back to month-first if day-first fails.
 * Returns ISO string (YYYY-MM-DD) or null if invalid calendar date.
 * @example "5 Jan 2025" → "2025-01-05"
 * @example "Januari 5, 2025" → "2025-01-05"
 * @example "30 Feb 2025" → null (invalid)
 */
export function parseFlexibleDate(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  const months: Record<string, number> = {
    // EN
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
    // ID
    januari: 1,
    februari: 2,
    maret: 3,
    april: 4,
    mei: 5,
    juni: 6,
    juli: 7,
    agustus: 8,
    september: 9,
    oktober: 10,
    november: 11,
    desember: 12,
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    mei: 5,
    jun: 6,
    jul: 7,
    agt: 8,
    sep: 9,
    okt: 10,
    nov: 11,
    des: 12,
  };

  // Extract month name, day, year
  const parts = trimmed
    .toLowerCase()
    .split(/[\s,/-]+/)
    .filter((p) => p.length > 0);

  let day: number | null = null;
  let month: number | null = null;
  let year: number | null = null;

  // Find month name
  let monthIdx = -1;
  for (let i = 0; i < parts.length; i++) {
    if (months[parts[i]]) {
      month = months[parts[i]];
      monthIdx = i;
      break;
    }
  }

  if (month === null) return null;

  // Extract day and year
  const remaining = [
    ...parts.slice(0, monthIdx),
    ...parts.slice(monthIdx + 1),
  ];
  const nums = remaining.map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));

  if (nums.length < 2) return null;

  // Day-first: first num = day, last = year
  day = nums[0];
  year = nums[nums.length - 1];

  // Validate day (1–31 per month)
  if (day < 1 || day > 31) return null;

  // Normalize year (assume 2000s if < 100)
  if (year < 100) year += 2000;

  // Validate date
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    // Try month-first fallback
    day = nums[nums.length - 1];
    const dateAlt = new Date(year, month - 1, day);
    if (
      dateAlt.getFullYear() !== year ||
      dateAlt.getMonth() !== month - 1 ||
      dateAlt.getDate() !== day
    ) {
      return null;
    }
    day = nums[nums.length - 1];
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse percentage (0–100).
 */
export function parsePercent(
  raw: string | null | undefined
): number | null {
  if (!raw || typeof raw !== 'string') return null;

  const num = parseFloat(raw.replace('%', '').trim());
  if (isNaN(num) || num < 0 || num > 100) return null;

  return num;
}

/**
 * Parse integer tolerantly (ignore non-digits, null if empty).
 */
export function parseIntTolerant(
  raw: string | null | undefined
): number | null {
  if (!raw || typeof raw !== 'string') return null;

  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  const num = parseInt(digits, 10);
  return isNaN(num) ? null : num;
}
