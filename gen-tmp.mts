import { readFileSync, writeFileSync } from "node:fs";
import XLSX from "xlsx";
import { parseVideoGmvWorkbook } from "./lib/mcn/video-ingest";
const FILE = "/root/.claude/uploads/41a89da7-fd94-5109-bf75-e12e0be5e220/6b38f076-CreatorAnalysis_PostOnly_ManagedCreators_20260701_20260707_1.xlsx";
const wb = XLSX.read(readFileSync(FILE), { type: "buffer" });
const sheets = wb.SheetNames.map((n) => ({ n, s: wb.Sheets[n] })).map(({ n, s }) => ({
  name: n, cells: XLSX.utils.sheet_to_json<string[]>(s, { header: 1, raw: false, defval: "" }),
}));
const res = parseVideoGmvWorkbook(sheets);
if (!res.ok) { console.error(res.error); process.exit(1); }

const bindSet = new Set(res.rows.map(r => r.bindingStatus ?? ""));
const lvlSet = new Set(res.rows.map(r => r.creatorLevel ?? ""));
const citySet = new Set(res.rows.map(r => r.city ?? ""));
console.log("distinct binding:", JSON.stringify([...bindSet]));
console.log("distinct level:", JSON.stringify([...lvlSet].sort()));
console.log("distinct city:", citySet.size);

const q = (s: string | null) => (s === null || s === "" ? "null" : `'${s.replace(/'/g, "''")}'`);
const i = (v: number | null) => (v === null ? "null" : Math.round(v).toString());
const d = (v: number | null, p: number) => (v === null ? "null" : Number(v.toFixed(p)).toString());

const tuples = res.rows.map((r) =>
  `(${q(r.username)},${q(r.name)},${i(r.salesValue)},${i(r.orders)},${i(r.aov)},${i(r.redemptionAmount)},` +
  `${i(r.redeemedOrders)},${i(r.newPosts)},${i(r.postsWithViews)},${i(r.postsWithSales)},${i(r.videoViews)},` +
  `${d(r.ctr, 6)},${d(r.cvr, 6)},${d(r.avgViewsPerPost, 1)},${i(r.avgSalesValuePerPost)},` +
  `${q(r.bindingStatus)},${q(r.creatorLevel)},${q(r.city)})`
);
const COLS = "username,name,sales_value,orders,aov,redemption_amount,redeemed_orders,new_posts,posts_with_views,posts_with_sales,video_views,ctr,cvr,avg_views_per_post,avg_sales_value_per_post,binding_status,creator_level,city";
const CHUNK = 500;
let n = 0;
for (let k = 0; k < tuples.length; k += CHUNK) {
  n++;
  const sql = `insert into _vgmv_load(${COLS}) values\n${tuples.slice(k, k + CHUNK).join(",\n")};`;
  writeFileSync(`/tmp/claude-0/-home-user-MEAGO-MSDPS/41a89da7-fd94-5109-bf75-e12e0be5e220/scratchpad/chunk${n}.sql`, sql);
  console.log(`chunk${n}.sql -> ${tuples.slice(k, k + CHUNK).length} baris, ${(sql.length / 1024).toFixed(1)} KB`);
}
console.log("TOTAL KB:", (tuples.join(",").length / 1024).toFixed(1));
