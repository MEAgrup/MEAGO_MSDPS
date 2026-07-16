/**
 * MCN W1–W5 week windows and calendar utilities.
 * All dates are YYYY-MM-DD strings (wall-clock, no timezone).
 * W1=1–7, W2=8–14, W3=15–21, W4=22–28, W5=29–akhir (last day of month).
 */

/**
 * W1–W5 window definitions for a given month.
 * @returns array of {start: YYYY-MM-DD, end: YYYY-MM-DD, window: 'W1'|'W2'|'W3'|'W4'|'W5'}
 */
export function w1w5WindowsOf(
  year: number,
  month: number
): Array<{ start: string; end: string; window: string }> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const monthStr = pad(month);

  // Last day of month
  const lastDay = new Date(year, month, 0).getDate();

  const windows = [
    { start: 1, end: 7, window: 'W1' },
    { start: 8, end: 14, window: 'W2' },
    { start: 15, end: 21, window: 'W3' },
    { start: 22, end: 28, window: 'W4' },
    { start: 29, end: lastDay, window: 'W5' },
  ];

  return windows.map((w) => ({
    start: `${year}-${monthStr}-${pad(w.start)}`,
    end: `${year}-${monthStr}-${pad(Math.min(w.end, lastDay))}`,
    window: w.window,
  }));
}

/**
 * Validate period_start–end matches exactly a W1–W5 window.
 * @throws error message detailing valid windows if mismatch
 * @returns {window: 'W1'|..., month: 'YYYY-MM'} if valid
 */
export function validateW1W5Period(
  start: string,
  end: string
): { window: string; month: string } {
  const startDate = parseISO(start);
  const endDate = parseISO(end);

  if (!startDate || !endDate) {
    throw new Error('[periode tidak valid: format YYYY-MM-DD]');
  }

  const year = startDate.getFullYear();
  const month = startDate.getMonth() + 1;

  // Check dates are in same month
  if (
    endDate.getFullYear() !== year ||
    endDate.getMonth() + 1 !== month
  ) {
    throw new Error('[periode lintas bulan tidak diperbolehkan]');
  }

  const windows = w1w5WindowsOf(year, month);
  const matched = windows.find(
    (w) => w.start === start && w.end === end
  );

  if (!matched) {
    const validStr = windows
      .map((w) => `${w.window}: ${w.start}–${w.end}`)
      .join(', ');
    throw new Error(`[periode tidak cocok W1–W5; valid: ${validStr}]`);
  }

  return {
    window: matched.window,
    month: `${year}-${String(month).padStart(2, '0')}`,
  };
}

/**
 * Return W# (1–5) for a date within a month, given the period_start date.
 * @param periodStart YYYY-MM-DD (start of W1, i.e., the 1st)
 * @param dateStr YYYY-MM-DD to classify
 * @returns 1–5, or null if outside month
 */
export function weekIndexOfDate(
  periodStart: string,
  dateStr: string
): number | null {
  const date = parseISO(dateStr);
  const start = parseISO(periodStart);

  if (!date || !start) return null;

  const day = date.getDate();

  if (day <= 7) return 1;
  if (day <= 14) return 2;
  if (day <= 21) return 3;
  if (day <= 28) return 4;
  return 5;
}

/**
 * Build monthly growth metrics from weekly rows.
 * Deduplication: per (creator, period_start), keep row with latest createdAt.
 * Kanonik: if multiple createdAt on same timestamp, prefer 1, 8, 15, 22, 29 (start dates).
 * Delta: vs previous filled week (null if none filled before).
 * Month growth: (last filled week − first filled week) / first filled week; null if no data.
 * @param rows array of {period_start: YYYY-MM-DD, value: number, createdAt: ISO, ...}
 * @returns {weeks: [{period_start, week#, value, delta, ...}], monthGrowth: number|null}
 */
