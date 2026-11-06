// Metrik Laporan Performa Merchant — PORT 1:1 dari compute_metrics.py (sample
// "Analisa Sushi Yay Agu–Sep 2026" yang disetujui Yohan 2026-11-04).
//
// WAJIB sama dengan skrip itu. Detail yang sengaja dipertahankan:
//   * urutan baris = periode lalu row_seq (urutan kemunculan di file) — dipakai
//     untuk "nama pertama", "kota/level terakhir", tie-break sort stabil;
//   * peringkat persentil = indeks kemunculan pertama di list terurut ÷ (n−1),
//     n=1 -> 1,0;
//   * jumlah baris top 5% memakai round() Python (pembulatan bankir);
//   * median = statistics.median (rata-rata dua tengah bila genap).
// Versi per bulan dari rumus yang sama ada di view v_merchant_* (migrasi 0381).
// Pure — tanpa import DB/React.

export type MetricRow = {
  period: string; // YYYY-MM
  post_id: string;
  location_id: string;
  location_name_display: string | null;
  location_city: string | null;
  post_title: string | null;
  post_date: string | null; // YYYY-MM-DD
  duration_sec: number | null;
  task_type: string | null;
  creator_username: string;
  creator_name: string | null;
  creator_level: string | null;
  creator_city: string | null;
  creator_link_status: string | null;
  sales_value: number;
  orders: number;
  redemption_amount: number;
  video_views: number;
};

export type ReportParams = {
  score_w_gmv: number;
  score_w_red: number;
  score_w_ord: number;
  outlet_l1: number;
  outlet_l2: number;
  creator_l1: number;
  creator_l2: number;
  creator_l3_min_views: number;
  low_red: number;
  bucket_edges: number[]; // 4 nilai naik
  scenario: Record<string, number[]>;
  kpi: { aov_min: number; red_min: number; conv_min: number; top2_max: number };
};

export const DEFAULT_PARAMS: ReportParams = {
  score_w_gmv: 0.4,
  score_w_red: 0.3,
  score_w_ord: 0.3,
  outlet_l1: 0.8,
  outlet_l2: 0.4,
  creator_l1: 0.9,
  creator_l2: 0.6,
  creator_l3_min_views: 1000,
  low_red: 0.6,
  bucket_edges: [5, 10, 20, 50],
  scenario: { Konservatif: [0.85, 0.95, 1.0], Moderat: [1.0, 1.2, 1.3], Agresif: [1.15, 1.5, 1.7] },
  kpi: { aov_min: 60000, red_min: 0.9, conv_min: 0.45, top2_max: 0.4 },
};

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export function monthLabel(period: string): string {
  return BULAN[Number(period.slice(5, 7)) - 1] ?? period;
}
export function monthLabelLong(period: string): string {
  return `${monthLabel(period)} ${period.slice(0, 4)}`;
}
export function addMonths(period: string, n: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

// ---- Bucket ----------------------------------------------------------------------
export function bucketLabels(edges: number[]): string[] {
  const [a, b, c, d] = edges;
  return ["0", `1-${a}`, `${a + 1}-${b}`, `${b + 1}-${c}`, `${c + 1}-${d}`, `>${d}`];
}
export function bucketOf(o: number, edges: number[]): string {
  const L = bucketLabels(edges);
  if (o === 0) return L[0];
  for (let i = 0; i < 4; i++) if (o <= edges[i]) return L[i + 1];
  return L[5];
}

// ---- Helper semantik Python ------------------------------------------------------
/** round() Python 3: pembulatan setengah ke genap. */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}
export function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
/** prank() compute_metrics.py: indeks kemunculan pertama di list terurut ÷ (n−1). */
export function prank(vals: number[]): Map<number, number> {
  const s = [...vals].sort((a, b) => a - b);
  const n = s.length;
  const out = new Map<number, number>();
  for (let i = n - 1; i >= 0; i--) out.set(s[i], n > 1 ? i / (n - 1) : 1.0);
  return out;
}
const div = (a: number, b: number) => (b ? a / b : 0);
const compact = (period: string) => period.replace("-", "");
const ymdCompact = (d: string | null) => (d ? d.replace(/-/g, "") : "");
const isNewPost = (r: MetricRow) => ymdCompact(r.post_date).startsWith(compact(r.period));

