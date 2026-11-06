// Report Kreator Bulanan otomatis (permintaan Rizal, ACC Yohan 2026-11-06). Menyusun detail
// satu kreator × satu bulan dari data yang SUDAH diunggah CM — tidak ada input baru:
//   · creator_period_summary          → performa All per minggu (W1-W5)
//   · creator_period_category_summary → GMV per kategori per minggu (0383)
//   · creator_video_gmv               → GMV Video per minggu + video terlaris bulan itu
// Pure (tanpa DB/React) supaya bisa di-QC (scripts/qc_creator_monthly_report.mjs).

import { w1w5WindowsOf, type WeekWindow } from "./weeks";
import { GMV_CATEGORIES, type GmvSubCategory } from "./gmv-category";

export type ReportSummaryRow = {
  period_start: string;
  created_at: string;
  affiliate_gmv: number | null;
  orders: number | null;
  aov: number | null;
  redemption_amount: number | null;
  redeemed_orders: number | null;
  new_posts: number | null;
  posts_with_sales: number | null;
  live_streams: number | null;
  valid_live_streams: number | null;
};

export type ReportCategoryRow = {
  category: string;
  period_start: string;
  created_at: string;
  affiliate_gmv: number | null;
};

export type ReportVideoRow = {
  video_id: string;
  video_title: string | null;
  period_start: string;
  views: number | null;
  likes: number | null;
  sales_value: number | null;
  orders: number | null;
};

export type VideoWeekAgg = { videos: number; views: number; likes: number; gmv: number; orders: number };

export type ReportWeek = {
  week: number; // 1..5
  window: WeekWindow;
  summary: ReportSummaryRow | null; // null = minggu belum diunggah (bukan nol)
  categoryGmv: Record<GmvSubCategory, number | null>;
  video: VideoWeekAgg | null;
};

export type TopVideo = {
  video_id: string;
  video_title: string | null;
  weeks: number;
  views: number;
  gmv: number;
  orders: number;
};

export type CreatorMonthlyReport = {
  weeks: ReportWeek[];
  totals: {
    gmv: number | null;
    orders: number | null;
    redemption: number | null;
    redeemedOrders: number | null;
    newPosts: number | null;
    postsWithSales: number | null;
    liveStreams: number | null;
    validLiveStreams: number | null;
    aov: number | null; // gmv / orders bulan (bukan rata-rata AOV mingguan)
    weeksWithData: number;
    categoryGmv: Record<GmvSubCategory, number | null>;
    video: VideoWeekAgg | null;
  };
  topVideos: TopVideo[];
};

const SUB_CATS = GMV_CATEGORIES.filter((c) => c.key !== "all").map((c) => c.key as GmvSubCategory);

function latestBy<T extends { created_at: string }>(rows: T[], key: (r: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = key(r);
    const ex = m.get(k);
    if (!ex || r.created_at > ex.created_at) m.set(k, r);
  }
  return m;
}

// Jumlah null-aware: null bila tak satu pun nilai ada (null ≠ 0).
function sumNullable(vals: (number | null | undefined)[]): number | null {
  let s = 0;
  let has = false;
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    s += Number(v);
    has = true;
  }
  return has ? s : null;
}

function emptyCat(): Record<GmvSubCategory, number | null> {
  return Object.fromEntries(SUB_CATS.map((k) => [k, null])) as Record<GmvSubCategory, number | null>;
}

