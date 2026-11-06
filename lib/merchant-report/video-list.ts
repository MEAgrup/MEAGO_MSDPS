// Parser workbook export TikTok GO "Content Analysis › Video List" untuk LAPORAN
// PERFORMA MERCHANT (migrasi 0381, tabel tiktok_post_snapshots).
//
// Beda dengan lib/mcn/content-analysis.ts (yang mengisi tiktok_post_index untuk
// validasi bukti campaign): di sini satu workbook boleh berisi BANYAK sheet bulan
// (workbook gabungan) atau satu export bulanan (sheet Filter + Data), dan barisnya
// DIAGREGASI per post × outlet × bulan persis seperti compute_metrics.py:
//   * hanya baris Status "Valid posts" yang dijumlahkan ke angka (baris invalid
//     tetap disimpan dengan status_valid=false bila post×outlet itu tidak punya
//     baris valid sama sekali);
//   * atribut teks diambil dari baris VALID pertama;
//   * Σ sales value, orders, redemption amount, redeemed orders, video views.
//
// Konvensi rumah: TIDAK menebak. Bulan diambil dari kolom `month`, window sheet
// Filter, atau nama sheet ("Agus 2026", "SEPT 2026"); bila tidak bisa dipastikan
// sheet DITOLAK beralasan, sheet lain tetap diproses. Post ID / Location ID yang
// tersimpan sebagai angka (dibulatkan Excel, mis. 7.61e+18) DITOLAK — post & outlet
// tidak bisa diidentifikasi, minta export ulang. Pure: tanpa import DB/React.

export type RawCell = string | number | boolean | null | undefined;
export type RawSheet = { name: string; rows: RawCell[][] };

export type SourceFormat = "video_list_v1" | "video_list_v2";

/** Satu baris tiktok_post_snapshots — nama field = kolom DB (dikirim sebagai jsonb ke RPC). */
export type SnapshotRow = {
  post_id: string;
  location_id: string;
  row_seq: number;
  post_title: string | null;
  post_date: string | null; // YYYY-MM-DD
  duration_sec: number | null;
  task_type: string | null;
  status_valid: boolean;
  location_name: string | null;
  location_name_display: string | null;
  location_city: string | null;
  creator_username: string;
  creator_name: string | null;
  creator_level: string | null;
  creator_city: string | null;
  creator_link_status: string | null;
  sales_value: number;
  orders: number;
  redemption_amount: number;
  redeemed_orders: number;
  video_views: number;
};

export type MonthBatch = {
  period: string; // YYYY-MM
  sourceFormat: SourceFormat;
  sheet: string;
  monthSource: "kolom month" | "sheet Filter" | "nama sheet" | "dipilih pengguna";
  rows: SnapshotRow[];
  stats: {
    rawRows: number;
    validRows: number;
    invalidRows: number;
    droppedByBrand: number;
    keys: number;
    validKeys: number;
    fragmentedKeys: number; // post×outlet valid dengan >1 baris (dijumlahkan)
  };
};

export type SheetReport = { sheet: string; ok: boolean; message: string };

export type ParseOptions = {
  /**
   * Nama brand (leads.brand_name) — HANYA untuk membuang awalan "Brand - " dari
   * nama outlet. Tidak menyaring baris.
   */
  brandKeyword?: string | null;
  /**
   * Kata kunci penyaring outlet (opsional, untuk file multi-merchant). Baris
   * dipertahankan bila Location name memuat SALAH SATU kata kunci. Kosong = semua
   * baris dipakai — default, karena export TikTok GO sudah per akun merchant dan
   * satu akun bisa punya sub-brand (Sushi Yay + "Yay! Grill" di sample yang
   * disetujui: 74 outlet Sep termasuk 2 outlet Yay! Grill).
   */
  filterKeywords?: string[] | null;
  /** "YYYY-MM" — dipakai HANYA bila bulan tidak bisa ditentukan dari file. */
  monthOverride?: string | null;
  /** "YYYY-MM-DD" hari ini (Asia/Jakarta). Bulan yang belum selesai ditolak. */
  today: string;
};

export type ParseResult = { batches: MonthBatch[]; sheets: SheetReport[] };