// ---- Tipe hasil --------------------------------------------------------------------
export type Monthly = {
  period: string;
  label: string;
  gmv: number;
  orders: number;
  views: number;
  redemption: number;
  red_rate: number;
  aov: number;
  new_posts: number;
  active_posts: number;
  gmv_per_post: number;
  order_per_1k: number;
  outlets_seen: number;
  outlets_active: number;
  creators_active: number;
  creators_gmv: number;
  outlets_gt_top: number;
  buckets: Record<string, number>;
};
export type OutletStat = {
  id: string;
  name: string;
  city: string;
  gmv: number;
  orders: number;
  red: number;
  views: number;
  red_rate: number;
  score: number;
  layer: 1 | 2 | 3;
  orders_by_month: Record<string, number>;
  newpost_by_month: Record<string, number>;
};
export type CityStat = {
  city: string;
  gmv: number;
  orders: number;
  n_outlets: number;
  gmv_per_outlet: number;
  by_month: Record<string, number>;
};
export type CreatorLayer = "Layer 1" | "Layer 2" | "Layer 3" | "Monitor" | "Tidak bound/linked";
export type CreatorActivity = "Aktif" | "Melambat" | "Tidak posting >30 hari";
export type CreatorStat = {
  username: string;
  name: string;
  city: string;
  level: string;
  bound: boolean;
  gmv: number;
  orders: number;
  red: number;
  views: number;
  posts: number;
  gmv_per_post: number;
  days_since: number | null;
  activity: CreatorActivity;
  score?: number;
  layer: CreatorLayer;
  by_month: Record<string, number>;
};
export type Feature = { feature: string; n: number; sell_rate: number; sell_rate_without: number; lift: number };
export type TopPost = {
  creator: string;
  outlet: string;
  title: string;
  views: number;
  gmv: number;
  duration: number | null;
  month: string;
};

export type ReportMetrics = {
  periods: string[];
  labels: string[];
  monthly: Monthly[];
  total: { gmv: number; orders: number; views: number; red: number; red_rate: number; aov: number };
  outlets: OutletStat[];
  layer_outlet: Record<1 | 2 | 3, { n: number; gmv: number; orders: number }>;
  cities: CityStat[];
  creator_share: { top2: number; top10: number; n: number; n_gmv: number };
  creator_layers: Record<CreatorLayer, { n: number; gmv: number }>;
  creator_activity: Record<CreatorActivity, number>;
  creators_top: CreatorStat[];
  best: {
    top5_share: number;
    n_rows: number;
    n_top: number;
    median_views_top: number;
    median_views_rest: number;
    duration: Record<string, { n: number; sell_rate: number }>;
    views: Record<string, { n: number; sell_rate: number }>;
    features: Feature[];
    top_posts: TopPost[];
  };
  task_types: { name: string; n: number; gmv_per_post: number }[];
  scenario: { name: string; values: number[] }[];
  scenario_periods: string[];
  bucket_labels: string[];
};

export const DURATION_BUCKETS = ["≤15 dtk", "16–25 dtk", "26–35 dtk", ">35 dtk"];
export const VIEW_BUCKETS = ["≤500", "501–2.000", "2.000–10.000", "10.000–50.000", ">50.000"];
function dbucket(d: number) {
  return d <= 15 ? DURATION_BUCKETS[0] : d <= 25 ? DURATION_BUCKETS[1] : d <= 35 ? DURATION_BUCKETS[2] : DURATION_BUCKETS[3];
}
function vbucket(v: number) {
  return v <= 500 ? VIEW_BUCKETS[0] : v <= 2000 ? VIEW_BUCKETS[1] : v <= 10000 ? VIEW_BUCKETS[2] : v <= 50000 ? VIEW_BUCKETS[3] : VIEW_BUCKETS[4];
}

