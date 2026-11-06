// QC jalur "GMV Video Mingguan" (lib/mcn/video-ingest.ts).
//
// Melindungi tiga cara input di /meago/gmv-video yang semuanya berakhir di parser yang
// SAMA (tidak ada jalur ingest kedua):
//   1. Unggah export TikTok GO terkini "Content Analysis › Video List" (Post ID / Sales
//      value) — dulu DITOLAK karena router hanya kenal format lama "Video Performance"
//      (Video ID / Video GMV). Ini bug yang dilaporkan CM.
//   2. Unggah format baku MSDPS (= template yang bisa diunduh) — round-trip template.
//   3. Tempel dari Excel (TSV) + periode dari form.
//
// Pakai: node scripts/qc_video_gmv_ingest.mjs

import { mkdtempSync, rmSync } from "node:fs";
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
  if (cond) pass++;
  else {
    fail++;
    failures.push(detail ? `${name} — ${detail}` : name);
  }
}
function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`);
}

const outDir = mkdtempSync(join(tmpdir(), "qc-vg-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      join(ROOT, "lib/mcn/video-ingest.ts"),
      "--outDir",
      outDir,
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--moduleResolution",
      "node",
      "--skipLibCheck",
      "--strict",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (e) {
  console.error("Gagal transpile lib:", e.stdout?.toString() || e.message);
  process.exit(1);
}

const vi = require(join(outDir, "video-ingest.js"));
const { parseVideoGmvAny, pastedTextToSheets, buildVideoGmvTemplateSheets, VIDEO_GMV_TEMPLATE_HEADERS } = vi;

check("ekspor: parseVideoGmvAny ada", typeof parseVideoGmvAny === "function");
check("ekspor: pastedTextToSheets ada", typeof pastedTextToSheets === "function");
check("ekspor: buildVideoGmvTemplateSheets ada", typeof buildVideoGmvTemplateSheets === "function");
check("ekspor: VIDEO_GMV_TEMPLATE_HEADERS ada", Array.isArray(VIDEO_GMV_TEMPLATE_HEADERS));

if (typeof parseVideoGmvAny === "function") {
  // ===== 1. Export TikTok GO terkini: Content Analysis › Video List ====================
  const CA_HEADER = [
    "Location industry", "Status", "Creator type", "Post ID", "Post title", "Post date", "Duration",
    "Task type", "Location ID", "Location name", "Location city", "Merchant", "Creator name", "Creator ID",
    "Creator link status", "Creator city", "Creator level", "Sales value", "Orders", "Redemption amount",
    "Redeemed orders", "Video views", "CTR", "CVR", "AOV", "Video completion rate", "Like rate", "Comment rate",
  ];
  const caRow = (postId, creatorId, sales, orders, views) => [
    "Dining", "Valid posts", "Managed creators", postId, "judul", "20261103", "21",
    "Collaboration package", "4220386", "PONUT - MRT", "South Jakarta", "GoFood by Gojek", "Ika Novi", creatorId,
    "Linked creators", "West Jakarta", "Lv.1", sales, orders, "0", "0", views,
    "0.0094", "0", "", "0.4", "0.0396", "0",
  ];
  const caBook = (filterRow, rows) => [
    {
      name: "Filter",
      cells: [["Start date", "End date", "Industry", "Post date(Selected date range)"], filterRow],
    },
    { name: "Data", cells: [CA_HEADER, ...rows] },
  ];

  const r1 = parseVideoGmvAny(caBook(["20261101", "20261107", "Dining", "x"], [
    caRow("7669", "IkaNovi2", "1500.5", "3", "101"),
    caRow("7670", "IkaNovi2", "0.000000", "0", "55"),
  ]));
  check("CA: export TikTok GO terkini diterima", r1.ok, r1.ok ? "" : r1.error);
  if (r1.ok) {
    eq("CA: periodStart dari Filter", r1.periodStart, "2026-11-01");
    eq("CA: periodEnd dari Filter", r1.periodEnd, "2026-11-07");
    eq("CA: jumlah baris", r1.rows.length, 2);
    const row = r1.rows[0];
    eq("CA: Post ID -> videoId", row.videoId, "7669");
    eq("CA: Creator ID -> username", row.username.toLowerCase(), "ikanovi2");
    eq("CA: Creator name -> name", row.name, "Ika Novi");
    eq("CA: Sales value -> salesValue (GMV)", row.salesValue, 1500.5);
    eq("CA: Orders -> orders", row.orders, 3);
    eq("CA: Video views -> views", row.views, 101);
    eq("CA: Post title -> videoTitle", row.videoTitle, "judul");
    eq("CA: likes tidak ada di export -> null (tidak ditebak dari Like rate)", row.likes, null);
    eq("CA: GMV '0.000000' -> 0", r1.rows[1].salesValue, 0);
  }

  const rNotWeek = parseVideoGmvAny(caBook(["20261101", "20261130", "Dining", "x"], [caRow("1", "a", "1", "1", "1")]));
  check("CA: window bukan W1–W5 ditolak (data mingguan)", !rNotWeek.ok && /W1-W5/.test(rNotWeek.error));

  // ===== 2. Format lama "Video Performance" tetap diterima ===============================
  const VP_HEADER = ["Creator ID", "Creator Name", "Video ID", "Video Title", "Video Views", "Video GMV", "Video Orders"];
  const rVp = parseVideoGmvAny([
    { name: "Filter", cells: [["Start date", "End date"], ["20261108", "20261114"]] },
    { name: "Data", cells: [VP_HEADER, ["budi", "Budi", "v1", "t", "10", "2500", "2"]] },
  ]);
  check("VP: format lama tetap lolos", rVp.ok && rVp.rows[0].salesValue === 2500, rVp.ok ? "" : rVp.error);

  // ===== 3. Format tak dikenal: pesan menyebut kedua format ==============================
  const rUnk = parseVideoGmvAny([{ name: "Data", cells: [["Nama", "Omzet"], ["x", "1"]] }]);
  check("tolak: format asing", !rUnk.ok);
  if (!rUnk.ok) {
    check("tolak: pesan menyebut Content Analysis", rUnk.error.includes("Content Analysis"));
    check("tolak: pesan menyebut template baku", rUnk.error.toLowerCase().includes("template"));
  }

  // ===== 4. Template baku MSDPS: round-trip ==============================================
  const tpl = buildVideoGmvTemplateSheets();
  check("template: punya sheet Filter & Data", tpl.some((s) => s.name === "Filter") && tpl.some((s) => s.name === "Data"));
  const dataTpl = tpl.find((s) => s.name === "Data");
  check(
    "template: header Data = VIDEO_GMV_TEMPLATE_HEADERS",
    JSON.stringify(dataTpl.cells[0]) === JSON.stringify([...VIDEO_GMV_TEMPLATE_HEADERS]),
  );
  // Template diisi CM (periode diganti W1 Nov 2026) lalu diunggah → harus lolos parser.
  const filled = tpl.map((s) =>
    s.name === "Filter"
      ? { name: "Filter", cells: [s.cells[0], ["20261101", "20261107"]] }
      : s.name === "Data"
        ? { name: "Data", cells: s.cells.map((r) => r.map((c) => String(c))) }
        : s,
  );
  const rTpl = parseVideoGmvAny(filled);
  check("template: hasil isian template lolos parser", rTpl.ok, rTpl.ok ? "" : rTpl.error);
  if (rTpl.ok) check("template: contoh baris terbaca", rTpl.rows.length >= 1 && rTpl.rows[0].videoId !== "");

  // ===== 5. Tempel dari Excel (TSV) + periode form =======================================
  const tsv =
    VIDEO_GMV_TEMPLATE_HEADERS.join("\t") +
    "\r\n" +
    VIDEO_GMV_TEMPLATE_HEADERS.map((h) =>
      h === "Creator ID" ? "sari" : h === "Video ID" ? "v9" : h === "Video GMV" ? "1,250,000" : h === "Creator Name" ? "Sari" : "",
    ).join("\t") +
    "\r\n\r\n";
  const p1 = pastedTextToSheets(tsv, "2026-11-01", "2026-11-07");
  check("tempel: TSV jadi sheets", p1.ok, p1.ok ? "" : p1.error);
  if (p1.ok) {
    const rP = parseVideoGmvAny(p1.sheets);
    check("tempel: lolos parser", rP.ok, rP.ok ? "" : rP.error);
    if (rP.ok) {
      eq("tempel: periodStart dari form", rP.periodStart, "2026-11-01");
      eq("tempel: GMV ribuan EN '1,250,000'", rP.rows[0].salesValue, 1250000);
      eq("tempel: 1 baris (baris kosong ekor diabaikan)", rP.rows.length, 1);
    }
  }
  // Tempel export Content Analysis juga lewat parser yang sama.
  const caTsv = [CA_HEADER, caRow("77", "ika", "10", "1", "5")].map((r) => r.join("\t")).join("\n");
  const p2 = pastedTextToSheets(caTsv, "2026-11-08", "2026-11-14");
  const rP2 = p2.ok ? parseVideoGmvAny(p2.sheets) : p2;
  check("tempel: data Content Analysis juga diterima", rP2.ok && rP2.periodStart === "2026-11-08", rP2.ok ? "" : rP2.error);

  const pEmpty = pastedTextToSheets("   \n  ", "2026-11-01", "2026-11-07");
  check("tempel: kosong ditolak", !pEmpty.ok);
  const pNoDate = pastedTextToSheets(tsv, "", "2026-11-07");
  check("tempel: tanpa tanggal mulai ditolak", !pNoDate.ok);
  const pBadDate = pastedTextToSheets(tsv, "2026-11-01", "07/11/2026");
  check("tempel: format tanggal salah ditolak", !pBadDate.ok);
}

rmSync(outDir, { recursive: true, force: true });
for (const f of failures) console.log("  ✗ " + f);
console.log(`\nQC video-gmv-ingest: ${pass} lolos, ${fail} gagal`);
process.exit(fail > 0 ? 1 : 0);
