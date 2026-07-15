// Parser toleran untuk data platform TikTok (laporan performa kreator/produk) yang
// datang dalam format yang tidak konsisten. Prinsip inti di seluruh file ini:
// TIDAK PERNAH menebak — kalau format ambigu/tak dikenali, kembalikan null. Lebih
// baik data hilang (kelihatan & bisa ditelusuri) daripada data salah (diam-diam).

import { isValidCalendarDate, formatYMD } from "./weeks";

// ---- parseRupiah -----------------------------------------------------------------
// Toleransi 2 format ribuan:
//   A) "1.234.567"        -> titik = ribuan (format Indonesia), koma opsional = desimal
//   B) "1,234,567.89"     -> koma = ribuan (format internasional), titik opsional = desimal
// Plus: prefix "Rp"/"IDR", spasi, tanda +/-, dan kurung akuntansi "(123)" = negatif.
// String yang tak cocok salah satu pola di atas (mis. satu titik dgn grouping bukan 3
// digit: "12.5") dianggap ambigu -> null, BUKAN ditebak sebagai desimal atau ribuan.
export function parseRupiah(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = input.trim();
  if (s === "") return null;

  let negative = false;

  // Kurung akuntansi bisa membungkus seluruh ekspresi termasuk prefix mata uang,
  // mis. "(Rp 150.000)".
  const paren = s.match(/^\((.+)\)$/);
  if (paren) {
    negative = true;
    s = paren[1].trim();
  }

  // Lucuti prefix mata uang & tanda +/- longgar soal urutan (mis. "-Rp", "Rp -").
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(/^(rp\.?|idr)\s*/i, "").trim();
    if (s.startsWith("-")) {
      negative = true;
      s = s.slice(1).trim();
    } else if (s.startsWith("+")) {
      s = s.slice(1).trim();
    }
    if (s === before) break;
  }

  if (s === "") return null;

  let n: number | null = null;
  if (/^\d+$/.test(s)) {
    n = parseInt(s, 10);
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    // Format A: titik ribuan, koma desimal opsional.
    n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  } else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    // Format B: koma ribuan, titik desimal opsional.
    n = parseFloat(s.replace(/,/g, ""));
  } else {
    return null; // format tak dikenali/ambigu — jangan menebak.
  }

  if (n === null || Number.isNaN(n)) return null;
  return negative ? -n : n;
}

// ---- parseCommission --------------------------------------------------------------
export type CommissionParseResult = {
  min: number;
  max: number;
  isRange: boolean;
  raw: string; // teks asli persis, disimpan apa adanya utk audit/tampilan
  pct: number; // = min bila range (konservatif — dipakai utk kalkulasi/estimasi)
};

// Terima "10%", "10", "8-12%", "8 – 12" (en dash & spasi ditoleransi). Nilai di luar
// 0-100 (salah satu sisi bila range) -> null. Range terbalik (min > max) juga -> null,
// karena itu ambigu (bukan tugas parser menebak mana yang dimaksud).
export function parseCommission(input: string | null | undefined): CommissionParseResult | null {
  if (input === null || input === undefined) return null;
  const raw = input.trim();
  if (raw === "") return null;

  const body = raw.replace(/%/g, "").trim();

  const rangeMatch = body.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)$/i);
  if (rangeMatch) {
    const min = parseFloat(rangeMatch[1]);
    const max = parseFloat(rangeMatch[2]);
    if (min < 0 || min > 100 || max < 0 || max > 100 || min > max) return null;
    return { min, max, isRange: true, raw, pct: min };
  }

  const singleMatch = body.match(/^(\d+(?:\.\d+)?)$/);
  if (singleMatch) {
    const value = parseFloat(singleMatch[1]);
    if (value < 0 || value > 100) return null;
    return { min: value, max: value, isRange: false, raw, pct: value };
  }

  return null; // format tak dikenali.
}

// ---- parseFlexibleDate -------------------------------------------------------------
const MONTH_NAMES: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

function extractNamedMonth(s: string): { month: number; rest: string } | null {
  const tokens = s.split(/[\s,]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const key = tokens[i].replace(/\.$/, "").toLowerCase();
    if (key in MONTH_NAMES) {
      const rest = tokens.filter((_, idx) => idx !== i).join(" ");
      return { month: MONTH_NAMES[key], rest };
    }
  }
  return null;
}

