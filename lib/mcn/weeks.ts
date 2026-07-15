// Date math untuk fitur MCN — SEMUA dilakukan lewat string "YYYY-MM-DD" + aritmetika
// kalender integer buatan sendiri. DILARANG `new Date(isoString)` untuk date-only:
// Date di JS memakai timezone lokal/UTC yang bisa menggeser tanggal ± 1 hari tergantung
// environment, sementara window W1-W5 & jadwal live butuh kepastian wall-clock mutlak.

export type YMD = string; // format tetap "YYYY-MM-DD", zero-padded.

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return MONTH_DAYS[month - 1];
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

export function formatYMD(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Parse ketat "YYYY-MM-DD" (tanpa toleransi format lain — itu tugas parseFlexibleDate).
export function parseYMD(s: YMD): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const y = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const d = parseInt(match[3], 10);
  if (!isValidCalendarDate(y, m, d)) return null;
  return { y, m, d };
}

// ---- Aritmetika kalender murni (proleptic Gregorian, tanpa Date object) ----------
// "Epoch day" di sini cuma pencacahan hari internal modul ini (bukan standar luar) —
// yang penting toEpochDay/fromEpochDay saling invers & berurutan sesuai kalender.

function daysBeforeYear(year: number): number {
  const y = year - 1;
  return y * 365 + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400);
}

function daysBeforeMonth(year: number, month: number): number {
  let days = 0;
  for (let m = 1; m < month; m++) days += daysInMonth(year, m);
  return days;
}

function toEpochDay(y: number, m: number, d: number): number {
  return daysBeforeYear(y) + daysBeforeMonth(y, m) + (d - 1);
}

function fromEpochDay(epoch: number): { y: number; m: number; d: number } {
  let year = Math.floor(epoch / 365.2425) + 1;
  while (daysBeforeYear(year + 1) <= epoch) year += 1;
  while (daysBeforeYear(year) > epoch) year -= 1;

  let remaining = epoch - daysBeforeYear(year); // 0-based hari dalam tahun
  let month = 1;
  while (remaining >= daysInMonth(year, month)) {
    remaining -= daysInMonth(year, month);
    month += 1;
  }
  return { y: year, m: month, d: remaining + 1 };
}

export function addDays(dateStr: YMD, n: number): YMD {
  const p = parseYMD(dateStr);
  if (!p) throw new Error(`addDays: tanggal tidak valid (${dateStr})`);
  const { y, m, d } = fromEpochDay(toEpochDay(p.y, p.m, p.d) + n);
  return formatYMD(y, m, d);
}

export function diffDaysYMD(a: YMD, b: YMD): number {
  const pa = parseYMD(a);
  const pb = parseYMD(b);
  if (!pa || !pb) throw new Error(`diffDaysYMD: tanggal tidak valid (${a}, ${b})`);
  return toEpochDay(pb.y, pb.m, pb.d) - toEpochDay(pa.y, pa.m, pa.d);
}

// ---- Window W1-W5 (LOCKED, jangan diubah tanpa migrasi ulang semua ingest lama) ---
// W1=1-7, W2=8-14, W3=15-21, W4=22-28, W5=29-akhir bulan (W5 tak ada bila bulan <29 hari).

export type WeekWindow = { start: YMD; end: YMD };

export function w1w5WindowsOf(year: number, month: number): WeekWindow[] {
  const dim = daysInMonth(year, month);
  const windows: WeekWindow[] = [
    { start: formatYMD(year, month, 1), end: formatYMD(year, month, 7) },
    { start: formatYMD(year, month, 8), end: formatYMD(year, month, 14) },
    { start: formatYMD(year, month, 15), end: formatYMD(year, month, 21) },
    { start: formatYMD(year, month, 22), end: formatYMD(year, month, 28) },
  ];
  if (dim >= 29) {
    windows.push({ start: formatYMD(year, month, 29), end: formatYMD(year, month, dim) });
  }
  return windows;
}

export type W1W5Result = { ok: true; weekIndex: number } | { ok: false; message: string };

