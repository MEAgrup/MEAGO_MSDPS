// QC Laporan Performa Merchant (migrasi 0378, lib/merchant-report).
//
// Tiga lapis:
//   1. Unit test parser Video List (workbook dibuat di memori): float ID ditolak,
//      format lama ditolak, deteksi bulan, bulan berjalan ditolak, filter brand,
//      agregasi baris pecahan, bulan ganda tidak digandakan.
//   2. PARITAS dengan compute_metrics.py (acuan sample yang disetujui): workbook
//      sintetis (scripts/merchant_report/gen_synthetic.py) diproses keduanya, lalu
//      setiap angka dibandingkan. Butuh python3 + openpyxl.
//   3. Bila path file export NYATA diberikan (mis. DATA_RAW_DINING_GAB_2026_sushi_yay_only.xlsx),
//      paritas yang sama dijalankan atas file itu + angka acuan handoff §6.
//
// Pakai:
//   node scripts/qc_merchant_report.mjs
//   node scripts/qc_merchant_report.mjs /path/DATA_RAW_DINING_GAB_2026_sushi_yay_only.xlsx

import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const failures = [];
const check = (name, cond, detail) => (cond ? pass++ : (fail++, failures.push(detail ? `${name} — ${detail}` : name)));
const eq = (name, a, e) => check(name, Object.is(a, e), `harap ${JSON.stringify(e)}, dapat ${JSON.stringify(a)}`);
const near = (name, a, e, tol = 1e-9) =>
  check(name, typeof a === "number" && typeof e === "number" && Math.abs(a - e) <= tol * Math.max(1, Math.abs(e)), `harap ${e}, dapat ${a}`);