// Kembalikan ISO "YYYY-MM-DD" atau null. Aturan:
// - Nama bulan ID/EN (Jan/Januari/January, dst) dikenali di posisi mana pun.
// - Numerik murni tanpa nama bulan: day-first jadi DEFAULT bila ambigu; kalau hasil
//   day-first invalid (mis. "07/13/2026" -> bulan 13 tak ada), fallback ke month-first.
// - Semua kandidat divalidasi ke kalender NYATA (mis. "30/02/2026" -> keduanya invalid
//   -> null; bukan Date object JS yang diam-diam menggeser ke Maret).
export function parseFlexibleDate(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const raw = input.trim();
  if (raw === "") return null;

  // 1) ISO/near-ISO "YYYY-M-D" atau "YYYY/M/D" — urutan y-m-d sudah pasti, tak ambigu.
  const isoMatch = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    return isValidCalendarDate(y, m, d) ? formatYMD(y, m, d) : null;
  }

  // 2) Nama bulan ID/EN — token 4-digit dianggap tahun, sisanya adalah hari.
  const named = extractNamedMonth(raw);
  if (named) {
    const nums = named.rest.match(/\d+/g);
    if (!nums || nums.length !== 2) return null;
    const [a, b] = nums;
    let year: number;
    let day: number;
    if (a.length === 4 && b.length !== 4) {
      year = parseInt(a, 10);
      day = parseInt(b, 10);
    } else if (b.length === 4 && a.length !== 4) {
      year = parseInt(b, 10);
      day = parseInt(a, 10);
    } else {
      return null; // tak ada token tahun 4-digit yang jelas -> ambigu.
    }
    return isValidCalendarDate(year, named.month, day) ? formatYMD(year, named.month, day) : null;
  }

  // 3) Numerik murni "A/B/C" (pemisah -, / , .) — wajib ada 1 segmen 4-digit sbg tahun.
  const numMatch = raw.match(/^(\d{1,4})[-\/.](\d{1,4})[-\/.](\d{1,4})$/);
  if (numMatch) {
    const segs = [numMatch[1], numMatch[2], numMatch[3]];
    const yearIdx = segs.findIndex((seg) => seg.length === 4);
    if (yearIdx === -1) return null; // tanpa tahun 4-digit — ambigu, jangan menebak.
    const year = parseInt(segs[yearIdx], 10);

    if (yearIdx === 0) {
      // Y-M-D — urutan sudah pasti.
      const month = parseInt(segs[1], 10);
      const day = parseInt(segs[2], 10);
      return isValidCalendarDate(year, month, day) ? formatYMD(year, month, day) : null;
    }

    if (yearIdx === 2) {
      const first = parseInt(segs[0], 10);
      const second = parseInt(segs[1], 10);
      // Day-first default: first=hari, second=bulan.
      if (isValidCalendarDate(year, second, first)) return formatYMD(year, second, first);
      // Fallback month-first: first=bulan, second=hari.
      if (isValidCalendarDate(year, first, second)) return formatYMD(year, first, second);
      return null;
    }

    return null; // tahun di tengah ("A/YYYY/C") — format tak didukung, ambigu.
  }

  return null;
}

// ---- parsePercent & parseIntTolerant -----------------------------------------------
// Persen generik (bukan komisi range) — dipakai utk kolom seperti CTR/CTOR mentah.
// Tidak menegakkan batas 0-100 (nilai di luar itu dibiarkan lolos apa adanya; validasi
// domain spesifik ada di lapisan pemanggil bila diperlukan).
export function parsePercent(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = input.trim();
  if (s === "") return null;
  s = s.replace(/%/g, "").trim();
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", "."); // desimal format ID
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Integer toleran thousands-separator (titik ATAU koma, tak dicampur) — utk kolom
// hitungan seperti items_sold/orders yang kadang datang dgn pemisah ribuan.
export function parseIntTolerant(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  let s = input.trim();
  if (s === "") return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, "");
  if (!/^-?\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}
