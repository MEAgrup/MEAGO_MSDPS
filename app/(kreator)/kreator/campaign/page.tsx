import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getCreator } from "@/lib/supabase/server";
import { CampaignList, type PortalCampaignRow } from "./list";

const PORTAL_CAMPAIGN_COLUMNS =
  "id, code, brand_name, campaign_track, campaign_mode, base_fee, creator_quota, " +
  "target_location_id, post_window_start, post_window_end, submission_deadline, brief, " +
  "has_free_meal, target_gmv, target_views, created_at, approved_count, my_participant_id, my_status";

export default async function KreatorCampaignPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const creator = await getCreator();
  if (!creator) redirect("/dashboard");

  const supabase = await getCachedClient();
  const { data: campaignsRaw } = await supabase
    .from("v_portal_campaigns")
    .select(PORTAL_CAMPAIGN_COLUMNS)
    .order("created_at", { ascending: false });

  const campaigns = (campaignsRaw as PortalCampaignRow[] | null) ?? [];

  return (
    <>
      <h1>Campaign</h1>
      <p className="page-sub">
        Campaign MEA GO yang layak untuk kamu daftar (sesuai industry, kota, level, jenis kreator,
        status kontrak, dan GMV). Kurasi dilakukan tim operasional setelah kamu mendaftar.
      </p>

      <div className="card">
        <h2>Campaign Tersedia ({campaigns.length})</h2>
        <CampaignList campaigns={campaigns} />
      </div>
    </>
  );
}
