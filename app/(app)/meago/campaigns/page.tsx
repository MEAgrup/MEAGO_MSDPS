import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { isCampaignOwner, isCampaignStaff } from "@/lib/campaign-access";
import { CampaignsToolbar, CampaignIngestForm } from "./forms";
import { CampaignsTable, type CampaignRow } from "./table";

const CAMPAIGN_COLUMNS =
  "id, code, brand_name, funding_source, campaign_track, campaign_mode, operational_team, " +
  "operational_owner_id, campaign_stage, base_fee, creator_quota, creator_budget, " +
  "ads_budget_planned, allocated_amount, over_budget, target_location_id, created_at";

export default async function CampaignsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  if (!isCampaignStaff(me)) redirect("/dashboard");

  const canCreate = isCampaignOwner(me);

  const supabase = await getCachedClient();
  const [{ data: campaignsRaw }, { data: emps }] = await Promise.all([
    supabase
      .from("brand_deals")
      .select(CAMPAIGN_COLUMNS)
      .eq("campaign_enabled", true)
      .order("created_at", { ascending: false }),
    supabase.from("employees").select("id, full_name, division, active"),
  ]);

  const campaigns = (campaignsRaw as CampaignRow[] | null) ?? [];
  const employees =
    (emps as { id: string; full_name: string; division: string; active: boolean | null }[] | null) ?? [];
  const nameById: Record<string, string> = Object.fromEntries(employees.map((e) => [e.id, e.full_name]));
  const amOptions = employees
    .filter((e) => e.division === "Account" && e.active !== false)
    .map((e) => ({ id: e.id, full_name: e.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const totalCampaigns = campaigns.length;
  const activeCampaigns = campaigns.filter((c) => c.campaign_stage === "active").length;
  const overBudgetCampaigns = campaigns.filter((c) => c.over_budget).length;
  const totalCreatorBudget = campaigns.reduce((sum, c) => sum + (c.creator_budget ?? 0), 0);

  return (
    <>
      <h1>Campaign MEA GO</h1>
      <p className="page-sub">
        Campaign kreator MEA GO: funding source, budget guard, pendaftaran &amp; kurasi kreator,
        bukti deliverable, payout, dan validasi hasil dari export TikTok.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Campaign</div>
          <div className="v">{totalCampaigns}</div>
        </div>
        <div className="stat">
          <div className="k">Aktif</div>
          <div className="v">{activeCampaigns}</div>
        </div>
        <div className="stat">
          <div className="k">Over Budget</div>
          <div className="v small">{overBudgetCampaigns}</div>
        </div>
        <div className="stat">
          <div className="k">Total Creator Budget</div>
          <div className="v small">{totalCreatorBudget.toLocaleString("id-ID")}</div>
        </div>
      </div>

      {canCreate && <CampaignsToolbar amOptions={amOptions} />}

      <div className="card">
        <h2>Daftar Campaign</h2>
        <CampaignsTable campaigns={campaigns} nameById={nameById} />
      </div>

      {canCreate && (
        <div className="card">
          <h2>Ingest Export TikTok</h2>
          <p className="hint">
            Upload export "Content Analysis › Video List" untuk mengisi index post global (dipakai
            validasi bukti per campaign di halaman detail).
          </p>
          <CampaignIngestForm />
        </div>
      )}
    </>
  );
}