// ---- Helper ------------------------------------------------------------------

const HEADER_ALIAS: Record<string, string> = {
  "current status": "status",
  "creator binding status": "creator link status",
  industry: "location industry",
};

export function normHeader(raw: RawCell): string {
  const k = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return HEADER_ALIAS[k] ?? k;
}

/** Normalisasi untuk mencocokkan brand: huruf kecil, hanya a–z0–9. */
export function normKey(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function str(v: RawCell): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Cermin num() di compute_metrics.py: kosong/tak terbaca -> 0. */
export function num(v: RawCell): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = v.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthEnd(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${pad2(lastDayOfMonth(y, m))}`;
}

/** "20260803" / "2026-08-03" / angka 20260803 -> "2026-08-03"; selain itu null. */
export function parsePostDate(v: RawCell): string | null {
  const s = str(v).trim();
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > lastDayOfMonth(y, mo)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const MONTH_WORDS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, febr: 2, februari: 2, february: 2, pebruari: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agus: 8, agust: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10, october: 10,
  nov: 11, nop: 11, november: 11, nopember: 11,
  des: 12, dec: 12, desember: 12, december: 12,
};

/** Bulan-bulan yang disebut di teks bebas (mis. nama sheet). */
function monthWordsIn(text: string): number[] {
  const out = new Set<number>();
  for (const tok of text.toLowerCase().split(/[^a-z]+/)) {
    if (tok && MONTH_WORDS[tok]) out.add(MONTH_WORDS[tok]);
  }
  return [...out];
}

function yearIn(text: string): number | null {
  const m = /(?:^|[^0-9])(20\d{2})(?:[^0-9]|$)/.exec(text);
  return m ? +m[1] : null;
}

/** Nama sheet -> "YYYY-MM" bila menyebut tepat satu bulan + tahun. */
export function monthFromSheetName(name: string): string | null {
  const months = monthWordsIn(name);
  const y = yearIn(name);
  if (months.length !== 1 || y === null) return null;
  return `${y}-${pad2(months[0])}`;
}

/** Nilai kolom `month` -> "YYYY-MM". Tahun cadangan dari nama sheet. */
export function parseMonthCell(v: RawCell, fallbackYear: number | null): string | null {
  if (typeof v === "number") {
    if (v >= 200001 && v <= 209912 && Number.isInteger(v)) {
      const y = Math.floor(v / 100), m = v % 100;
      return m >= 1 && m <= 12 ? `${y}-${pad2(m)}` : null;
    }
    if (v > 20000 && v < 80000) {
      // serial tanggal Excel (epoch 1899-12-30)
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
    }
    if (v >= 1 && v <= 12 && Number.isInteger(v) && fallbackYear) return `${fallbackYear}-${pad2(v)}`;
    return null;
  }
  const s = str(v).trim();
  if (s === "") return null;
  let m = /^(20\d{2})[-/.]?(\d{1,2})(?:[-/.]\d{1,2})?(?:[ T].*)?$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad2(+m[2])}`;
  m = /^(\d{1,2})[-/.](20\d{2})$/.exec(s);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad2(+m[1])}`;
  const months = monthWordsIn(s);
  if (months.length === 1) {
    const y = yearIn(s) ?? fallbackYear;
    if (y) return `${y}-${pad2(months[0])}`;
  }
  return null;
}

function isFullMonthWindow(start: string, end: string): string | null {
  if (start.slice(0, 7) !== end.slice(0, 7)) return null;
  if (!start.endsWith("-01")) return null;
  const period = start.slice(0, 7);
  return end === monthEnd(period) ? period : null;
}

/**
 * Nama tampilan outlet: buang awalan brand ("Sushi Yay! - Gatsu" -> "Gatsu"),
 * setara re.sub(r"^Sushi Yay!?\s*-\s*", "", name) di compute_metrics.py tapi
 * berlaku untuk brand apa pun lewat kata kunci.
 */
export function displayOutletName(name: string, brandKey: string): string {
  const n = name.trim();
  if (!brandKey) return n;
  const m = /^(.*?)\s*-\s*(.+)$/.exec(n);
  if (m && normKey(m[1]) === brandKey) return m[2].trim();
  return n;
}

const ID_RE = /^[0-9]+$/;

type Acc = SnapshotRow & { _validRows: number; _hasValid: boolean };

// ---- Parser utama --------------------------------------------------------------

export function parseVideoListWorkbook(sheets: RawSheet[], opts: ParseOptions): ParseResult {
  const reports: SheetReport[] = [];
  const brandKey = normKey(opts.brandKeyword);
  const filterKeys = (opts.filterKeywords ?? []).map(normKey).filter(Boolean);
  const todayMonth = opts.today.slice(0, 7);
  const override = opts.monthOverride && /^20\d{2}-(0[1-9]|1[0-2])$/.test(opts.monthOverride) ? opts.monthOverride : null;

  // Window sheet Filter (export bulanan tunggal).
  let filterPeriod: string | null = null;
  let filterNote: string | null = null;
  const filter = sheets.find((s) => s.name.trim().toLowerCase() === "filter");
  if (filter) {
    const h = (filter.rows[0] ?? []).map(normHeader);
    const v = filter.rows[1] ?? [];
    const si = h.findIndex((x) => x.includes("start date"));
    const ei = h.findIndex((x) => x.includes("end date"));
    const sd = si >= 0 ? parsePostDate(v[si]) : null;
    const ed = ei >= 0 ? parsePostDate(v[ei]) : null;
    if (sd && ed) {
      filterPeriod = isFullMonthWindow(sd, ed);
      if (!filterPeriod) filterNote = `window sheet Filter ${sd} s/d ${ed} bukan satu bulan penuh`;
    }
  }

  const dataSheets = sheets.filter((s) => s !== filter);
  const candidates: { sheet: RawSheet; header: string[] }[] = [];
  for (const sh of dataSheets) {
    const header = (sh.rows[0] ?? []).map(normHeader);
    if (header.includes("item_id") || header.includes("poi_id")) {
      reports.push({
        sheet: sh.name,
        ok: false,
        message: "format export lama (item_id/poi_id, USD, tanpa Status/judul/kota) — di luar scope laporan; gunakan export Video List.",
      });
      continue;
    }
    if (!(header.includes("post id") && header.includes("location id") && header.includes("creator id"))) {
      reports.push({ sheet: sh.name, ok: false, message: "bukan sheet data Video List (kolom Post ID / Location ID / Creator ID tidak ada) — dilewati." });
      continue;
    }
    if (!header.includes("status")) {
      reports.push({ sheet: sh.name, ok: false, message: 'kolom "Status" / "Current status" tidak ada — baris valid tidak bisa dibedakan.' });
      continue;
    }
    candidates.push({ sheet: sh, header });
  }

  const batches: MonthBatch[] = [];
  const takenMonth = new Map<string, string>(); // period -> sheet

  for (const { sheet, header } of candidates) {
    const ix = (k: string) => header.indexOf(k);
    const iPost = ix("post id"), iLoc = ix("location id"), iStatus = ix("status"), iCreator = ix("creator id");
    const iMonth = ix("month");
    const g = (r: RawCell[], k: string): RawCell => {
      const i = ix(k);
      return i >= 0 ? r[i] : null;
    };
    const sourceFormat: SourceFormat =
      header.includes("post link") || header.includes("product id") || header.includes("location region") ||
      header.includes("creator province") || (sheet.rows[0] ?? []).some((h) => {
        const k = String(h ?? "").trim().toLowerCase();
        return k === "current status" || k === "industry";
      })
        ? "video_list_v2"
        : "video_list_v1";

    const body = sheet.rows.slice(1).filter((r) => r && !r.every((c) => str(c).trim() === ""));
    const withPost = body.filter((r) => str(r[iPost]).trim() !== "");

    // ---- Validasi ID: angka/float/notasi ilmiah = dibulatkan Excel -> tolak.
    let badId = 0;
    let badExample = "";
    for (const r of withPost) {
      for (const i of [iPost, iLoc]) {
        const v = r[i];
        if (typeof v === "number" || !ID_RE.test(str(v).trim())) {
          if (str(v).trim() === "" && i === iLoc) continue; // lokasi kosong ditangani di bawah
          badId++;
          if (!badExample) badExample = str(v);
        }
      }
    }
    if (badId > 0) {
      reports.push({
        sheet: sheet.name,
        ok: false,
        message: `Post ID / Location ID tersimpan sebagai angka atau rusak (contoh "${badExample}", ${badId} sel) — kemungkinan dibulatkan Excel, post & outlet tidak bisa diidentifikasi. Minta export ulang dengan kolom ID sebagai teks.`,
      });
      continue;
    }

    // ---- Tentukan bulan per baris.
    const sheetMonth = monthFromSheetName(sheet.name);
    const sheetYear = yearIn(sheet.name);
    let monthOf: (r: RawCell[]) => string | null;
    let monthSource: MonthBatch["monthSource"];
    if (iMonth >= 0) {
      monthSource = "kolom month";
      monthOf = (r) => parseMonthCell(r[iMonth], sheetYear);
      const unparsed = withPost.filter((r) => monthOf(r) === null);
      if (unparsed.length > 0) {
        reports.push({
          sheet: sheet.name,
          ok: false,
          message: `kolom month tidak terbaca di ${unparsed.length} baris (contoh "${str(unparsed[0][iMonth])}") — bulan tidak ditebak.`,
        });
        continue;
      }
    } else {
      let m: string | null = null;
      if (filterPeriod && candidates.length === 1) {
        m = filterPeriod;
        monthSource = "sheet Filter";
      } else if (sheetMonth) {
        m = sheetMonth;
        monthSource = "nama sheet";
      } else if (override && candidates.length === 1) {
        m = override;
        monthSource = "dipilih pengguna";
      } else {
        monthSource = "nama sheet";
      }
      if (!m) {
        reports.push({
          sheet: sheet.name,
          ok: false,
          message:
            (filterNote ? `${filterNote}; ` : "") +
            "bulan tidak bisa ditentukan (tidak ada kolom month, window Filter satu bulan penuh, atau nama sheet seperti \"Agus 2026\")" +
            (candidates.length === 1 ? " — pilih bulan di form upload." : "."),
        });
        continue;
      }
      const fixed = m;
      monthOf = () => fixed;
    }

    // ---- Agregasi per bulan × post × outlet (urutan kemunculan dipertahankan).
    const perMonth = new Map<string, { acc: Map<string, Acc>; seq: number; raw: number; valid: number; invalid: number; dropped: number; frag: Set<string> }>();
    for (const r of withPost) {
      const period = monthOf(r)!;
      let pm = perMonth.get(period);
      if (!pm) {
        pm = { acc: new Map(), seq: 0, raw: 0, valid: 0, invalid: 0, dropped: 0, frag: new Set() };
        perMonth.set(period, pm);
      }
      pm.raw++;
      const locName = str(g(r, "location name")).trim();
      if (filterKeys.length && !filterKeys.some((k) => normKey(locName).includes(k))) {
        pm.dropped++;
        continue;
      }
      const locId = str(r[iLoc]).trim();
      const creator = str(r[iCreator]).trim().toLowerCase();
      if (locId === "" || creator === "") {
        pm.invalid++;
        continue;
      }
      const valid = str(r[iStatus]).trim() === "Valid posts";
      if (valid) pm.valid++;
      else pm.invalid++;
      const key = `${str(r[iPost]).trim()}|${locId}`;
      let a = pm.acc.get(key);
      const fresh = (): Acc => ({
        post_id: str(r[iPost]).trim(),
        location_id: locId,
        // Monoton: urutan antar-baris valid = urutan baris valid pertama (dict Python).
        row_seq: ++pm!.seq,
        post_title: str(g(r, "post title")) || null,
        post_date: parsePostDate(g(r, "post date")),
        duration_sec: num(g(r, "duration")) || null,
        task_type: str(g(r, "task type")) || null,
        status_valid: valid,
        location_name: locName || null,
        location_name_display: locName ? displayOutletName(locName, brandKey) : null,
        location_city: str(g(r, "location city")).trim() || null,
        creator_username: creator,
        creator_name: str(g(r, "creator name")) || null,
        creator_level: str(g(r, "creator level")) || null,
        creator_city: str(g(r, "creator city")) || null,
        creator_link_status: str(g(r, "creator link status")).trim() || null,
        sales_value: 0,
        orders: 0,
        redemption_amount: 0,
        redeemed_orders: 0,
        video_views: 0,
        _validRows: 0,
        _hasValid: valid,
      });
      if (!a) {
        a = fresh();
        pm.acc.set(key, a);
      } else if (valid && !a._hasValid) {
        // Baris valid pertama menggantikan atribut & angka dari baris invalid.
        a = fresh();
        pm.acc.set(key, a);
      }
      if (valid !== a._hasValid) continue; // baris invalid untuk key yang sudah punya baris valid
      a._validRows += 1;
      if (valid && a._validRows > 1) pm.frag.add(key);
      a.sales_value += num(g(r, "sales value"));
      a.orders += Math.trunc(num(g(r, "orders")));
      a.redemption_amount += num(g(r, "redemption amount"));
      a.redeemed_orders += Math.trunc(num(g(r, "redeemed orders")));
      a.video_views += Math.trunc(num(g(r, "video views")));
    }

    if (perMonth.size === 0) {
      reports.push({ sheet: sheet.name, ok: false, message: "tidak ada baris ber-Post ID." });
      continue;
    }

    for (const [period, pm] of [...perMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const label = perMonth.size > 1 ? `${sheet.name} (${period})` : sheet.name;
      if (period >= todayMonth) {
        reports.push({ sheet: label, ok: false, message: `bulan ${period} belum selesai — hanya bulan yang datanya lengkap yang diproses.` });
        continue;
      }
      if (takenMonth.has(period)) {
        reports.push({ sheet: label, ok: false, message: `bulan ${period} sudah diambil dari sheet "${takenMonth.get(period)}" — tidak digandakan.` });
        continue;
      }
      const rows: SnapshotRow[] = [...pm.acc.values()].map(({ _validRows, _hasValid, ...row }) => {
        void _validRows;
        void _hasValid;
        return row;
      });
      const validRowsAgg = rows.filter((x) => x.status_valid);
      if (validRowsAgg.length === 0) {
        const why = pm.dropped === pm.raw ? ` (semua ${pm.raw} baris tersaring kata kunci "${(opts.filterKeywords ?? []).join(", ")}")` : "";
        reports.push({ sheet: label, ok: false, message: `tidak ada baris "Valid posts" untuk bulan ${period}${why}.` });
        continue;
      }
      const end = monthEnd(period);
      const late = validRowsAgg.filter((x) => x.post_date !== null && x.post_date > end).length;
      if (late > validRowsAgg.length * 0.01) {
        reports.push({
          sheet: label,
          ok: false,
          message: `${late} post bertanggal setelah ${end} — isi sheet tidak cocok dengan bulan ${period} (cek nama sheet / kolom month).`,
        });
        continue;
      }
      takenMonth.set(period, sheet.name);
      const batch: MonthBatch = {
        period,
        sourceFormat,
        sheet: sheet.name,
        monthSource,
        rows,
        stats: {
          rawRows: pm.raw,
          validRows: pm.valid,
          invalidRows: pm.invalid,
          droppedByBrand: pm.dropped,
          keys: rows.length,
          validKeys: validRowsAgg.length,
          fragmentedKeys: pm.frag.size,
        },
      };
      batches.push(batch);
      reports.push({
        sheet: label,
        ok: true,
        message:
          `bulan ${period} (dari ${monthSource}, ${sourceFormat === "video_list_v2" ? "format v2" : "format v1"}): ` +
          `${pm.valid} baris valid → ${validRowsAgg.length} post×outlet` +
          (pm.frag.size ? ` (${pm.frag.size} dijumlahkan dari baris pecahan)` : "") +
          (pm.invalid ? `, ${pm.invalid} baris tidak valid` : "") +
          (pm.dropped ? `, ${pm.dropped} baris outlet di luar kata kunci disaring` : "") +
          ".",
      });
    }
  }

  batches.sort((a, b) => a.period.localeCompare(b.period));
  return { batches, sheets: reports };
}
