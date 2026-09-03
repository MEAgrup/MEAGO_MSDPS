import { redirect, notFound } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { CampaignDetail, type CampaignDetailRow, type BudgetLogRow, type AdsSpendRow } from "./detail";

const CAMPAIGN_COLUMNS =
  "id, code, brand_name, funding_source, campaign_track, campaign_mode, operational_team, " +
  "operational_owner_id, campaign_stage, stage_changed_at, base_fee, creator_quota, creator_budget, " +
  "ads_budget_planned, allocated_amount, over_budget, over_budget_reason, target_location_id, " +
  "target_gmv, target_views, post_window_start, post_window_end, submission_deadline, brief, " +
  "has_free_meal, eligible_industries, eligible_cities, eligible_levels, eligible_creator_types, " +
  "eligible_roster_status, eligible_status_kontrak, min_gmv, min_gmv_metric, min_gmv_period_days, created_at";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || ["BizDev", "CampaignSpecialist", "Account"].includes(div);
  if (!canView) redirect("/dashboard");

  const canManageBudgetStage = mgmt || div === "BizDev" || div === "CampaignSpecialist";

  const supabase = await getCachedClient();
  const [{ data: deal }, { data: budgetLogRaw }, { data: adsSpendRaw }, { data: emps }] = await Promise.all([
    supabase.from("brand_deals").select(CAMPAIGN_COLUMNS).eq("id", id).eq("campaign_enabled", true).maybeSingle(),
    supabase
      .from("campaign_budget_log")
      .select("id, creator_budget, base_fee, creator_quota, allocated_amount, over_budget, over_budget_reason, actor, created_at")
      .eq("deal_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("campaign_ads_spend")
      .select("id, spend_date, amount, note, entered_by, created_at")
      .eq("deal_id", id)
      .order("spend_date", { ascending: false }),
    supabase.from("employees").select("id, full_name"),
  ]);

  if (!deal) notFound();

  const nameById: Record<string, string> = Object.fromEntries(
    ((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name])
  );

  return (
    <CampaignDetail
      deal={deal as unknown as CampaignDetailRow}
      budgetLog={(budgetLogRaw as BudgetLogRow[] | null) ?? []}
      adsSpend={(adsSpendRaw as AdsSpendRow[] | null) ?? []}
      nameById={nameById}
      me={me ? { rank: me.rank, is_od: !!me.is_od, is_director: !!me.is_director } : null}
      canManageBudgetStage={canManageBudgetStage}
    />
  );
}
