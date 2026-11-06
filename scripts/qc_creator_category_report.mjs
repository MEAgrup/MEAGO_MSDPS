// QC lib GMV per kategori + Report Kreator Bulanan (migrasi 0383):
//   lib/mcn/gmv-category.ts          — parseGmvCategory, matchesCreatorSearch, sumCategoryGmv
//   lib/mcn/creator-monthly-report.ts — buildCreatorMonthlyReport
//
// Pakai: node scripts/qc_creator_category_report.mjs

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
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    failures.push(`${name} — harap ${e}, dapat ${a}`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "qc-cat-report-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      join(ROOT, "lib/mcn/creator-monthly-report.ts"),
      "--outDir", outDir, "--rootDir", join(ROOT, "lib"),
      "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (e) {
  console.error("Gagal transpile:", e.stdout?.toString() || e.message);
  process.exit(1);
}
const cat = require(join(outDir, "mcn/gmv-category.js"));
const { buildCreatorMonthlyReport } = require(join(outDir, "mcn/creator-monthly-report.js"));

// ---- parseGmvCategory -------------------------------------------------------
eq("kosong → all", cat.parseGmvCategory(""), "all");
eq("undefined → all", cat.parseGmvCategory(undefined), "all");
eq("Dining case-insensitive", cat.parseGmvCategory(" Dining "), "dining");
eq("ttd", cat.parseGmvCategory("ttd"), "ttd");
eq("live", cat.parseGmvCategory("LIVE"), "live");
eq("tak dikenal → null (bukan all)", cat.parseGmvCategory("fashion"), null);
eq("label ttd", cat.gmvCategoryLabel("ttd"), "Things to Do (TTD)");
eq("urutan tab", cat.GMV_CATEGORIES.map((c) => c.key), ["all", "dining", "accommodation", "ttd", "live"]);

// ---- matchesCreatorSearch ---------------------------------------------------
const c = { name: "Heylend Sobat Jajan", code: "MCR-0042", username: "heylend" };
eq("q kosong → cocok", cat.matchesCreatorSearch(c, ""), true);
eq("username persis", cat.matchesCreatorSearch(c, "heylend"), true);
eq("pakai @", cat.matchesCreatorSearch(c, "@HeyLend"), true);
eq("sebagian username", cat.matchesCreatorSearch(c, "eyle"), true);
eq("nama", cat.matchesCreatorSearch(c, "sobat"), true);
eq("kode", cat.matchesCreatorSearch(c, "mcr-0042"), true);
eq("tidak cocok", cat.matchesCreatorSearch(c, "budi"), false);
eq("username null aman", cat.matchesCreatorSearch({ name: "A", code: null, username: null }, "a"), true);
eq("username tersimpan pakai @", cat.matchesCreatorSearch({ name: "X", code: null, username: "@udin" }, "udin"), true);

// ---- sumCategoryGmv ---------------------------------------------------------
eq("tanpa baris → null", cat.sumCategoryGmv([]), null);
eq("semua null → null (≠ 0)", cat.sumCategoryGmv([{ mcn_creator_id: "a", period_start: "2026-10-01", created_at: "1", affiliate_gmv: null }]), null);
eq(
  "dedupe per kreator+minggu, terbaru menang, lalu jumlah",
  cat.sumCategoryGmv([
    { mcn_creator_id: "a", period_start: "2026-10-01", created_at: "2026-10-02T00", affiliate_gmv: 100 },
    { mcn_creator_id: "a", period_start: "2026-10-01", created_at: "2026-10-03T00", affiliate_gmv: 150 },
    { mcn_creator_id: "b", period_start: "2026-10-01", created_at: "2026-10-02T00", affiliate_gmv: 50 },
    { mcn_creator_id: "a", period_start: "2026-10-08", created_at: "2026-10-09T00", affiliate_gmv: 0 },
  ]),
  200,
);