export function buildCreatorMonthlyReport(args: {
  year: number;
  month: number;
  summary: ReportSummaryRow[];
  categories: ReportCategoryRow[];
  videos: ReportVideoRow[];
  topN?: number;
}): CreatorMonthlyReport {
  const windows = w1w5WindowsOf(args.year, args.month);
  const starts = new Set(windows.map((w) => w.start));

  const summaryByStart = latestBy(
    args.summary.filter((r) => starts.has(r.period_start)),
    (r) => r.period_start
  );
  const catByKey = latestBy(
    args.categories.filter((r) => starts.has(r.period_start)),
    (r) => `${r.category}|${r.period_start}`
  );

  // Video: unik per (video_id, period_start) di DB; tetap di-guard dengan "terakhir menang".
  const monthVideos = args.videos.filter((v) => starts.has(v.period_start));
  const videoByWeek = new Map<string, VideoWeekAgg>();
  const seen = new Set<string>();
  for (const v of monthVideos) {
    const k = `${v.video_id}|${v.period_start}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const acc = videoByWeek.get(v.period_start) ?? { videos: 0, views: 0, likes: 0, gmv: 0, orders: 0 };
    acc.videos += 1;
    acc.views += Number(v.views ?? 0);
    acc.likes += Number(v.likes ?? 0);
    acc.gmv += Number(v.sales_value ?? 0);
    acc.orders += Number(v.orders ?? 0);
    videoByWeek.set(v.period_start, acc);
  }

  const weeks: ReportWeek[] = windows.map((w, i) => {
    const categoryGmv = emptyCat();
    for (const k of SUB_CATS) categoryGmv[k] = catByKey.get(`${k}|${w.start}`)?.affiliate_gmv ?? null;
    return {
      week: i + 1,
      window: w,
      summary: summaryByStart.get(w.start) ?? null,
      categoryGmv,
      video: videoByWeek.get(w.start) ?? null,
    };
  });

  const filled = weeks.map((w) => w.summary).filter((s): s is ReportSummaryRow => s !== null);
  const gmv = sumNullable(filled.map((s) => s.affiliate_gmv));
  const orders = sumNullable(filled.map((s) => s.orders));

  const catTotals = emptyCat();
  for (const k of SUB_CATS) catTotals[k] = sumNullable(weeks.map((w) => w.categoryGmv[k]));

  let videoTotal: VideoWeekAgg | null = null;
  for (const w of weeks) {
    if (!w.video) continue;
    videoTotal ??= { videos: 0, views: 0, likes: 0, gmv: 0, orders: 0 };
    videoTotal.videos += w.video.videos;
    videoTotal.views += w.video.views;
    videoTotal.likes += w.video.likes;
    videoTotal.gmv += w.video.gmv;
    videoTotal.orders += w.video.orders;
  }

  // Video terlaris bulan ini: agregat lintas minggu per video_id, urut GMV lalu views.
  const byVideo = new Map<string, TopVideo>();
  for (const v of monthVideos) {
    const t = byVideo.get(v.video_id) ?? {
      video_id: v.video_id,
      video_title: v.video_title,
      weeks: 0,
      views: 0,
      gmv: 0,
      orders: 0,
    };
    t.weeks += 1;
    t.views += Number(v.views ?? 0);
    t.gmv += Number(v.sales_value ?? 0);
    t.orders += Number(v.orders ?? 0);
    if (!t.video_title && v.video_title) t.video_title = v.video_title;
    byVideo.set(v.video_id, t);
  }
  const topVideos = [...byVideo.values()]
    .sort((a, b) => b.gmv - a.gmv || b.views - a.views || a.video_id.localeCompare(b.video_id))
    .slice(0, args.topN ?? 10);

  return {
    weeks,
    totals: {
      gmv,
      orders,
      redemption: sumNullable(filled.map((s) => s.redemption_amount)),
      redeemedOrders: sumNullable(filled.map((s) => s.redeemed_orders)),
      newPosts: sumNullable(filled.map((s) => s.new_posts)),
      postsWithSales: sumNullable(filled.map((s) => s.posts_with_sales)),
      liveStreams: sumNullable(filled.map((s) => s.live_streams)),
      validLiveStreams: sumNullable(filled.map((s) => s.valid_live_streams)),
      aov: gmv !== null && orders ? gmv / orders : null,
      weeksWithData: filled.length,
      categoryGmv: catTotals,
      video: videoTotal,
    },
    topVideos,
  };
}
