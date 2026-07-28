import { readFileSync } from "node:fs";
import XLSX from "xlsx";
import { parseVideoGmvWorkbook } from "./lib/mcn/video-ingest";

const URL_BASE = "https://vgjzvdpxrdoefoncuazw.supabase.co";
const KEY = process.env.SB_ANON!;
const FILE = "/root/.claude/uploads/41a89da7-fd94-5109-bf75-e12e0be5e220/6b38f076-CreatorAnalysis_PostOnly_ManagedCreators_20260701_20260707_1.xlsx";

const wb = XLSX.read(readFileSync(FILE), { type: "buffer" });
const sheets = wb.SheetNames.map((name) => ({
  name,
  cells: XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" }),
}));
const res = parseVideoGmvWorkbook(sheets);
if (!res.ok) { console.error("PARSE GAGAL:", res.error); process.exit(1); }

const payload = res.rows.map((r) => ({
  username: r.username, name: r.name,
  sales_value: r.salesValue, orders: r.orders, aov: r.aov,
  redemption_amount: r.redemptionAmount, redeemed_orders: r.redeemedOrders,
  new_posts: r.newPosts, posts_with_views: r.postsWithViews, posts_with_sales: r.postsWithSales,
  video_views: r.videoViews, ctr: r.ctr, cvr: r.cvr,
  avg_views_per_post: r.avgViewsPerPost, avg_sales_value_per_post: r.avgSalesValuePerPost,
  binding_status: r.bindingStatus, creator_level: r.creatorLevel, city: r.city,
}));

console.log(`periode ${res.periodStart}..${res.periodEnd} | ${payload.length} baris | skipped ${res.skipped.length}`);

const CHUNK = 400;
let sent = 0;
for (let i = 0; i < payload.length; i += CHUNK) {
  const chunk = payload.slice(i, i + CHUNK);
  const r = await fetch(`${URL_BASE}/rest/v1/_vgmv_load`, {
    method: "POST",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(chunk),
  });
  if (!r.ok) { console.error(`chunk ${i} HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); process.exit(1); }
  sent += chunk.length;
  console.log(`  terkirim ${sent}/${payload.length}`);
}
console.log("SELESAI kirim.");