// Di dalam node_modules/.cache supaya `require("xlsx")` dari JS hasil kompilasi ter-resolve.
mkdirSync(join(ROOT, "node_modules/.cache"), { recursive: true });
const outDir = mkdtempSync(join(ROOT, "node_modules/.cache/qc-mr-"));
try {
  execFileSync("npx", ["tsc", ...["video-list", "metrics", "read-xlsx", "insights"].map((f) => join(ROOT, `lib/merchant-report/${f}.ts`)),
    "--outDir", outDir, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck", "--esModuleInterop"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  console.error("Gagal transpile lib:", e.stdout?.toString() || e.message);
  process.exit(1);
}
const { parseVideoListWorkbook, monthFromSheetName, parseMonthCell, displayOutletName, normKey } = require(join(outDir, "video-list.js"));
const { computeReportMetrics, pyRound, median, prank, DEFAULT_PARAMS } = require(join(outDir, "metrics.js"));
const { readWorkbookBuffer } = require(join(outDir, "read-xlsx.js"));
const { autoInsights } = require(join(outDir, "insights.js"));
const TODAY = "2026-11-06";

// ===== 1. Unit test =====================================================================
eq("sheet name 'Agus 2026'", monthFromSheetName("Agus 2026"), "2026-08");
eq("sheet name 'SEPT 2026'", monthFromSheetName("SEPT 2026"), "2026-09");
eq("sheet name 'mei juli 2026' ambigu", monthFromSheetName("mei juli 2026"), null);
eq("sheet name tanpa tahun", monthFromSheetName("Agustus"), null);
eq("month cell 'Mei 2026'", parseMonthCell("Mei 2026", null), "2026-05");
eq("month cell 'juli' + tahun sheet", parseMonthCell("juli", 2026), "2026-07");
eq("month cell '2026-06'", parseMonthCell("2026-06", null), "2026-06");
eq("month cell serial Excel 2026-07-01", parseMonthCell(46204, null), "2026-07");
eq("month cell sampah", parseMonthCell("abc", 2026), null);
eq("outlet display Sushi Yay!", displayOutletName("Sushi Yay! - Gatsu", normKey("Sushi Yay")), "Gatsu");
eq("outlet display tanpa dash", displayOutletName("Sushi Yay Gatsu", normKey("Sushi Yay")), "Sushi Yay Gatsu");
eq("pyRound 2.5 -> 2 (bankir)", pyRound(2.5), 2);
eq("pyRound 3.5 -> 4", pyRound(3.5), 4);
eq("pyRound 2.45 -> 2", pyRound(2.45), 2);
eq("median genap", median([1, 5, 3, 9]), 4);
eq("prank seri -> indeks pertama", prank([5, 0, 0, 3]).get(0), 0);
eq("prank n=1 -> 1", prank([7]).get(7), 1);

const H = ["Status", "Post ID", "Post title", "Post date", "Duration", "Task type", "Location ID", "Location name",
  "Location city", "Creator name", "Creator ID", "Creator link status", "Creator city", "Creator level",
  "Sales value", "Orders", "Redemption amount", "Redeemed orders", "Video views"];
const row = (o) => H.map((h) => (h in o ? o[h] : {
  Status: "Valid posts", "Post ID": "7600000000000000001", "Post title": "t", "Post date": "20260805", Duration: 20,
  "Task type": "Others", "Location ID": "4220001", "Location name": "Sushi Yay - A", "Location city": "Bandung",
  "Creator name": "K", "Creator ID": "Kre", "Creator link status": "Linked creators", "Creator city": "Bandung",
  "Creator level": "Lv.1", "Sales value": "1000", Orders: "2", "Redemption amount": "800", "Redeemed orders": "2",
  "Video views": "100",
}[h]));
const parse = (sheets, opts = {}) => parseVideoListWorkbook(sheets, { brandKeyword: "Sushi Yay", today: TODAY, ...opts });

{
  const r = parse([{ name: "Agus 2026", rows: [H, row({}), row({ "Sales value": "500", Orders: "1", "Video views": "50" }),
    row({ "Post ID": "7600000000000000002", Status: "Invalid posts" }),
    row({ "Post ID": "7600000000000000003", "Location name": "Brand Lain - X" })] }]);
  eq("agregasi: 1 batch", r.batches.length, 1);
  const b = r.batches[0];
  eq("agregasi: periode dari nama sheet", b.period, "2026-08");
  eq("agregasi: 2 key (1 valid + 1 invalid-only)", b.rows.length, 2);
  const v = b.rows.find((x) => x.status_valid);
  eq("agregasi: GMV dijumlahkan", v.sales_value, 1500);
  eq("agregasi: order dijumlahkan", v.orders, 3);
  eq("agregasi: views dijumlahkan", v.video_views, 150);
  eq("agregasi: fragmented key dihitung", b.stats.fragmentedKeys, 1);
  eq("filter brand: 1 baris disaring", b.stats.droppedByBrand, 1);
  eq("outlet display tersimpan", v.location_name_display, "A");
  eq("post date ISO", v.post_date, "2026-08-05");
}
{
  const r = parse([{ name: "mei juli 2026", rows: [[...H, "month"], [...row({ "Post ID": 7.61e18 }), "Mei 2026"]] }]);
  eq("float ID: ditolak", r.batches.length, 0);
  check("float ID: pesan export ulang", /export ulang/.test(r.sheets[0].message), r.sheets[0].message);
}
{
  const r = parse([{ name: "JAN 2026", rows: [["item_id", "poi_id", "poi_vv"], ["1", "2", "3"]] }]);
  check("format lama ditolak", r.batches.length === 0 && /format export lama/.test(r.sheets[0].message), r.sheets[0]?.message);
}
{
  const r = parse([{ name: "NOV 2026", rows: [H, row({ "Post date": "20261102" })] }]);
  check("bulan berjalan ditolak", r.batches.length === 0 && /belum selesai/.test(r.sheets[0].message), r.sheets[0]?.message);
}
{
  const r = parse([{ name: "Data", rows: [H, row({})] }]);
  check("bulan tak terdeteksi -> ditolak", r.batches.length === 0 && /tidak bisa ditentukan/.test(r.sheets[0].message), r.sheets[0]?.message);
  const r2 = parse([{ name: "Data", rows: [H, row({})] }], { monthOverride: "2026-08" });
  eq("bulan dari pilihan pengguna", r2.batches[0]?.period, "2026-08");
}
{
  const filter = { name: "Filter", rows: [["Start date", "End date", "Industry"], ["20260801", "20260831", "Dining"]] };
  const r = parse([filter, { name: "Data", rows: [H, row({})] }]);
  eq("bulan dari window Filter", r.batches[0]?.period, "2026-08");
  const f2 = { name: "Filter", rows: [["Start date", "End date"], ["20260801", "20260815"]] };
  const r2 = parse([f2, { name: "Data", rows: [H, row({})] }]);
  check("window tidak sebulan penuh -> ditolak", r2.batches.length === 0 && /bukan satu bulan penuh/.test(r2.sheets[0].message), r2.sheets[0]?.message);
}
{
  const r = parse([{ name: "Agus 2026", rows: [H, row({})] }, { name: "Agustus 2026 (copy)", rows: [H, row({})] }]);
  eq("bulan ganda tidak digandakan", r.batches.length, 1);
}
{
  const r = parse([{ name: "Agus 2026", rows: [H, row({ "Post date": "20260912" }), row({ "Post ID": "7600000000000000009", "Post date": "20260915" })] }]);
  check("isi sheet beda bulan ditolak", r.batches.length === 0 && /tidak cocok/.test(r.sheets[0].message), r.sheets[0]?.message);
}
{
  const r = parse([{ name: "Agus 2026", rows: [H, row({ Status: "Invalid posts" }), row({ "Sales value": "700" })] }]);
  const v = r.batches[0].rows[0];
  check("baris valid menggantikan baris invalid sebelumnya", v.status_valid && v.sales_value === 700, JSON.stringify(v));
}

// ===== 2 & 3. Paritas dengan compute_metrics.py ===========================================
function toMetricRows(batches) {
  const out = [];
  for (const b of batches)
    for (const r of [...b.rows].filter((x) => x.status_valid).sort((a, c) => a.row_seq - c.row_seq))
      out.push({ ...r, period: b.period });
  return out;
}

function parity(label, xlsxPath, expect) {
  let py;
  const jsonOut = join(outDir, `${label}.json`);
  try {
    execFileSync("python3", [join(ROOT, "scripts/merchant_report/compute_metrics.py"), xlsxPath, jsonOut], { stdio: ["ignore", "pipe", "pipe"] });
    py = JSON.parse(readFileSync(jsonOut, "utf-8"));
  } catch (e) {
    console.warn(`⚠ ${label}: compute_metrics.py gagal (${e.stderr?.toString().split("\n").slice(-2).join(" ") || e.message}) — paritas dilewati.`);
    return;
  }
  const sheets = readWorkbookBuffer(readFileSync(xlsxPath), xlsxPath);
  const parsed = parseVideoListWorkbook(sheets.filter((s) => ["Agus 2026", "SEPT 2026"].includes(s.name)), { brandKeyword: "Sushi Yay", today: TODAY });
  eq(`${label}: 2 bulan terbaca`, parsed.batches.map((b) => b.period).join(","), "2026-08,2026-09");
  const periods = parsed.batches.map((b) => b.period);
  const m = computeReportMetrics(periods, toMetricRows(parsed.batches), DEFAULT_PARAMS);
  const T = (k) => `${label}: ${k}`;

  m.monthly.forEach((x, i) => {
    const p = py.monthly[i];
    for (const k of ["gmv", "orders", "views", "redemption", "red_rate", "aov", "new_posts", "active_posts", "gmv_per_post",
      "order_per_1k", "outlets_seen", "outlets_active", "creators_active", "creators_gmv"]) near(T(`monthly[${i}].${k}`), x[k], p[k]);
    near(T(`monthly[${i}].outlets_gt50`), x.outlets_gt_top, p.outlets_gt50);
    for (const [b, n] of Object.entries(p.buckets)) eq(T(`monthly[${i}].bucket ${b}`), x.buckets[b] ?? 0, n);
  });
  for (const k of ["gmv", "orders", "views", "red", "red_rate", "aov"]) near(T(`total.${k}`), m.total[k], py.total[k]);
  eq(T("jumlah outlet"), m.outlets.length, py.outlets.length);
  m.outlets.forEach((o, i) => {
    const p = py.outlets[i];
    eq(T(`outlet[${i}].id`), o.id, p.id);
    eq(T(`outlet[${i}].name`), o.name, p.name);
    eq(T(`outlet[${i}].city`), o.city, p.city);
    near(T(`outlet[${i}].gmv`), o.gmv, p.gmv);
    near(T(`outlet[${i}].score`), o.score, p.score);
    eq(T(`outlet[${i}].layer`), o.layer, p.layer);
    for (const l of py.labels) {
      eq(T(`outlet[${i}].orders ${l}`), o.orders_by_month[l], p.orders_by_month[l]);
      eq(T(`outlet[${i}].newpost ${l}`), o.newpost_by_month[l], p.newpost_by_month[l]);
    }
  });
  for (const L of ["1", "2", "3"]) {
    eq(T(`layer_outlet ${L}.n`), m.layer_outlet[L].n, py.layer_outlet[L].n);
    near(T(`layer_outlet ${L}.gmv`), m.layer_outlet[L].gmv, py.layer_outlet[L].gmv);
  }
  eq(T("jumlah kota"), m.cities.length, py.cities.length);
  m.cities.forEach((c, i) => {
    const p = py.cities[i];
    eq(T(`city[${i}].city`), c.city, p.city);
    near(T(`city[${i}].gmv_per_outlet`), c.gmv_per_outlet, p.gmv_per_outlet);
    for (const l of py.labels) near(T(`city[${i}].${l}`), c.by_month[l], p.by_month[l]);
  });
  for (const k of ["top2", "top10", "n", "n_gmv"]) near(T(`creator_share.${k}`), m.creator_share[k], py.creator_share[k]);
  for (const [L, v] of Object.entries(py.creator_layers)) {
    eq(T(`creator_layers ${L}.n`), m.creator_layers[L].n, v.n);
    near(T(`creator_layers ${L}.gmv`), m.creator_layers[L].gmv, v.gmv);
  }
  for (const [a, n] of Object.entries(py.creator_activity)) eq(T(`creator_activity ${a}`), m.creator_activity[a], n);
  m.creators_top.forEach((c, i) => {
    const p = py.creators_top[i];
    for (const k of ["username", "name", "city", "level", "bound", "posts", "days_since", "activity", "layer"]) eq(T(`creator[${i}].${k}`), c[k], p[k]);
    near(T(`creator[${i}].gmv_per_post`), c.gmv_per_post, p.gmv_per_post);
  });
  for (const k of ["top5_share", "n_rows", "n_top", "median_views_top", "median_views_rest"]) near(T(`best.${k}`), m.best[k], py.best[k]);
  for (const [b, v] of Object.entries(py.best.duration)) { eq(T(`dur ${b}.n`), m.best.duration[b].n, v.n); near(T(`dur ${b}.rate`), m.best.duration[b].sell_rate, v.sell_rate); }
  for (const [b, v] of Object.entries(py.best.views)) { eq(T(`views ${b}.n`), m.best.views[b].n, v.n); near(T(`views ${b}.rate`), m.best.views[b].sell_rate, v.sell_rate); }
  py.best.features.forEach((f, i) => {
    const x = m.best.features[i];
    eq(T(`feature ${f.feature}.n`), x.n, f.n);
    near(T(`feature ${f.feature}.sell_rate`), x.sell_rate, f.sell_rate);
    near(T(`feature ${f.feature}.lift`), x.lift, f.lift);
  });
  py.best.top_posts.forEach((p, i) => {
    const x = m.best.top_posts[i];
    for (const k of ["creator", "outlet", "title", "views", "month"]) eq(T(`top_post[${i}].${k}`), x[k], p[k]);
    near(T(`top_post[${i}].gmv`), x.gmv, p.gmv);
  });
  for (const [t, v] of Object.entries(py.task_types)) {
    const x = m.task_types.find((y) => y.name === t);
    check(T(`task ${t} ada`), !!x);
    if (x) { eq(T(`task ${t}.n`), x.n, v.n); near(T(`task ${t}.gpp`), x.gmv_per_post, v.gmv_per_post); }
  }
  for (const [name, vals] of Object.entries(py.scenario)) {
    const x = m.scenario.find((s) => s.name === name);
    vals.forEach((v, i) => near(T(`scenario ${name}[${i}]`), x?.values[i], v));
  }
  const ins = autoInsights(m, DEFAULT_PARAMS);
  check(T("insight otomatis terisi"), ins.ins1.length >= 3 && ins.ins2.length >= 2, JSON.stringify(ins.ins1));

  if (expect) {
    const [a, s] = m.monthly;
    eq(T("acuan GMV Agu"), Math.round(a.gmv), 110165315);
    eq(T("acuan GMV Sep"), Math.round(s.gmv), 218340885);
    eq(T("acuan order Agu/Sep"), `${a.orders}/${s.orders}`, "2232/3731");
    eq(T("acuan views Agu/Sep"), `${a.views}/${s.views}`, "5843774/8268794");
    eq(T("acuan new/aktif Agu"), `${a.new_posts}/${a.active_posts}`, "1030/3468");
    eq(T("acuan new/aktif Sep"), `${s.new_posts}/${s.active_posts}`, "1918/4920");
    eq(T("acuan outlet Agu"), `${a.outlets_active}/${a.outlets_seen}`, "57/66");
    eq(T("acuan outlet Sep"), `${s.outlets_active}/${s.outlets_seen}`, "67/74");
    eq(T("acuan creator Agu"), `${a.creators_gmv}/${a.creators_active}`, "98/537");
    eq(T("acuan creator Sep"), `${s.creators_gmv}/${s.creators_active}`, "172/615");
    eq(T("acuan 0 / >50 Agu"), `${a.buckets["0"]}/${a.outlets_gt_top}`, "9/11");
    eq(T("acuan 0 / >50 Sep"), `${s.buckets["0"]}/${s.outlets_gt_top}`, "7/19");
    eq(T("acuan layer outlet"), `${m.layer_outlet[1].n}/${m.layer_outlet[2].n}/${m.layer_outlet[3].n}`, "16/28/30");
    eq(T("acuan creator Layer 1"), m.creator_layers["Layer 1"].n, 17);
  }
}

let synth = null;
try {
  synth = join(outDir, "synthetic.xlsx");
  execFileSync("python3", [join(ROOT, "scripts/merchant_report/gen_synthetic.py"), synth, "7"], { stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  console.warn("⚠ python3/openpyxl tidak tersedia — paritas sintetis dilewati:", e.message);
  synth = null;
}
if (synth) {
  parity("sintetis#7", synth);
  const s2 = join(outDir, "synthetic2.xlsx");
  execFileSync("python3", [join(ROOT, "scripts/merchant_report/gen_synthetic.py"), s2, "2026"], { stdio: ["ignore", "pipe", "pipe"] });
  parity("sintetis#2026", s2);
}
for (const f of process.argv.slice(2)) {
  if (!existsSync(f)) { fail++; failures.push(`file tidak ada: ${f}`); continue; }
  parity("file nyata", f, true);
}

rmSync(outDir, { recursive: true, force: true });
console.log(`QC merchant report: ${pass} lolos, ${fail} gagal`);
if (fail) {
  for (const f of failures.slice(0, 40)) console.log("  ✗ " + f);
  process.exit(1);
}