// Validasi periode file ingest: HARUS exact match salah satu window W1-W5 bulan yang
// sama (lintas bulan ditolak — file mingguan tidak boleh "nyambung" dua bulan).
export function validateW1W5Period(start: YMD, end: YMD): W1W5Result {
  const s = parseYMD(start);
  const e = parseYMD(end);
  if (!s || !e) {
    return { ok: false, message: `Periode file tidak valid: "${start}" s/d "${end}".` };
  }
  if (s.y !== e.y || s.m !== e.m) {
    return {
      ok: false,
      message: `Periode file ${start} s/d ${end} melintasi bulan — ditolak. File mingguan harus berada dalam satu bulan yang sama (window W1-W5).`,
    };
  }
  const windows = w1w5WindowsOf(s.y, s.m);
  const idx = windows.findIndex((w) => w.start === start && w.end === end);
  if (idx === -1) {
    const monthLabel = `${s.y}-${String(s.m).padStart(2, "0")}`;
    const list = windows.map((w, i) => `W${i + 1}: ${w.start} s/d ${w.end}`).join(", ");
    return {
      ok: false,
      message: `Periode file ${start} s/d ${end} tidak cocok window W1-W5 bulan ${monthLabel}. Window valid: ${list}.`,
    };
  }
  return { ok: true, weekIndex: idx + 1 };
}

// Index minggu (1-5) dari HARI period_start: 1->W1, 8->W2, 15->W3, 22->W4, 29->W5.
// Hari selain itu (mis. data legacy non-kanonik) -> null.
export function weekIndexOfDate(dateStr: YMD): number | null {
  const parsed = parseYMD(dateStr);
  if (!parsed) return null;
  switch (parsed.d) {
    case 1:
      return 1;
    case 8:
      return 2;
    case 15:
      return 3;
    case 22:
      return 4;
    case 29:
      return 5;
    default:
      return null;
  }
}

const CANONICAL_DAYS = [1, 8, 15, 22, 29];

// Bucket minggu dari HARI period_start berdasar rentang (bukan exact match) — dipakai
// buat mengelompokkan data legacy yang period_start-nya sedikit meleset dari kanonik
// (mis. hari ke-3 tetap dianggap representasi minggu W1). 0-based (0=W1 ... 4=W5).
function weekBucketOfDay(day: number): number | null {
  if (day >= 1 && day <= 7) return 0;
  if (day >= 8 && day <= 14) return 1;
  if (day >= 15 && day <= 21) return 2;
  if (day >= 22 && day <= 28) return 3;
  if (day >= 29 && day <= 31) return 4;
  return null;
}

// Dedupe by (period_start) persis — created_at terbaru menang. Perbandingan string
// created_at valid selama formatnya konsisten (ISO 8601), yang mana konvensi Postgres
// timestamptz -> text selalu begitu.
function dedupeLatestByPeriod<T extends { period_start: YMD; created_at: string }>(rows: T[]): T[] {
  const byPeriod = new Map<string, T>();
  for (const row of rows) {
    const existing = byPeriod.get(row.period_start);
    if (!existing || row.created_at > existing.created_at) byPeriod.set(row.period_start, row);
  }
  return [...byPeriod.values()];
}

// Setelah dedupe by period_start persis, beberapa period_start berbeda bisa merujuk ke
// minggu (atau minggu+bulan) yang sama (data non-kanonik). Di situ period_start kanonik
// (tanggal 1/8/15/22/29) MENANG, baru created_at terbaru sbg tie-break berikutnya.
function bucketByWeek<T extends { period_start: YMD; created_at: string }>(
  rows: T[],
  scopedByMonth: boolean,
): Map<string, T> {
  const winners = new Map<string, { row: T; isCanonical: boolean }>();
  for (const row of rows) {
    const parsed = parseYMD(row.period_start);
    if (!parsed) continue;
    const wb = weekBucketOfDay(parsed.d);
    if (wb === null) continue;
    const key = scopedByMonth ? `${row.period_start.slice(0, 7)}|${wb}` : String(wb);
    const isCanonical = parsed.d === CANONICAL_DAYS[wb];
    const existing = winners.get(key);
    if (!existing) {
      winners.set(key, { row, isCanonical });
      continue;
    }
    if (isCanonical && !existing.isCanonical) {
      winners.set(key, { row, isCanonical });
    } else if (isCanonical === existing.isCanonical && row.created_at > existing.row.created_at) {
      winners.set(key, { row, isCanonical });
    }
  }
  const out = new Map<string, T>();
  for (const [key, v] of winners) out.set(key, v.row);
  return out;
}

export type GrowthRow = {
  period_start: YMD;
  affiliate_gmv: number | null;
  created_at: string;
};

