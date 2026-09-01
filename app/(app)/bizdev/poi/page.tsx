import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { POI_TAB_CATEGORIES, POI_CATEGORY_LABELS, type PoiTabCategory } from "@/lib/mcn/poi-sop";
import { OPS_NAMES } from "@/lib/deals/intake";
import { type PoiTransaction } from "./poi-card";
import { PoiList } from "./poi-list";

type DealRow = {
  id: string;
  code: string | null;
  brand_name: string;
  pic_name: string | null;
  bd_id: string | null;
  ops_name: string | null;
  kategori_poi: string | null;
  visit_start_date: string | null;
  visit_start_time: string | null;
};

type ProgressRow = {
  id: string;
  deal_id: string;
  ops_datetime: string | null;
  actual_vt: number | null;
  total_gmv: number | null;
  report_link: string | null;
  report_status: string | null;
};

type StepRow = { progress_id: string; step_no: number; completed_at: string | null };

export default async function PoiSopPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();

  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || me?.division === "BizDev";
  if (!canView) redirect("/dashboard");

  const supabase = await getCachedClient();

  const [{ data: dealsRaw }, { data: emps }] = await Promise.all([
    supabase
      .from("brand_deals")
      .select("id, code, brand_name, pic_name, bd_id, ops_name, kategori_poi, visit_start_date, visit_start_time")
      .in("kategori_poi", Array.from(POI_TAB_CATEGORIES))
      .order("visit_start_date", { ascending: false }),
    supabase.from("employees").select("id, full_name"),
  ]);

  const deals = (dealsRaw as DealRow[] | null) ?? [];
  const bdNameById = new Map(((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name]));

  const dealIds = deals.map((d) => d.id);
  const [{ data: progressRaw }] = await Promise.all([
    dealIds.length > 0
      ? supabase
          .from("poi_sop_progress")
          .select("id, deal_id, ops_datetime, actual_vt, total_gmv, report_link, report_status")
          .in("deal_id", dealIds)
      : Promise.resolve({ data: [] as ProgressRow[] }),
  ]);

  const progressByDeal = new Map(((progressRaw as ProgressRow[] | null) ?? []).map((p) => [p.deal_id, p]));
  const progressIds = ((progressRaw as ProgressRow[] | null) ?? []).map((p) => p.id);

  const { data: stepsRaw } =
    progressIds.length > 0
      ? await supabase.from("poi_sop_steps").select("progress_id, step_no, completed_at").in("progress_id", progressIds)
      : { data: [] as StepRow[] };

  const stepsByProgress = new Map<string, StepRow[]>();
  for (const s of (stepsRaw as StepRow[] | null) ?? []) {
    const list = stepsByProgress.get(s.progress_id) ?? [];
    list.push(s);
    stepsByProgress.set(s.progress_id, list);
  }

  const transactions: PoiTransaction[] = deals
    .map((d): PoiTransaction | null => {
      const progress = progressByDeal.get(d.id);
      if (!progress) return null; // trigger DB belum sempat provisi (mis. race insert) — sembunyikan drpd error.
      return {
        deal_id: d.id,
        code: d.code,
        brand_name: d.brand_name,
        pic_name: d.pic_name,
        kategori_poi: d.kategori_poi as PoiTabCategory,
        bd_name: (d.bd_id && bdNameById.get(d.bd_id)) ?? "—",
        ops_name: d.ops_name,
        visit_start_date: d.visit_start_date,
        visit_start_time: d.visit_start_time,
        progress_id: progress.id,
        ops_datetime: progress.ops_datetime,
        actual_vt: progress.actual_vt,
        total_gmv: progress.total_gmv,
        report_link: progress.report_link,
        report_status: progress.report_status,
        steps: (stepsByProgress.get(progress.id) ?? []).sort((a, b) => a.step_no - b.step_no),
      };
    })
    .filter((t): t is PoiTransaction => t !== null);

  return (
    <>
      <h1>POI Accommodation &amp; TTD</h1>
      <p className="page-sub">
        Tracker SOP visit kreator per transaksi {POI_TAB_CATEGORIES.map((c) => POI_CATEGORY_LABELS[c]).join(" & ")}{" "}
        — 15 step Ops mulai listing kreator sampai report bulanan, dengan SLA Total / Pre-Visit / Post-Visit.
      </p>

      {transactions.length === 0 ? (
        <div className="card">
          <h2>Transaksi (0)</h2>
          <p className="muted">Belum ada transaksi POI Accommodation/TTD.</p>
        </div>
      ) : (
        <PoiList transactions={transactions} opsNames={OPS_NAMES} />
      )}
    </>
  );
}
