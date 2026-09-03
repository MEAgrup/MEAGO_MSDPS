// QC parser "Content Analysis › Video List" + normalizer industri.
//
// Dua lapis:
//   1. Unit test sintetis (workbook dibuat di memori) — selalu jalan, tanpa file eksternal.
//   2. Uji terhadap FILE EXPORT NYATA bila path-nya diberikan sebagai argumen —
//      ini yang membuktikan strict-header-validation tidak salah tolak data asli.
//
// Pakai:
//   node scripts/qc_content_analysis.mjs
//   node scripts/qc_content_analysis.mjs <file1.xlsx> [file2.xlsx ...]
//
// Parser-nya TypeScript, jadi di-transpile on the fly lewat register loader bawaan
// TypeScript 5.7 tidak tersedia; sebagai gantinya file .ts dibaca & di-strip tipe
// dengan `tsc` sekali ke direktori sementara. Lihat runner di bawah.

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(detail ? `${name} — ${detail}` : name);
  }
}

function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`);
}

// ---- Kompilasi lib TS yang diuji ke JS sementara -------------------------------------
const outDir = mkdtempSync(join(tmpdir(), "qc-ca-"));
try {
  // CommonJS: resolusi `require` toleran terhadap impor tanpa ekstensi (`./weeks`),
  // yang mana loader ESM Node menolaknya. Dependensi transitif ikut dikompilasi.
  execFileSync(
    "npx",
    [
      "tsc",
      join(ROOT, "lib/mcn/content-analysis.ts"),
      join(ROOT, "lib/mcn/industry-normalize.ts"),
      "--outDir",
      outDir,
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--moduleResolution",
      "node",
      "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (e) {
  console.error("Gagal transpile lib:", e.stdout?.toString() || e.message);
  process.exit(1);
}

// tsc mempertahankan struktur direktori relatif terhadap common root (lib/mcn).
const { parseContentAnalysisWorkbook, isContentAnalysisWorkbook, parseYmdCompact, parsePlainNumber } = require(
  join(outDir, "content-analysis.js"),
);
const { normalizeIndustry, sameIndustry } = require(join(outDir, "industry-normalize.js"));

// ===== 1. Normalizer industri (inti bug B7: mismatch TIGA arah) =======================
eq("normalize: 'Accomodation' (leads, satu m)", normalizeIndustry("Accomodation"), "Accommodation");
eq("normalize: 'Accommodation' (INDUSTRIES)", normalizeIndustry("Accommodation"), "Accommodation");
eq("normalize: 'Accommodations' (export TikTok)", normalizeIndustry("Accommodations"), "Accommodation");
eq("normalize: 'Dining'", normalizeIndustry("Dining"), "Dining");
eq("normalize: 'TTD' (leads)", normalizeIndustry("TTD"), "Things to Do");
eq("normalize: 'Things to Do' (INDUSTRIES)", normalizeIndustry("Things to Do"), "Things to Do");
eq("normalize: case/spasi bebas", normalizeIndustry("  accommodations  "), "Accommodation");
eq("normalize: label asing -> null (tidak menebak)", normalizeIndustry("Beauty"), null);
eq("normalize: kosong -> null", normalizeIndustry(""), null);
eq("normalize: null -> null", normalizeIndustry(null), null);
check(
  "sameIndustry: ketiga ejaan Accommodation setara",
  sameIndustry("Accomodation", "Accommodations") && sameIndustry("Accommodation", "Accomodation"),
);
check("sameIndustry: dua null TIDAK setara", !sameIndustry(null, null));
check("sameIndustry: Dining != Accommodation", !sameIndustry("Dining", "Accommodation"));

// ===== 2. Helper angka & tanggal ======================================================
eq("parseYmdCompact: 20260803", parseYmdCompact("20260803"), "2026-08-03");
eq("parseYmdCompact: tanggal mustahil ditolak", parseYmdCompact("20260230"), null);
eq("parseYmdCompact: format lain ditolak", parseYmdCompact("2026-08-03"), null);
eq("parsePlainNumber: '0.000000' -> 0 (NOL, bukan null)", parsePlainNumber("0.000000"), 0);
eq("parsePlainNumber: kosong -> null", parsePlainNumber(""), null);
eq("parsePlainNumber: desimal panjang", parsePlainNumber("0.009433962264150943"), 0.009433962264150943);
eq("parsePlainNumber: teks -> null", parsePlainNumber("n/a"), null);

// ===== 3. Parser — workbook sintetis ==================================================
const HEADER = [
  "Location industry", "Status", "Creator type", "Post ID", "Post title", "Post date", "Duration",
  "Task type", "Location ID", "Location name", "Location city", "Merchant", "Creator name", "Creator ID",
  "Creator link status", "Creator city", "Creator level", "Sales value", "Orders", "Redemption amount",
  "Redeemed orders", "Video views", "CTR", "CVR", "AOV", "Video completion rate", "Like rate", "Comment rate",
];
const rowOk = [
  "Dining", "Valid posts", "Managed creators", "7669", "judul", "20260803", "21",
  "Collaboration package", "4220386", "PONUT - MRT", "South Jakarta", "GoFood by Gojek", "Ika", "IkaNovi2",
  "Linked creators", "West Jakarta", "Lv.1", "1500.5", "3", "0.000000", "0", "101",
  "0.0094", "0", "", "0.4", "0.0396", "0",
];
const mk = (dataRows, filterRow) => [
  {
    name: "Filter",
    cells: [
      ["Start date", "End date", "Industry", "Post date(Selected date range)"],
      filterRow ?? ["20260801", "20260803", "Dining", "Within selected date range"],
    ],
  },
  { name: "Data", cells: [HEADER, ...dataRows] },
];

const r1 = parseContentAnalysisWorkbook(mk([rowOk]));
check("parse: workbook valid -> ok", r1.ok, r1.ok ? "" : r1.error);
if (r1.ok) {
  eq("parse: windowStart dari sheet Filter", r1.windowStart, "2026-08-01");
  eq("parse: windowEnd dari sheet Filter", r1.windowEnd, "2026-08-03");
  eq("parse: industry ternormalisasi", r1.industry, "Dining");
  eq("parse: jumlah baris", r1.rows.length, 1);
  const row = r1.rows[0];
  eq("row: postId", row.postId, "7669");
  eq("row: postDate", row.postDate, "2026-08-03");
  eq("row: locationId (kunci merchant)", row.locationId, "4220386");
  eq("row: status TikTok", row.status, "valid");
  eq("row: taskType", row.taskType, "Collaboration package");
  eq("row: username di-lowercase (cocok konvensi mcn_creators)", row.creatorUsername, "ikanovi2");
  // Jebakan istilah: kolom `Merchant` TikTok = platform OTA/delivery, BUKAN merchant
  // MEA GO. Merchant MEA GO = Location. Dijaga tes supaya tidak tertukar diam-diam.
  eq("row: kolom Merchant TikTok -> otaPlatformsRaw (Agoda/GoFood dst)", row.otaPlatformsRaw, "GoFood by Gojek");
  eq("row: merchant MEA GO = Location name", row.locationName, "PONUT - MRT");
  check("row: tidak ada field bernama merchant* (cegah tertukar)", !("merchantRaw" in row) && !("merchant" in row));
  eq("row: salesValue", row.salesValue, 1500.5);
  eq("row: videoViews", row.videoViews, 101);
  eq("row: durationSec", row.durationSec, 21);
  eq("row: AOV sel kosong -> null (null != 0)", row.aov, null);
  eq("row: redemptionAmount '0.000000' -> 0", row.redemptionAmount, 0);
}

// Verdict invalid terbaca
const rInv = parseContentAnalysisWorkbook(mk([rowOk.map((v, i) => (i === 1 ? "Invalid posts" : v))]));
check("parse: 'Invalid posts' -> status invalid", rInv.ok && rInv.rows[0].status === "invalid");

// Baris tak lengkap masuk skipped[] beralasan, bukan dibuang diam-diam
const noPost = rowOk.map((v, i) => (i === 3 ? "" : v));
const noLoc = rowOk.map((v, i) => (i === 8 ? "" : v));
const noCre = rowOk.map((v, i) => (i === 13 ? "" : v));
const badDate = rowOk.map((v, i) => (i === 5 ? "20260230" : v));
const rSkip = parseContentAnalysisWorkbook(mk([noPost, noLoc, noCre, badDate, rowOk]));
check("parse: baris cacat tidak menggagalkan file", rSkip.ok);
if (rSkip.ok) {
  eq("skip: hanya baris sehat yang lolos", rSkip.rows.length, 1);
  eq("skip: 4 baris tercatat beralasan", rSkip.skipped.length, 4);
  check("skip: alasan menyebut Post ID", rSkip.skipped[0].reason.includes("Post ID"));
  check("skip: alasan tanggal invalid disebut", rSkip.skipped[3].reason.includes("Post date"));
  eq("skip: rowIndex 1-based sesuai baris file", rSkip.skipped[0].rowIndex, 2);
}

// Baris kosong total diabaikan tanpa dicatat sebagai skip
const rBlank = parseContentAnalysisWorkbook(mk([rowOk, HEADER.map(() => ""), rowOk.map((v, i) => (i === 3 ? "9999" : v))]));
check("parse: baris kosong diabaikan diam-diam", rBlank.ok && rBlank.rows.length === 2 && rBlank.skipped.length === 0);

// Industri tak dikenal dilaporkan, tidak ditelan
const rUnk = parseContentAnalysisWorkbook(mk([rowOk.map((v, i) => (i === 0 ? "Beauty" : v))]));
check(
  "parse: industri asing dilaporkan di unknownIndustries",
  rUnk.ok && rUnk.unknownIndustries.includes("Beauty") && rUnk.rows[0].locationIndustry === null,
);

// Penolakan struktur
const noSheet = parseContentAnalysisWorkbook([{ name: "Data", cells: [HEADER, rowOk] }]);
check("tolak: sheet Filter hilang", !noSheet.ok && noSheet.error.includes("Filter"));
const missingCol = parseContentAnalysisWorkbook([
  { name: "Filter", cells: [["Start date", "End date"], ["20260801", "20260803"]] },
  { name: "Data", cells: [HEADER.filter((h) => h !== "Location ID"), rowOk.filter((_, i) => i !== 8)] },
]);
check("tolak: kolom wajib Location ID hilang", !missingCol.ok && missingCol.error.includes("Location ID"));
const badWindow = parseContentAnalysisWorkbook(mk([rowOk], ["20260803", "20260801", "Dining", "x"]));
check("tolak: window terbalik", !badWindow.ok && badWindow.error.includes("terbalik"));
const badWinFmt = parseContentAnalysisWorkbook(mk([rowOk], ["2026-08-01", "20260803", "Dining", "x"]));
check("tolak: format window bukan YYYYMMDD", !badWinFmt.ok);

// Window BEBAS — sengaja bukan W1–W5 (beda dari creator-analysis)
const freeWin = parseContentAnalysisWorkbook(mk([rowOk], ["20260727", "20260730", "Dining", "x"]));
check("terima: window bebas 27–30 (bukan W1–W5)", freeWin.ok, freeWin.ok ? "" : freeWin.error);

// Router format
check("router: mengenali Content Analysis", isContentAnalysisWorkbook(mk([rowOk])));
check(
  "router: TIDAK salah klaim Creator Analysis",
  !isContentAnalysisWorkbook([{ name: "Data", cells: [["Creator name", "Creator ID", "Sales value"], []] }]),
);

// ===== 4. File export NYATA (opsional, lewat argumen) =================================
const files = process.argv.slice(2);
if (files.length > 0) {
  const XLSX = require("xlsx");
  for (const f of files) {
    const wb = XLSX.read(readFileSync(f), { type: "buffer" });
    const sheets = wb.SheetNames.map((n) => ({
      name: n,
      cells: XLSX.utils
        .sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" })
        .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)))),
    }));
    const label = f.split("/").pop();
    const res = parseContentAnalysisWorkbook(sheets);
    check(`NYATA ${label}: parse ok`, res.ok, res.ok ? "" : res.error);
    if (!res.ok) continue;

    const dataRows = sheets.find((s) => s.name === "Data").cells.length - 1;
    check(`NYATA ${label}: router mengenali format`, isContentAnalysisWorkbook(sheets));
    check(
      `NYATA ${label}: SEMUA ${dataRows} baris ter-parse tanpa skip`,
      res.rows.length === dataRows && res.skipped.length === 0,
      `rows=${res.rows.length} skipped=${res.skipped.length} dari ${dataRows}`,
    );
    check(`NYATA ${label}: industri sheet Filter dikenali`, res.industry !== null, `raw="${res.industryRaw}"`);
    check(
      `NYATA ${label}: tidak ada industri baris tak dikenal`,
      res.unknownIndustries.length === 0,
      res.unknownIndustries.join(", "),
    );
    const ids = new Set(res.rows.map((r) => r.postId));
    check(`NYATA ${label}: Post ID unik dalam file`, ids.size === res.rows.length, `${ids.size} vs ${res.rows.length}`);
    const outside = res.rows.filter((r) => r.postDate < res.windowStart || r.postDate > res.windowEnd);
    check(
      `NYATA ${label}: semua Post date di dalam window Filter`,
      outside.length === 0,
      `${outside.length} baris di luar ${res.windowStart}..${res.windowEnd}`,
    );
    check(`NYATA ${label}: Location ID selalu terisi`, res.rows.every((r) => r.locationId !== ""));
    check(`NYATA ${label}: username selalu lowercase`, res.rows.every((r) => r.creatorUsername === r.creatorUsername.toLowerCase()));
    check(`NYATA ${label}: verdict TikTok terbaca semua`, res.rows.every((r) => r.status !== null));

    const valid = res.rows.filter((r) => r.status === "valid").length;
    const pkg = res.rows.filter((r) => r.taskType === "Collaboration package").length;
    const locIds = new Set(res.rows.map((r) => r.locationId)).size;
    const creators = new Set(res.rows.map((r) => r.creatorUsername)).size;
    console.log(
      `   ↳ ${label}: ${res.rows.length} post · window ${res.windowStart}..${res.windowEnd} · ` +
        `industri ${res.industry} · valid ${valid}/${res.rows.length} · ` +
        `collab-package ${pkg} · ${locIds} lokasi · ${creators} kreator`,
    );
  }
} else {
  console.log("   (lewati uji file nyata — beri path .xlsx sebagai argumen untuk mengaktifkannya)");
}

rmSync(outDir, { recursive: true, force: true });

console.log(`\nQC content-analysis: ${pass} lolos, ${fail} gagal`);
if (fail > 0) {
  console.error("\nGAGAL:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