// Regex fitur caption — disalin dari compute_metrics.py (re.I).
export const CAPTION_FEATURES: [string, RegExp][] = [
  ["Menyebut harga / diskon", /(\d+\s?(rb|ribu|k)\b|rp\s?\d|diskon|promo|cuma|hanya|murah|gratis)/i],
  ["CTA tag lokasi", /(tag lokasi|klik.*lokasi|lokasi.*(hijau|klik)|pilih voucher)/i],
  [
    "Menyebut nama outlet / kota",
    /(bandung|jakarta|bogor|depok|bekasi|tangerang|medan|makassar|pekanbaru|cirebon|sidoarjo|surabaya|cimahi|yogyakarta|jogja|semarang|malang|cikarang|bintaro|bsd|cibubur)/i,
  ],
  ["Kata urgensi", /(buruan|sekarang|cepet|cepat|segera|jangan sampai|terbatas|hari ini)/i],
  ["Edukasi AYCE / paket", /(ayce|all you can eat|premium|ultimate|reguler|paket)/i],
];

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(+fromYmd.slice(0, 4), +fromYmd.slice(5, 7) - 1, +fromYmd.slice(8, 10));
  const b = Date.UTC(+toYmd.slice(0, 4), +toYmd.slice(5, 7) - 1, +toYmd.slice(8, 10));
  return Math.round((b - a) / 86400000);
}
function lastDay(period: string): string {
  const y = +period.slice(0, 4), m = +period.slice(5, 7);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
}

/**
 * @param periods bulan-bulan periode laporan, urut naik ("2026-08","2026-09").
 * @param rows    baris VALID periode itu, urut (period, row_seq).
 */