export function buildMonthlyGrowth(
  rows: Array<{
    period_start: string;
    value: number;
    createdAt: string;
    [key: string]: any;
  }>
): {
  weeks: Array<{
    period_start: string;
    week: number;
    value: number | null;
    delta: number | null;
    [key: string]: any;
  }>;
  monthGrowth: number | null;
} {
  const deduped: Record<string, typeof rows[0]> = {};

  for (const row of rows) {
    const key = row.period_start;
    const existing = deduped[key];

    if (!existing) {
      deduped[key] = row;
    } else {
      // Keep latest createdAt; tie-break by kanonik (1, 8, 15, 22, 29)
      const existingDate = parseISO(existing.createdAt);
      const newDate = parseISO(row.createdAt);

      if (!existingDate || !newDate) continue;

      const cmp = newDate.getTime() - existingDate.getTime();
      if (cmp > 0) {
        deduped[key] = row;
      } else if (cmp === 0) {
        // Tie-break: prefer kanonik day
        const existingDay = parseISO(existing.period_start)?.getDate();
        const newDay = parseISO(row.period_start)?.getDate();
        const kanonik = [1, 8, 15, 22, 29];
        if (newDay && existingDay) {
          const newKanonik = kanonik.indexOf(newDay) >= 0;
          const existingKanonik = kanonik.indexOf(existingDay) >= 0;
          if (newKanonik && !existingKanonik) {
            deduped[key] = row;
          }
        }
      }
    }
  }

  // Sort by period_start
  const sorted = Object.values(deduped).sort((a, b) =>
    a.period_start.localeCompare(b.period_start)
  );

  // Add week# and delta
  let lastValue: number | null = null;
  const weeks = sorted.map((row) => {
    const day = parseISO(row.period_start)?.getDate() || 1;
    let week = 1;
    if (day <= 7) week = 1;
    else if (day <= 14) week = 2;
    else if (day <= 21) week = 3;
    else if (day <= 28) week = 4;
    else week = 5;

    const delta =
      row.value !== null && lastValue !== null
        ? row.value - lastValue
        : null;

    if (row.value !== null) {
      lastValue = row.value;
    }

    return {
      ...row,
      week,
      delta,
    };
  });

  // Calculate month growth
  const filledWeeks = weeks.filter((w) => w.value !== null);
  const monthGrowth =
    filledWeeks.length >= 2 && filledWeeks[0].value !== null
      ? filledWeeks[0].value > 0
        ? (filledWeeks[filledWeeks.length - 1].value -
            filledWeeks[0].value) /
          filledWeeks[0].value
        : null
      : null;

  return { weeks, monthGrowth };
}

/**
 * Build monthly averages from all historical records.
 * Deduplication per (creator, period_start): latest createdAt wins; kanonik (1,8,15,22,29) tie-break.
 * Months with zero data are excluded (null ≠ 0).
 * Returns per-month average.
 * @param rows array of {period_start: YYYY-MM-DD, value: number, createdAt: ISO, ...}
 * @returns {avg: number | null, months: number}
 */
export function buildMonthlyAverages(
  rows: Array<{
    period_start: string;
    value: number;
    createdAt: string;
    [key: string]: any;
  }>
): { avg: number | null; months: number } {
  const deduped: Record<string, typeof rows[0]> = {};

  for (const row of rows) {
    const key = row.period_start;
    const existing = deduped[key];

    if (!existing) {
      deduped[key] = row;
    } else {
      const existingDate = parseISO(existing.createdAt);
      const newDate = parseISO(row.createdAt);
      if (!existingDate || !newDate) continue;

      const cmp = newDate.getTime() - existingDate.getTime();
      if (cmp > 0) {
        deduped[key] = row;
      } else if (cmp === 0) {
        const existingDay = parseISO(existing.period_start)?.getDate();
        const newDay = parseISO(row.period_start)?.getDate();
        const kanonik = [1, 8, 15, 22, 29];
        if (newDay && existingDay) {
          if (
            kanonik.indexOf(newDay) >= 0 &&
            kanonik.indexOf(existingDay) < 0
          ) {
            deduped[key] = row;
          }
        }
      }
    }
  }

  // Group by month (YYYY-MM)
  const byMonth: Record<string, number[]> = {};
  for (const row of Object.values(deduped)) {
    const month = row.period_start.slice(0, 7); // YYYY-MM
    if (!byMonth[month]) byMonth[month] = [];
    if (row.value !== null && row.value !== undefined) {
      byMonth[month].push(row.value);
    }
  }

  // Calculate averages per month, then overall
  const monthlyAvgs: number[] = [];
  for (const values of Object.values(byMonth)) {
    if (values.length > 0) {
      monthlyAvgs.push(values.reduce((a, b) => a + b, 0) / values.length);
    }
  }

  const avg =
    monthlyAvgs.length > 0
      ? monthlyAvgs.reduce((a, b) => a + b, 0) / monthlyAvgs.length
      : null;

  return { avg, months: monthlyAvgs.length };
}

/**
 * Parse ISO date string to Date object (UTC).
 */
function parseISO(iso: string): Date | null {
  if (!iso || typeof iso !== 'string') return null;

  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);

  const date = new Date(year, month, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}
