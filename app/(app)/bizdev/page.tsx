import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rupiah } from "@/lib/format";
import { campaignRoutingNext, type CampaignRoutingState } from "@/lib/mcn/routing";
import {
  ShopLeadForm,
  CampaignRequestForm,
  CmConfirmButtons,
  BrandAccButtons,
  FinalizeButtons,
  HandoverButton,
  PipelineStageSelect,
  PIPELINE_STAGES,
} from "./forms";

type CreatorRequest = {
  id: string;
  code: string | null;
  mcn_creator_id: string;
  type: string;
  status: string;
  needs_approval: boolean;
  approved_by: string | null;
  target_brand: string | null;
};

type Deal = {
  id: string;
  code: string | null;
  brand_name: string;
  shop_id: string | null;
  pipeline_stage: string;
  status: string;
};

type CampaignRequest = {
  id: string;
  code: string | null;
  deal_id: string | null;
  mcn_creator_id: string | null;
  owner_cpm_id: string | null;
  cm_confirm_status: "menunggu" | "mau" | "tidak";
  needs_brand_acc: boolean;
  brand_acc_status: "n_a" | "menunggu" | "approved" | "ditolak";
  final_status: "proses" | "fix" | "batal";
  handover_done: boolean;
};

type ProjectSummary = {
  id: string;
  code: string | null;
  name: string;
  creators_cm: number;
  creators_acquisition: number;
  creators_needed: number;
  actual_gmv: number;
  target_gmv: number | null;
  pct_gmv: number | null;
};