export function computeReportMetrics(periods: string[], rows: MetricRow[], params: ReportParams = DEFAULT_PARAMS): ReportMetrics {
  const P = params;
  const labels = periods.map(monthLabel);
  const edges = P.bucket_edges;
  const BL = bucketLabels(edges);
  const zeroByMonth = () => Object.fromEntries(labels.map((l) => [l, 0])) as Record<string, number>;

  // ---- Bulanan
  const monthly: Monthly[] = periods.map((period, i) => {
    const R = rows.filter((r) => r.period === period);
    const gmv = R.reduce((s, r) => s + r.sales_value, 0);
    const orders = R.reduce((s, r) => s + r.orders, 0);
    const views = R.reduce((s, r) => s + r.video_views, 0);
    const red = R.reduce((s, r) => s + r.redemption_amount, 0);
    const posts = new Set(R.map((r) => r.post_id));
    const newposts = new Set(R.filter(isNewPost).map((r) => r.post_id));
    const creators = new Set(R.map((r) => r.creator_username));
    const creGmv = new Set(R.filter((r) => r.sales_value > 0).map((r) => r.creator_username));
    const outletOrders = new Map<string, number>();
    for (const r of R) outletOrders.set(r.location_id, (outletOrders.get(r.location_id) ?? 0) + r.orders);
    const buckets: Record<string, number> = Object.fromEntries(BL.map((b) => [b, 0]));
    for (const o of outletOrders.values()) buckets[bucketOf(o, edges)]++;
    return {
      period,
      label: labels[i],
      gmv,
      orders,
      views,
      redemption: red,
      red_rate: div(red, gmv),
      aov: div(gmv, orders),
      new_posts: newposts.size,
      active_posts: posts.size,
      gmv_per_post: div(gmv, posts.size),
      order_per_1k: views ? orders / (views / 1000) : 0,
      outlets_seen: outletOrders.size,
      outlets_active: [...outletOrders.values()].filter((v) => v > 0).length,
      creators_active: creators.size,
      creators_gmv: creGmv.size,
      outlets_gt_top: [...outletOrders.values()].filter((v) => v > edges[3]).length,
      buckets,
    };
  });
  const tg = monthly.reduce((s, m) => s + m.gmv, 0);
  const to = monthly.reduce((s, m) => s + m.orders, 0);
  const tred = monthly.reduce((s, m) => s + m.redemption, 0);
  const total = {
    gmv: tg,
    orders: to,
    views: monthly.reduce((s, m) => s + m.views, 0),
    red: tred,
    red_rate: div(tred, tg),
    aov: div(tg, to),
  };
  const labelOf = (period: string) => labels[periods.indexOf(period)];

  // ---- Outlet
  type OAcc = { gmv: number; orders: number; red: number; views: number; city: string; name: string; byMonth: Record<string, number>; newpost: Record<string, number> };
  const O = new Map<string, OAcc>();
  for (const r of rows) {
    let o = O.get(r.location_id);
    if (!o) {
      o = { gmv: 0, orders: 0, red: 0, views: 0, city: "", name: "", byMonth: zeroByMonth(), newpost: zeroByMonth() };
      O.set(r.location_id, o);
    }
    o.gmv += r.sales_value;
    o.orders += r.orders;
    o.red += r.redemption_amount;
    o.views += r.video_views;
    o.name = o.name || (r.location_name_display ?? "");
    o.city = o.city || (r.location_city ?? "");
    o.byMonth[labelOf(r.period)] += r.orders;
    if (isNewPost(r)) o.newpost[labelOf(r.period)] += 1;
  }
  const ov = [...O.values()];
  const pg = prank(ov.map((o) => o.gmv));
  const pr = prank(ov.map((o) => o.red));
  const po = prank(ov.map((o) => o.orders));
  const outlets: OutletStat[] = [...O.entries()].map(([id, o]) => {
    const score = P.score_w_gmv * pg.get(o.gmv)! + P.score_w_red * pr.get(o.red)! + P.score_w_ord * po.get(o.orders)!;
    return {
      id,
      name: o.name,
      city: o.city,
      gmv: o.gmv,
      orders: o.orders,
      red: o.red,
      views: o.views,
      red_rate: div(o.red, o.gmv),
      score,
      layer: score >= P.outlet_l1 ? 1 : score >= P.outlet_l2 ? 2 : 3,
      orders_by_month: o.byMonth,
      newpost_by_month: o.newpost,
    };
  });
  outlets.sort((a, b) => b.gmv - a.gmv);
  const layer_outlet = Object.fromEntries(
    ([1, 2, 3] as const).map((L) => {
      const x = outlets.filter((o) => o.layer === L);
      return [L, { n: x.length, gmv: x.reduce((s, o) => s + o.gmv, 0), orders: x.reduce((s, o) => s + o.orders, 0) }];
    }),
  ) as ReportMetrics["layer_outlet"];

  // ---- Kota (kota outlet untuk total; kota baris untuk tren bulanan — sama dgn skrip)
  type CAcc = { gmv: number; orders: number; views: number; outlets: Set<string>; byMonth: Record<string, number> };
  const C = new Map<string, CAcc>();
  const cityAcc = (k: string) => {
    let c = C.get(k);
    if (!c) {
      c = { gmv: 0, orders: 0, views: 0, outlets: new Set(), byMonth: zeroByMonth() };
      C.set(k, c);
    }
    return c;
  };
  for (const o of outlets) {
    const c = cityAcc(o.city || "(tanpa kota)");
    c.gmv += o.gmv;
    c.orders += o.orders;
    c.views += o.views;
    c.outlets.add(o.id);
  }
  for (const r of rows) cityAcc(r.location_city || "(tanpa kota)").byMonth[labelOf(r.period)] += r.sales_value;
  const cities: CityStat[] = [...C.entries()]
    .map(([city, v]) => ({
      city,
      gmv: v.gmv,
      orders: v.orders,
      n_outlets: v.outlets.size,
      gmv_per_outlet: div(v.gmv, v.outlets.size),
      by_month: v.byMonth,
    }))
    .sort((a, b) => b.gmv - a.gmv);

  // ---- Creator
  type KAcc = { gmv: number; orders: number; red: number; views: number; posts: Set<string>; name: string; city: string; level: string; link: string; last_post: string; byMonth: Record<string, number> };
  const K = new Map<string, KAcc>();
  const lastPeriod = periods[periods.length - 1];
  for (const r of rows) {
    let k = K.get(r.creator_username);
    if (!k) {
      k = { gmv: 0, orders: 0, red: 0, views: 0, posts: new Set(), name: "", city: "", level: "", link: "", last_post: "", byMonth: zeroByMonth() };
      K.set(r.creator_username, k);
    }
    k.gmv += r.sales_value;
    k.orders += r.orders;
    k.red += r.redemption_amount;
    k.views += r.video_views;
    k.posts.add(r.post_id);
    k.name = k.name || (r.creator_name ?? "");
    k.city = r.creator_city || k.city;
    k.level = r.creator_level || k.level;
    if (r.period === lastPeriod && r.creator_link_status) k.link = r.creator_link_status;
    const pd = ymdCompact(r.post_date);
    if (pd > k.last_post) k.last_post = pd;
    k.byMonth[labelOf(r.period)] += r.sales_value;
  }
  const asof = lastDay(lastPeriod);
  const creators: CreatorStat[] = [...K.entries()].map(([u, k]) => {
    const days = /^\d{8}$/.test(k.last_post)
      ? daysBetween(`${k.last_post.slice(0, 4)}-${k.last_post.slice(4, 6)}-${k.last_post.slice(6, 8)}`, asof)
      : null;
    return {
      username: u,
      name: k.name,
      city: k.city,
      level: k.level,
      bound: !!k.link,
      gmv: k.gmv,
      orders: k.orders,
      red: k.red,
      views: k.views,
      posts: k.posts.size,
      gmv_per_post: div(k.gmv, k.posts.size),
      days_since: days,
      activity: days !== null && days <= 14 ? "Aktif" : days !== null && days <= 30 ? "Melambat" : "Tidak posting >30 hari",
      layer: "Tidak bound/linked",
      by_month: k.byMonth,
    };
  });
  creators.sort((a, b) => b.gmv - a.gmv);
  const ctg = creators.reduce((s, c) => s + c.gmv, 0);
  const creator_share = {
    top2: div(creators.slice(0, 2).reduce((s, c) => s + c.gmv, 0), ctg),
    top10: div(creators.slice(0, 10).reduce((s, c) => s + c.gmv, 0), ctg),
    n: creators.length,
    n_gmv: creators.filter((c) => c.gmv > 0).length,
  };
  const elig = creators.filter((c) => c.bound && c.gmv > 0);
  const eligSet = new Set(elig);
  const cg = prank(elig.map((c) => c.gmv));
  const cr = prank(elig.map((c) => c.red));
  const co = prank(elig.map((c) => c.orders));
  for (const c of creators) {
    if (eligSet.has(c)) {
      const s = P.score_w_gmv * cg.get(c.gmv)! + P.score_w_red * cr.get(c.red)! + P.score_w_ord * co.get(c.orders)!;
      c.score = s;
      c.layer = s >= P.creator_l1 ? "Layer 1" : s >= P.creator_l2 ? "Layer 2" : "Monitor";
    } else if (c.bound && c.views >= P.creator_l3_min_views) c.layer = "Layer 3";
    else if (c.bound) c.layer = "Monitor";
    else c.layer = "Tidak bound/linked";
  }
  const LAYERS: CreatorLayer[] = ["Layer 1", "Layer 2", "Layer 3", "Monitor", "Tidak bound/linked"];
  const creator_layers = Object.fromEntries(
    LAYERS.map((L) => {
      const x = creators.filter((c) => c.layer === L);
      return [L, { n: x.length, gmv: x.reduce((s, c) => s + c.gmv, 0) }];
    }),
  ) as ReportMetrics["creator_layers"];
  const creator_activity: Record<CreatorActivity, number> = { Aktif: 0, Melambat: 0, "Tidak posting >30 hari": 0 };
  for (const c of creators) if (c.bound) creator_activity[c.activity]++;

  // ---- Best practice (baris post × outlet)
  const PR = [...rows].sort((a, b) => b.sales_value - a.sales_value);
  const n5 = Math.max(1, pyRound(PR.length * 0.05));
  const top = PR.slice(0, n5);
  const rest = PR.slice(n5);
  const sumG = (x: MetricRow[]) => x.reduce((s, r) => s + r.sales_value, 0);
  const dur = new Map<string, [number, number]>();
  const vw = new Map<string, [number, number]>();
  for (const r of rows) {
    if (r.duration_sec) {
      const b = dbucket(r.duration_sec);
      const d = dur.get(b) ?? [0, 0];
      d[0]++;
      d[1] += r.sales_value > 0 ? 1 : 0;
      dur.set(b, d);
    }
    const b = vbucket(r.video_views);
    const v = vw.get(b) ?? [0, 0];
    v[0]++;
    v[1] += r.sales_value > 0 ? 1 : 0;
    vw.set(b, v);
  }
  const rateMap = (m: Map<string, [number, number]>, keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, { n: m.get(k)?.[0] ?? 0, sell_rate: div(m.get(k)?.[1] ?? 0, m.get(k)?.[0] ?? 0) }]));
  const features: Feature[] = CAPTION_FEATURES.map(([feature, rx]) => {
    const w = rows.filter((r) => rx.test(r.post_title ?? ""));
    const wo = rows.filter((r) => !rx.test(r.post_title ?? ""));
    const avgWo = div(sumG(wo), wo.length);
    return {
      feature,
      n: w.length,
      sell_rate: div(w.filter((r) => r.sales_value > 0).length, w.length),
      sell_rate_without: div(wo.filter((r) => r.sales_value > 0).length, wo.length),
      lift: w.length && wo.length ? div(sumG(w), w.length) / (avgWo || 1) : 0,
    };
  });
  const seen = new Set<string>();
  const top_posts: TopPost[] = [];
  for (const r of PR) {
    if (seen.has(r.post_id)) continue;
    seen.add(r.post_id);
    top_posts.push({
      creator: r.creator_username,
      outlet: r.location_name_display ?? "",
      title: Array.from(r.post_title ?? "").slice(0, 90).join(""),
      views: r.video_views,
      gmv: r.sales_value,
      duration: r.duration_sec,
      month: labelOf(r.period),
    });
    if (top_posts.length === 6) break;
  }
  const tasks = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const t = r.task_type || "(kosong)";
    tasks.set(t, [...(tasks.get(t) ?? []), r]);
  }
  const task_types = [...tasks.entries()]
    .map(([name, R]) => ({ name, n: R.length, gmv_per_post: div(sumG(R), R.length) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const base = monthly[monthly.length - 1]?.gmv ?? 0;
  const scenario = Object.entries(P.scenario).map(([name, mult]) => ({ name, values: mult.map((x) => base * x) }));
  const nScen = Math.max(0, ...Object.values(P.scenario).map((v) => v.length));

  return {
    periods,
    labels,
    monthly,
    total,
    outlets,
    layer_outlet,
    cities,
    creator_share,
    creator_layers,
    creator_activity,
    creators_top: creators.slice(0, 10),
    best: {
      top5_share: div(sumG(top), sumG(PR)),
      n_rows: PR.length,
      n_top: n5,
      median_views_top: median(top.map((r) => r.video_views)),
      median_views_rest: median(rest.map((r) => r.video_views)),
      duration: rateMap(dur, DURATION_BUCKETS),
      views: rateMap(vw, VIEW_BUCKETS),
      features,
      top_posts,
    },
    task_types,
    scenario,
    scenario_periods: Array.from({ length: nScen }, (_, i) => addMonths(lastPeriod, i + 1)),
    bucket_labels: BL,
  };
}
