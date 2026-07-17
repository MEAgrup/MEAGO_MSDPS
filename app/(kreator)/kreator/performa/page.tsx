import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatYMD, weekIndexOfDate } from "@/lib/mcn/weeks";
import { PerformaView, type WeekMetrics, type Averages } from "./performa-view";

// Kolom performa yang BOLEH tampil di portal (tanpa commission_share/refund/internal).
type SummaryRow = {
  period_start: string; // YMD
  created_at: string;
  gmv_total: number | null;
  orders: number | null;
  aov: number | null;
  redemption_amount: number | null;
  redeemed_orders: number | null;
  new_posts: number | null;
  posts_with_sales: number | null;
  live_streams: number | null;
  valid_live_streams: number | null;
};

const METRIC_KEYS = [
  "gmv_total",
  "orders",
  "aov",
  "redemption_amount",
  "redeemed_orders",
  "new_posts",
  "posts_with_sales",
  "live_streams",
  "valid_live_streams",
] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

// Dedupe per period_start (created_at terbaru menang).
function dedupe(rows: SummaryRow[]): SummaryRow[] {
  const byPeriod = new Map<string, SummaryRow>();
  for (const r of rows) {
    const existing = byPeriod.get(r.period_start);
    if (!existing || r.created_at > existing.created_at) byPeriod.set(r.period_start, r);
  }
  return [...byPeriod.values()];
}

// Rata-rata BULANAN: jumlahkan per bulan per metrik (baris null di-skip), lalu bagi
// jumlah bulan yang punya data untuk metrik itu. Tanpa data → null (bukan 0).
function build3MonthAverages(rows: SummaryRow[]): Averages {
  type MonthAcc = Record<MetricKey, { sum: number; has: boolean }>;
  const monthAcc = new Map<string, MonthAcc>();
  for (const row of rows) {
    const month = row.period_start.slice(0, 7);
    let acc = monthAcc.get(month);
    if (!acc) {
      acc = Object.fromEntries(METRIC_KEYS.map((k) => [k, { sum: 0, has: false }])) as MonthAcc;
      monthAcc.set(month, acc);
    }
    for (const key of METRIC_KEYS) {
      const v = row[key];
      if (v !== null && v !== undefined) {
        acc[key].sum += v;
        acc[key].has = true;
      }
    }
  }
  const average = (key: MetricKey): number | null => {
    let sum = 0;
    let count = 0;
    for (const acc of monthAcc.values()) {
      if (acc[key].has) {
        sum += acc[key].sum;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  };
  return Object.fromEntries(METRIC_KEYS.map((k) => [k, average(k)])) as Averages;
}

export default async function PerformaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: creator } = await supabase
    .from("mcn_creators")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!creator) redirect("/dashboard");

  // Rentang 3 bulan (bulan berjalan + 2 sebelumnya) — wall clock, bukan new Date(iso).
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  let boundaryYear = curYear;
  let boundaryMonth = curMonth - 2;
  if (boundaryMonth <= 0) {
    boundaryMonth += 12;
    boundaryYear -= 1;
  }
  const boundaryStart = formatYMD(boundaryYear, boundaryMonth, 1);
  const curMonthPrefix = `${curYear}-${String(curMonth).padStart(2, "0")}`;

  const { data: raw } = await supabase
    .from("creator_period_summary")
    .select(
      "period_start, created_at, gmv_total, orders, aov, redemption_amount, redeemed_orders, new_posts, posts_with_sales, live_streams, valid_live_streams"
    )
    .eq("mcn_creator_id", creator.id)
    .gte("period_start", boundaryStart);
  const rows = dedupe((raw as SummaryRow[] | null) ?? []);

  // Minggu W1–W5 bulan berjalan.
  const weekMap = new Map<number, WeekMetrics>();
  for (const r of rows) {
    if (!r.period_start.startsWith(curMonthPrefix)) continue;
    const wi = weekIndexOfDate(r.period_start);
    if (wi === null) continue;
    weekMap.set(wi, {
      week: wi,
      gmv_total: r.gmv_total,
      orders: r.orders,
      aov: r.aov,
      redemption_amount: r.redemption_amount,
      redeemed_orders: r.redeemed_orders,
      new_posts: r.new_posts,
      posts_with_sales: r.posts_with_sales,
      live_streams: r.live_streams,
      valid_live_streams: r.valid_live_streams,
    });
  }
  const weeks = [...weekMap.values()].sort((a, b) => a.week - b.week);
  const averages = build3MonthAverages(rows);
  const monthLabel = `${MONTH_NAMES_ID[curMonth - 1]} ${curYear}`;

  return (
    <>
      <h1>Performa Saya</h1>
      <p className="page-sub">Metrik operasional afiliasi TikTok kamu per minggu & rata-rata bulanan.</p>
      <PerformaView weeks={weeks} averages={averages} monthLabel={monthLabel} />
    </>
  );
}