export default async function BizDevPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("employees")
    .select("id, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || div === "BizDev";
  if (!canView) redirect("/dashboard");

  const { data: reqRaw } = await supabase
    .from("creator_requests")
    .select("id, code, mcn_creator_id, type, status, needs_approval, approved_by, target_brand")
    .order("created_at", { ascending: false });
  const requests = (reqRaw as CreatorRequest[] | null) ?? [];

  const { data: dealsRaw } = await supabase
    .from("brand_deals")
    .select("id, code, brand_name, shop_id, pipeline_stage, status")
    .order("created_at", { ascending: false });
  const deals = (dealsRaw as Deal[] | null) ?? [];
  const runningDeals = deals.filter((d) => d.status === "running");

  const { data: crRaw } = await supabase
    .from("campaign_requests")
    .select(
      "id, code, deal_id, mcn_creator_id, owner_cpm_id, cm_confirm_status, needs_brand_acc, brand_acc_status, final_status, handover_done"
    )
    .order("created_at", { ascending: false });
  const campaignRequests = (crRaw as CampaignRequest[] | null) ?? [];

  const { data: creatorsRaw } = await supabase
    .from("mcn_creators")
    .select("id, name, code")
    .order("name", { ascending: true });
  const creators = (creatorsRaw as { id: string; name: string; code: string | null }[] | null) ?? [];
  const creatorName = new Map(creators.map((c) => [c.id, `${c.code ?? "—"} · ${c.name}`]));

  const { data: emps } = await supabase.from("employees").select("id, full_name");
  const empName = new Map(((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name]));

  const dealBrand = new Map(deals.map((d) => [d.id, `${d.code ?? "—"} · ${d.brand_name}`]));

  // (e) Brand report ringkas: Σ GMV per shop ber-deal (creator_top_products join cooperating_shops).
  const { data: shopsRaw } = await supabase.from("cooperating_shops").select("shop_id, shop_name");
  const shops = (shopsRaw as { shop_id: string; shop_name: string | null }[] | null) ?? [];
  const shopIds = shops.map((s) => s.shop_id);
  const gmvByShop = new Map<string, number>();
  if (shopIds.length > 0) {
    const { data: topRaw } = await supabase
      .from("creator_top_products")
      .select("shop_id, gmv")
      .in("shop_id", shopIds);
    for (const r of (topRaw as { shop_id: string | null; gmv: number | null }[] | null) ?? []) {
      if (!r.shop_id) continue;
      gmvByShop.set(r.shop_id, (gmvByShop.get(r.shop_id) ?? 0) + Number(r.gmv ?? 0));
    }
  }
  const brandReport = shops
    .map((s) => ({ shop_id: s.shop_id, shop_name: s.shop_name, gmv: gmvByShop.get(s.shop_id) ?? 0 }))
    .sort((a, b) => b.gmv - a.gmv);

  // (f) Special Project aktif (read-only).
  const { data: projRaw } = await supabase
    .from("v_project_summary")
    .select("id, code, name, creators_cm, creators_acquisition, creators_needed, actual_gmv, target_gmv, pct_gmv")
    .eq("status", "active");
  const projects = (projRaw as ProjectSummary[] | null) ?? [];

  // Kolom pipeline: PIPELINE_STAGES + stage lain yang tak terdaftar.
  const knownStages = new Set(PIPELINE_STAGES);
  const extraStages = Array.from(new Set(deals.map((d) => d.pipeline_stage).filter((s) => !knownStages.has(s))));
  const stageColumns = [...PIPELINE_STAGES, ...extraStages];

  return (
    <>
      <h1>BizDev Workspace</h1>
      <p className="page-sub">
        Tracker request kreator lintas CM, pipeline deal, routing campaign, lead shop, dan ringkasan
        brand report.
      </p>

      <div className="card">
        <h2>Tracker Request Kreator ({requests.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Kreator</th>
              <th>Tipe</th>
              <th>Target Brand</th>
              <th>Status</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.code ?? "—"}</td>
                <td>{creatorName.get(r.mcn_creator_id) ?? "—"}</td>
                <td className="muted">{r.type}</td>
                <td className="muted">{r.target_brand ?? "—"}</td>
                <td>
                  <span className="badge slate">{r.status}</span>
                </td>
                <td>
                  {!r.needs_approval ? (
                    <span className="muted">tidak perlu</span>
                  ) : r.approved_by ? (
                    <span className="badge green">disetujui</span>
                  ) : (
                    <span className="badge amber">menunggu Director</span>
                  )}
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Belum ada request kreator.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Pipeline Deal</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                {stageColumns.map((s) => (
                  <th key={s}>{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {stageColumns.map((s) => (
                  <td key={s} style={{ verticalAlign: "top", minWidth: 160 }}>
                    {deals
                      .filter((d) => d.pipeline_stage === s)
                      .map((d) => (
                        <div key={d.id} className="subcard" style={{ marginBottom: 8, padding: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>{d.brand_name}</div>
                          <div className="muted" style={{ fontSize: 11 }}>
                            {d.code ?? "—"} · shop {d.shop_id ?? "—"}
                          </div>
                          <PipelineStageSelect dealId={d.id} current={d.pipeline_stage} />
                        </div>
                      ))}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Routing Campaign</h2>
        <CampaignRequestForm
          deals={runningDeals.map((d) => ({ id: d.id, code: d.code, brand_name: d.brand_name }))}
          creators={creators}
        />
        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Deal</th>
              <th>Kreator</th>
              <th>Owner CM</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {campaignRequests.map((cr) => {
              const state: CampaignRoutingState = {
                cm_confirm_status: cr.cm_confirm_status,
                needs_brand_acc: cr.needs_brand_acc,
                brand_acc_status: cr.brand_acc_status,
                final_status: cr.final_status,
                handover_done: cr.handover_done,
              };
              const canCmConfirm = campaignRoutingNext(state, "cm_mau").ok;
              const canBrandAcc = campaignRoutingNext(state, "brand_approve").ok;
              const canFinalize =
                campaignRoutingNext(state, "finalize_fix").ok || campaignRoutingNext(state, "finalize_batal").ok;
              const canHandover = campaignRoutingNext(state, "handover").ok;
              return (
                <tr key={cr.id}>
                  <td className="mono">{cr.code ?? "—"}</td>
                  <td className="muted">{cr.deal_id ? dealBrand.get(cr.deal_id) ?? "—" : "—"}</td>
                  <td>{cr.mcn_creator_id ? creatorName.get(cr.mcn_creator_id) ?? "—" : "—"}</td>
                  <td className="muted">{cr.owner_cpm_id ? empName.get(cr.owner_cpm_id) ?? "—" : "—"}</td>
                  <td>
                    <span className="badge slate">CM: {cr.cm_confirm_status}</span>{" "}
                    {cr.needs_brand_acc && <span className="badge slate">Brand: {cr.brand_acc_status}</span>}{" "}
                    <span className="badge slate">Final: {cr.final_status}</span>{" "}
                    {cr.handover_done && <span className="badge green">handover done</span>}
                  </td>
                  <td>
                    <CmConfirmButtons id={cr.id} can={canCmConfirm} />
                    <BrandAccButtons id={cr.id} can={canBrandAcc} />
                    <FinalizeButtons id={cr.id} can={canFinalize} />
                    <HandoverButton id={cr.id} can={canHandover} />
                  </td>
                </tr>
              );
            })}
            {campaignRequests.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Belum ada campaign request.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Lead Shop → Pool Leads</h2>
        <ShopLeadForm />
      </div>

      <div className="card">
        <h2>Brand Report Ringkas (GMV per shop ber-deal)</h2>
        <table>
          <thead>
            <tr>
              <th>Shop ID</th>
              <th>Nama Shop</th>
              <th className="right">GMV (top products)</th>
            </tr>
          </thead>
          <tbody>
            {brandReport.map((r) => (
              <tr key={r.shop_id}>
                <td className="mono">{r.shop_id}</td>
                <td>{r.shop_name ?? "—"}</td>
                <td className="right">{rupiah(r.gmv)}</td>
              </tr>
            ))}
            {brandReport.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  Belum ada shop ber-deal.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Special Project Aktif</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Kreator (cm/akuisisi/butuh)</th>
              <th className="right">GMV Aktual / Target</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.code ?? "—"}</td>
                <td>{p.name}</td>
                <td className="muted">
                  {p.creators_cm}/{p.creators_acquisition}/{p.creators_needed}
                </td>
                <td className="right">
                  {rupiah(p.actual_gmv)} / {rupiah(p.target_gmv)}
                  {p.pct_gmv !== null && <div style={{ fontSize: 11, color: "#64748b" }}>{p.pct_gmv}%</div>}
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Tidak ada special project aktif.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