export type WeeklyGrowth = {
  week: number; // 1..5
  value: number | null; // null = minggu tanpa data (BUKAN 0)
  delta: number | null; // vs minggu TERISI sebelumnya; null bila tak ada pembanding
};

export type MonthlyGrowthResult = {
  weeks: WeeklyGrowth[]; // selalu 5 slot (W1-W5), null utk minggu tanpa data
  monthGrowth: number | null; // (terisi terakhir - terisi pertama) / terisi pertama
};

// Growth W1-W5 utk SATU creator x SATU bulan. Caller wajib sudah memfilter `rows` ke
// bulan target (fungsi ini menentukan bucket minggu dari hari period_start saja, tanpa
// parameter tahun/bulan, jadi ia tak bisa membedakan bulan berbeda).
export function buildMonthlyGrowth(rows: GrowthRow[]): MonthlyGrowthResult {
  const deduped = dedupeLatestByPeriod(rows);
  const winners = bucketByWeek(deduped, false);

  const values: (number | null)[] = [];
  for (let wb = 0; wb < 5; wb++) {
    const row = winners.get(String(wb));
    values.push(row ? row.affiliate_gmv : null);
  }

  const weeks: WeeklyGrowth[] = [];
  let prevFilled: number | null = null;
  for (let i = 0; i < 5; i++) {
    const value = values[i];
    const delta = value !== null && prevFilled !== null ? value - prevFilled : null;
    weeks.push({ week: i + 1, value, delta });
    if (value !== null) prevFilled = value;
  }

  const filledIdx = values.map((v, i) => (v !== null ? i : -1)).filter((i) => i !== -1);
  let monthGrowth: number | null = null;
  if (filledIdx.length >= 2) {
    const first = values[filledIdx[0]] as number;
    const last = values[filledIdx[filledIdx.length - 1]] as number;
    if (first !== 0) monthGrowth = (last - first) / first;
  }

  return { weeks, monthGrowth };
}

export type AverageRow = {
  period_start: YMD;
  created_at: string;
  affiliate_gmv: number | null;
  affiliate_live_gmv: number | null;
  affiliate_video_gmv: number | null;
};

export type MonthlyAverages = {
  gmv: number | null;
  gmv_live: number | null;
  gmv_video: number | null;
};

type MonthAcc = {
  gmv: number;
  hasGmv: boolean;
  gmvLive: number;
  hasLive: boolean;
  gmvVideo: number;
  hasVideo: boolean;
};

// Rata-rata BULANAN lintas SELURUH histori seorang creator (dipakai auto-fill master
// mcn_creators.gmv/gmv_live/gmv_video). Bulan tanpa data sama sekali TIDAK dihitung
// sebagai 0 — ia cukup tak muncul di grup bulan, jadi otomatis tak ikut pembagi rata2.
export function buildMonthlyAverages(rows: AverageRow[]): MonthlyAverages {
  const deduped = dedupeLatestByPeriod(rows);
  const winners = bucketByWeek(deduped, true); // key = "YYYY-MM|weekBucket"

  const monthSums = new Map<string, MonthAcc>();
  for (const [key, row] of winners) {
    const month = key.split("|")[0];
    let acc = monthSums.get(month);
    if (!acc) {
      acc = { gmv: 0, hasGmv: false, gmvLive: 0, hasLive: false, gmvVideo: 0, hasVideo: false };
      monthSums.set(month, acc);
    }
    if (row.affiliate_gmv !== null) {
      acc.gmv += row.affiliate_gmv;
      acc.hasGmv = true;
    }
    if (row.affiliate_live_gmv !== null) {
      acc.gmvLive += row.affiliate_live_gmv;
      acc.hasLive = true;
    }
    if (row.affiliate_video_gmv !== null) {
      acc.gmvVideo += row.affiliate_video_gmv;
      acc.hasVideo = true;
    }
  }

  const average = (pick: (m: MonthAcc) => { value: number; has: boolean }): number | null => {
    let sum = 0;
    let count = 0;
    for (const acc of monthSums.values()) {
      const { value, has } = pick(acc);
      if (has) {
        sum += value;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  };

  return {
    gmv: average((m) => ({ value: m.gmv, has: m.hasGmv })),
    gmv_live: average((m) => ({ value: m.gmvLive, has: m.hasLive })),
    gmv_video: average((m) => ({ value: m.gmvVideo, has: m.hasVideo })),
  };
}
