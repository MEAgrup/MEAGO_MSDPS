import { redirect, notFound } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import {
  CampaignDetail,
  type CampaignDetailRow,
  type BudgetLogRow,
  type AdsSpendRow,
  type ParticipantRow,
  type VideoSubmissionRow,
  type LiveSubmissionRow,
} from "./detail";

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

  const canCurate = mgmt || ["BizDev", "CampaignSpecialist", "Account"].includes(div);

  const supabase = await getCachedClient();
  const [{ data: deal }, { data: budgetLogRaw }, { data: adsSpendRaw }, { data: emps }, { data: participantsRaw }] =
    await Promise.all([
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
      supabase
        .from("campaign_participants")
        .select("id, code, mcn_creator_id, status, rejection_reason, reviewed_by, reviewed_at, created_at")
        .eq("deal_id", id)
        .order("created_at", { ascending: false }),
    ]);

  if (!deal) notFound();

  const nameById: Record<string, string> = Object.fromEntries(
    ((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name])
  );

  const participants = (participantsRaw as ParticipantRow[] | null) ?? [];
  const creatorIds = [...new Set(participants.map((p) => p.mcn_creator_id))];
  const participantIds = participants.map((p) => p.id);

  const [{ data: creatorsRaw }, { data: videoRaw }, { data: liveRaw }] = await Promise.all([
    creatorIds.length
      ? supabase.from("mcn_creators").select("id, name, username, code").in("id", creatorIds)
      : Promise.resolve({ data: [] as { id: string; name: string; username: string | null; code: string | null }[] }),
    participantIds.length
      ? supabase
          .from("campaign_video_submissions")
          .select("id, participant_id, post_url, post_id, is_duplicate, duplicate_of_id, submitted_at")
          .in("participant_id", participantIds)
          .order("submitted_at", { ascending: false })
      : Promise.resolve({ data: [] as VideoSubmissionRow[] }),
    participantIds.length
      ? supabase
          .from("campaign_live_submissions")
          .select("id, participant_id, live_date, duration_minutes, proof_url, submitted_at")
          .in("participant_id", participantIds)
          .order("submitted_at", { ascending: false })
      : Promise.resolve({ data: [] as LiveSubmissionRow[] }),
  ]);

  const creatorById: Record<string, { name: string; username: string | null; code: string | null }> =
    Object.fromEntries(
      (creatorsRaw ?? []).map((c) => [c.id, { name: c.name, username: c.username, code: c.code }])
    );

  return (
    <CampaignDetail
      deal={deal as unknown as CampaignDetailRow}
      budgetLog={(budgetLogRaw as BudgetLogRow[] | null) ?? []}
      adsSpend={(adsSpendRaw as AdsSpendRow[] | null) ?? []}
      participants={participants}
      videoSubmissions={(videoRaw as VideoSubmissionRow[] | null) ?? []}
      liveSubmissions={(liveRaw as LiveSubmissionRow[] | null) ?? []}
      creatorById={creatorById}
      nameById={nameById}
      me={me ? { rank: me.rank, is_od: !!me.is_od, is_director: !!me.is_director } : null}
      canManageBudgetStage={canManageBudgetStage}
      canCurate={canCurate}
    />
  );
}
