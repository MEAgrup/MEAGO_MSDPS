import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { OPS_NAMES } from "@/lib/deals/intake";
import { type PoiTransaction } from "../poi/poi-card";
import { type DiningBerbayarCycle } from "./dining-berbayar-card";
import { DiningList, type DiningCard } from "./dining-list";

type DealRow = {
  id: string;
  code: string | null;
  brand_name: string;
  pic_name: string | null;
  bd_id: string | null;
  ops_name: string | null;
  bentuk_kerjasama: string | null;
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

type CycleRow = {
  id: string;
  deal_id: string;
  cycle_no: number;
  period_start: string;
  period_end: string;
  ops_datetime: string | null;
  actual_vt: number | null;
  total_gmv: number | null;
  report_link: string | null;
  report_status: string | null;
};

type DiningStepDbRow = { cycle_id: string; step_no: number; completed_at: string | null; skipped_at: string | null };

export default async function PoiDiningPage() {
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
      .select(
        "id, code, brand_name, pic_name, bd_id, ops_name, bentuk_kerjasama, visit_start_date, visit_start_time"
      )
      .eq("kategori_poi", "Dining")
      .order("visit_start_date", { ascending: false }),
    supabase.from("employees").select("id, full_name"),
  ]);

  const deals = (dealsRaw as DealRow[] | null) ?? [];
  const bdNameById = new Map(((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name]));

  const freeBarterDeals = deals.filter((d) => d.bentuk_kerjasama === "Free/Barter");
  const berbayarDeals = deals.filter((d) => d.bentuk_kerjasama === "Berbayar");

  // ---- Free/Barter: poi_sop_progress/poi_sop_steps (dipakai bersama tab POI Accommodation & TTD) ----
  const fbDealIds = freeBarterDeals.map((d) => d.id);
  const [{ data: progressRaw }] = await Promise.all([
    fbDealIds.length > 0
      ? supabase
          .from("poi_sop_progress")
          .select("id, deal_id, ops_datetime, actual_vt, total_gmv, report_link, report_status")
          .in("deal_id", fbDealIds)
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

  const freeBarterTransactions: PoiTransaction[] = freeBarterDeals
    .map((d): PoiTransaction | null => {
      const progress = progressByDeal.get(d.id);
      if (!progress) return null; // trigger DB belum sempat provisi — sembunyikan drpd error.
      return {
        deal_id: d.id,
        code: d.code,
        brand_name: d.brand_name,
        pic_name: d.pic_name,
        kategori_poi: "Dining",
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

  // ---- Berbayar: poi_dining_cycles/poi_dining_steps (satu siklus = satu bulan kontrak) ----
  const bbDealIds = berbayarDeals.map((d) => d.id);
  const { data: cyclesRaw } =
    bbDealIds.length > 0
      ? await supabase
          .from("poi_dining_cycles")
          .select("id, deal_id, cycle_no, period_start, period_end, ops_datetime, actual_vt, total_gmv, report_link, report_status")
          .in("deal_id", bbDealIds)
          .order("cycle_no", { ascending: true })
      : { data: [] as CycleRow[] };
  const cycles = (cyclesRaw as CycleRow[] | null) ?? [];
  const cycleIds = cycles.map((c) => c.id);

  const { data: dininStepsRaw } =
    cycleIds.length > 0
      ? await supabase
          .from("poi_dining_steps")
          .select("cycle_id, step_no, completed_at, skipped_at")
          .in("cycle_id", cycleIds)
      : { data: [] as DiningStepDbRow[] };
  const diningStepsByCycle = new Map<string, DiningStepDbRow[]>();
  for (const s of (dininStepsRaw as DiningStepDbRow[] | null) ?? []) {
    const list = diningStepsByCycle.get(s.cycle_id) ?? [];
    list.push(s);
    diningStepsByCycle.set(s.cycle_id, list);
  }

  const dealById = new Map(berbayarDeals.map((d) => [d.id, d]));
  const berbayarCycles: DiningBerbayarCycle[] = cycles
    .map((c): DiningBerbayarCycle | null => {
      const deal = dealById.get(c.deal_id);
      if (!deal) return null; // trigger DB belum sempat provisi step — sembunyikan drpd error.
      const steps = diningStepsByCycle.get(c.id) ?? [];
      if (steps.length === 0) return null;
      return {
        deal_id: deal.id,
        code: deal.code,
        brand_name: deal.brand_name,
        pic_name: deal.pic_name,
        bd_name: (deal.bd_id && bdNameById.get(deal.bd_id)) ?? "—",
        ops_name: deal.ops_name,
        cycle_id: c.id,
        cycle_no: c.cycle_no,
        period_start: c.period_start,
        period_end: c.period_end,
        ops_datetime: c.ops_datetime,
        actual_vt: c.actual_vt,
        total_gmv: c.total_gmv,
        report_link: c.report_link,
        report_status: c.report_status,
        steps: steps.sort((a, b) => a.step_no - b.step_no),
      };
    })
    .filter((c): c is DiningBerbayarCycle => c !== null);

  const cards: DiningCard[] = [
    ...freeBarterTransactions.map((tx): DiningCard => ({ kind: "freebarter", tx })),
    ...berbayarCycles.map((cycle): DiningCard => ({ kind: "berbayar", cycle })),
  ];

  const canApproveSkip = !!me?.is_director;

  return (
    <>
      <h1>POI Dining</h1>
      <p className="page-sub">
        Tracker SOP kreator dining — flow <strong>Free/Barter</strong> (17 step, sekali jalan, seperti tab POI
        Accommodation &amp; TTD) dan flow <strong>Berbayar</strong> (22 step per siklus bulanan durasi kontrak, dengan
        5 step MOU/Invoice opsional di awal).
      </p>

      {cards.length === 0 ? (
        <div className="card">
          <h2>Transaksi (0)</h2>
          <p className="muted">Belum ada transaksi POI Dining.</p>
        </div>
      ) : (
        <DiningList cards={cards} opsNames={OPS_NAMES} canApproveSkip={canApproveSkip} />
      )}
    </>
  );
}
