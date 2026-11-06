// SERVER-ONLY: muat data laporan merchant (snapshot valid + params + notes) untuk
// satu lead & periode, lalu hitung metrik dengan lib/merchant-report/metrics.ts.
// Baris dibaca berhalaman (PostgREST memotong di 1.000 baris) berurutan
// (period_start, row_seq) — urutan itu bagian dari rumus (lihat metrics.ts).

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeReportMetrics, DEFAULT_PARAMS, type MetricRow, type ReportParams, type ReportMetrics } from "./metrics";

const COLS =
  "period_start, post_id, location_id, location_name_display, location_city, post_title, post_date, duration_sec, " +
  "task_type, creator_username, creator_name, creator_level, creator_city, creator_link_status, sales_value, orders, " +
  "redemption_amount, video_views";
const PAGE = 1000;

export function periodRange(from: string, to: string): string[] {
  const out: string[] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ty = +to.slice(0, 4), tm = +to.slice(5, 7);
  while ((y < ty || (y === ty && m <= tm)) && out.length < 24) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export async function loadParams(supabase: SupabaseClient, leadId: string): Promise<ReportParams> {
  const { data } = await supabase.from("merchant_report_params").select("*").eq("lead_id", leadId).maybeSingle();
  if (!data) return DEFAULT_PARAMS;
  const num = (v: unknown, d: number) => (v === null || v === undefined || Number.isNaN(Number(v)) ? d : Number(v));
  const D = DEFAULT_PARAMS;
  return {
    score_w_gmv: num(data.score_w_gmv, D.score_w_gmv),
    score_w_red: num(data.score_w_red, D.score_w_red),
    score_w_ord: num(data.score_w_ord, D.score_w_ord),
    outlet_l1: num(data.outlet_l1, D.outlet_l1),
    outlet_l2: num(data.outlet_l2, D.outlet_l2),
    creator_l1: num(data.creator_l1, D.creator_l1),
    creator_l2: num(data.creator_l2, D.creator_l2),
    creator_l3_min_views: num(data.creator_l3_min_views, D.creator_l3_min_views),
    low_red: num(data.low_red, D.low_red),
    bucket_edges: Array.isArray(data.bucket_edges) && data.bucket_edges.length === 4 ? data.bucket_edges.map(Number) : D.bucket_edges,
    scenario: data.scenario && typeof data.scenario === "object" ? (data.scenario as Record<string, number[]>) : D.scenario,
    kpi: { ...D.kpi, ...(data.kpi && typeof data.kpi === "object" ? (data.kpi as Partial<ReportParams["kpi"]>) : {}) },
  };
}

export type LoadedReport = {
  periods: string[]; // bulan dalam rentang yang PUNYA data
  missing: string[]; // bulan dalam rentang tanpa data (tidak diisi perkiraan)
  metrics: ReportMetrics | null;
  params: ReportParams;
};

export async function loadReport(supabase: SupabaseClient, leadId: string, from: string, to: string): Promise<LoadedReport> {
  const range = periodRange(from, to);
  const params = await loadParams(supabase, leadId);
  if (range.length === 0) return { periods: [], missing: [], metrics: null, params };
  const start = `${range[0]}-01`;
  const end = `${range[range.length - 1]}-01`;

  const base = () =>
    supabase
      .from("tiktok_post_snapshots")
      .select(COLS, { count: "exact" })
      .eq("lead_id", leadId)
      .eq("status_valid", true)
      .gte("period_start", start)
      .lte("period_start", end)
      .order("period_start")
      .order("row_seq");

  const first = await base().range(0, PAGE - 1);
  if (first.error) throw new Error(first.error.message);
  const total = first.count ?? first.data?.length ?? 0;
  const pages = [first.data ?? []];
  const rest: Promise<{ data: unknown[] | null; error: { message: string } | null }>[] = [];
  for (let off = PAGE; off < total; off += PAGE) rest.push(base().range(off, off + PAGE - 1) as never);
  for (const r of await Promise.all(rest)) {
    if (r.error) throw new Error(r.error.message);
    pages.push((r.data ?? []) as never);
  }
  const raw = pages.flat() as unknown as Record<string, unknown>[];
  const rows: MetricRow[] = raw.map((r) => ({
    period: String(r.period_start).slice(0, 7),
    post_id: String(r.post_id),
    location_id: String(r.location_id),
    location_name_display: (r.location_name_display as string) ?? null,
    location_city: (r.location_city as string) ?? null,
    post_title: (r.post_title as string) ?? null,
    post_date: (r.post_date as string) ?? null,
    duration_sec: r.duration_sec === null ? null : Number(r.duration_sec),
    task_type: (r.task_type as string) ?? null,
    creator_username: String(r.creator_username),
    creator_name: (r.creator_name as string) ?? null,
    creator_level: (r.creator_level as string) ?? null,
    creator_city: (r.creator_city as string) ?? null,
    creator_link_status: (r.creator_link_status as string) ?? null,
    sales_value: Number(r.sales_value),
    orders: Number(r.orders),
    redemption_amount: Number(r.redemption_amount),
    video_views: Number(r.video_views),
  }));
  const have = new Set(rows.map((r) => r.period));
  const periods = range.filter((p) => have.has(p));
  const missing = range.filter((p) => !have.has(p));
  return { periods, missing, metrics: periods.length ? computeReportMetrics(periods, rows, params) : null, params };
}