// ---- buildCreatorMonthlyReport ----------------------------------------------
const S = (period_start, created_at, gmv, orders, extra = {}) => ({
  period_start, created_at, affiliate_gmv: gmv, orders, aov: null, redemption_amount: null,
  redeemed_orders: null, new_posts: null, posts_with_sales: null, live_streams: null, valid_live_streams: null, ...extra,
});
const r = buildCreatorMonthlyReport({
  year: 2026,
  month: 10,
  summary: [
    S("2026-10-01", "2026-10-08T01", 1000, 10, { new_posts: 3, redemption_amount: 400 }),
    S("2026-10-01", "2026-10-08T05", 1200, 12, { new_posts: 4, redemption_amount: 500 }), // re-upload menang
    S("2026-10-15", "2026-10-22T01", 800, 8, { new_posts: 2 }),
    S("2026-09-29", "2026-10-01T01", 99999, 1), // bulan lain → diabaikan
  ],
  categories: [
    { category: "dining", period_start: "2026-10-01", created_at: "1", affiliate_gmv: 700 },
    { category: "dining", period_start: "2026-10-15", created_at: "1", affiliate_gmv: 300 },
    { category: "live", period_start: "2026-10-01", created_at: "1", affiliate_gmv: 250 },
    { category: "live", period_start: "2026-10-01", created_at: "2", affiliate_gmv: 260 }, // terbaru
  ],
  videos: [
    { video_id: "v1", video_title: "Review bakso", period_start: "2026-10-01", views: 1000, likes: 10, sales_value: 500, orders: 5 },
    { video_id: "v2", video_title: null, period_start: "2026-10-01", views: 300, likes: 1, sales_value: 50, orders: 1 },
    { video_id: "v1", video_title: "Review bakso", period_start: "2026-10-08", views: 500, likes: 5, sales_value: 100, orders: 1 },
    { video_id: "v3", video_title: "Hotel", period_start: "2026-10-15", views: 9000, likes: 90, sales_value: 550, orders: 4 },
  ],
  topN: 2,
});
eq("Okt 2026 = 5 window", r.weeks.length, 5);
eq("W1 pakai upload terbaru", r.weeks[0].summary?.affiliate_gmv, 1200);
eq("W2 tanpa summary → null", r.weeks[1].summary, null);
eq("W2 tetap punya video", r.weeks[1].video, { videos: 1, views: 500, likes: 5, gmv: 100, orders: 1 });
eq("total GMV All", r.totals.gmv, 2000);
eq("total orders", r.totals.orders, 20);
eq("AOV bulan = GMV/orders", r.totals.aov, 100);
eq("redemption null-aware", r.totals.redemption, 500);
eq("post baru", r.totals.newPosts, 6);
eq("LIVE tanpa data → null", r.totals.liveStreams, null);
eq("minggu terisi", r.totals.weeksWithData, 2);
eq("kategori W1", r.weeks[0].categoryGmv, { dining: 700, accommodation: null, ttd: null, live: 260 });
eq("kategori total", r.totals.categoryGmv, { dining: 1000, accommodation: null, ttd: null, live: 260 });
eq("video total", r.totals.video, { videos: 4, views: 10800, likes: 106, gmv: 1200, orders: 11 });
eq("top video: v1 (lintas minggu) & v3", r.topVideos.map((v) => [v.video_id, v.weeks, v.gmv]), [["v1", 2, 600], ["v3", 1, 550]]);

const empty = buildCreatorMonthlyReport({ year: 2026, month: 2, summary: [], categories: [], videos: [] });
eq("Feb 2026 = 4 window", empty.weeks.length, 4);
eq("kosong → GMV null", empty.totals.gmv, null);
eq("kosong → AOV null", empty.totals.aov, null);
eq("kosong → video null", empty.totals.video, null);
eq("kosong → top video []", empty.topVideos, []);

rmSync(outDir, { recursive: true, force: true });
console.log(`QC gmv-category + creator-monthly-report: ${pass} lolos, ${fail} gagal`);
if (fail) {
  for (const f of failures) console.log("  ✗ " + f);
  process.exit(1);
}
