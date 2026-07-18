import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { rupiah } from "@/lib/format";
import { projectBadge, todayJakartaYMD } from "@/lib/mcn/project-status";
import { campaignRoutingNext, type CampaignRoutingState } from "@/lib/mcn/routing";
import { requestTypeLabel } from "@/lib/mcn/request-types";
import {
  ShopLeadForm,
  CampaignRequestForm,
  CmConfirmButtons,
  BrandAccButtons,
  FinalizeButtons,
  HandoverButton,
  PipelineStageSelect,
  PIPELINE_STAGES,
  RequestProgressControls,
} from "./forms";

type CreatorRequest = {
  id: string;
  code: string | null;
  mcn_creator_id: string;
  type: string;
  status: string;
  needs_approval: boolean;
  approved_by: string | null;
  approved_at: string | null;
  target_brand: string | null;
  target_merchant_id: string | null;
  nominal: number | null;
  detail: string | null;
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
  status: string;
  start_date: string;
  creators_cm: number;
  creators_acquisition: number;
  creators_needed: number;
  actual_gmv: number;
  target_gmv: number | null;
  pct_gmv: number | null;
};

export default async function BizDevPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || div === "BizDev";
  if (!canView) redirect("/dashboard");

  const supabase = await getCachedClient();

  // Stage 1: semua query yang saling independen di-fetch paralel (satu round-trip).
  const [
    { data: reqRaw },
    { data: dealsRaw },
    { data: crRaw },
    { data: creatorsRaw },
    { data: emps },
    { data: shopsRaw },
    { data: projRaw },
  ] = await Promise.all([
    supabase
      .from("creator_requests")
      .select(
        "id, code, mcn_creator_id, type, status, needs_approval, approved_by, approved_at, target_brand, target_merchant_id, nominal, detail"
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("brand_deals")
      .select("id, code, brand_name, shop_id, pipeline_stage, status")
      .order("created_at", { ascending: false }),
    supabase
      .from("campaign_requests")
      .select(
        "id, code, deal_id, mcn_creator_id, owner_cpm_id, cm_confirm_status, needs_brand_acc, brand_acc_status, final_status, handover_done"
      )
      .order("created_at", { ascending: false }),
    supabase.from("mcn_creators").select("id, name, code").order("name", { ascending: true }),
    supabase.from("employees").select("id, full_name"),
    supabase.from("cooperating_shops").select("shop_id, shop_name"),
    // (f) Special Project (read-only): semua kecuali cancelled — yang belum mulai
    // tampil [Persiapan] (QA 2026-07-17).
    supabase
      .from("v_project_summary")
      .select(
        "id, code, name, status, start_date, creators_cm, creators_acquisition, creators_needed, actual_gmv, target_gmv, pct_gmv"
      )
      .neq("status", "cancelled")
      .order("start_date", { ascending: false }),
  ]);

  const requests = (reqRaw as CreatorRequest[] | null) ?? [];

  const deals = (dealsRaw as Deal[] | null) ?? [];
  const runningDeals = deals.filter((d) => d.status === "running");

  const campaignRequests = (crRaw as CampaignRequest[] | null) ?? [];

  const creators = (creatorsRaw as { id: string; name: string; code: string | null }[] | null) ?? [];
  const creatorName = new Map(creators.map((c) => [c.id, `${c.code ?? "—"} · ${c.name}`]));

  const empName = new Map(((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name]));

  const dealBrand = new Map(deals.map((d) => [d.id, `${d.code ?? "—"} · ${d.brand_name}`]));

  const shops = (shopsRaw as { shop_id: string; shop_name: string | null }[] | null) ?? [];
  const shopIds = shops.map((s) => s.shop_id);

  const projects = (projRaw as ProjectSummary[] | null) ?? [];
  const todayYMD = todayJakartaYMD();

  // Stage 2: query turunan (bergantung hasil di atas) — nama merchant target
  // (bergantung requests) & GMV top products (bergantung shopIds) saling independen.
  // Nama merchant target (free_meal/visit) — fallback ke target_brand teks bebas
  // bila belum terdaftar di master M4. BizDev punya akses select merchants (0102).
  const targetMerchantIds = Array.from(
    new Set(requests.map((r) => r.target_merchant_id).filter((id): id is string => !!id))
  );
  const [merchRes, topRes] = await Promise.all([
    targetMerchantIds.length > 0
      ? supabase.from("merchants").select("id, nama_toko").in("id", targetMerchantIds)
      : Promise.resolve({ data: [] as { id: string; nama_toko: string }[] }),
    shopIds.length > 0
      ? supabase.from("creator_top_products").select("shop_id, gmv").in("shop_id", shopIds)
      : Promise.resolve({ data: [] as { shop_id: string | null; gmv: number | null }[] }),
  ]);

  const merchantName = new Map(
    ((merchRes.data as { id: string; nama_toko: string }[] | null) ?? []).map((m) => [m.id, m.nama_toko])
  );

  // (e) Brand report ringkas: Σ GMV per shop ber-deal (creator_top_products join cooperating_shops).
  const gmvByShop = new Map<string, number>();
  for (const r of (topRes.data as { shop_id: string | null; gmv: number | null }[] | null) ?? []) {
    if (!r.shop_id) continue;
    gmvByShop.set(r.shop_id, (gmvByShop.get(r.shop_id) ?? 0) + Number(r.gmv ?? 0));
  }
  const brandReport = shops
    .map((s) => ({ shop_id: s.shop_id, shop_name: s.shop_name, gmv: gmvByShop.get(s.shop_id) ?? 0 }))
    .sort((a, b) => b.gmv - a.gmv);

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
        <h2>Request Portal Kreator ({requests.length})</h2>
        <p className="section-sub">
          Antrian request kreator (form CM lama sample/ads/hsl + 4 jenis portal MEA GO). Progress
          status di sini; transisi diajukan→diproses ditolak DB bila butuh approval Director yang
          belum diberikan.
        </p>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Kreator</th>
              <th>Jenis</th>
              <th>Target Merchant</th>
              <th className="right">Nominal</th>
              <th>Detail</th>
              <th>Status</th>
              <th>Approval</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const target = r.target_merchant_id
                ? merchantName.get(r.target_merchant_id) ?? "—"
                : r.target_brand ?? "—";
              return (
                <tr key={r.id}>
                  <td className="mono">{r.code ?? "—"}</td>
                  <td>{creatorName.get(r.mcn_creator_id) ?? "—"}</td>
                  <td className="muted">{requestTypeLabel(r.type)}</td>
                  <td className="muted">{target}</td>
                  <td className="right">{r.nominal !== null ? rupiah(r.nominal) : "—"}</td>
                  <td className="muted">{r.detail ?? "—"}</td>
                  <td>
                    <span className="badge slate">{r.status}</span>
                  </td>
                  <td>
                    {r.needs_approval && r.approved_at === null && r.status === "diajukan" ? (
                      <span className="badge amber">Menunggu approval Director</span>
                    ) : r.needs_approval && r.approved_at ? (
                      <span className="badge green">disetujui</span>
                    ) : !r.needs_approval ? (
                      <span className="muted">tidak perlu</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <RequestProgressControls id={r.id} status={r.status} />
                  </td>
                </tr>
              );
            })}
            {requests.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
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
        <h2>Special Project</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Status</th>
              <th>Kreator (cm/akuisisi/butuh)</th>
              <th className="right">GMV Aktual / Target</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const b = projectBadge(p.status, p.start_date, todayYMD);
              return (
              <tr key={p.id}>
                <td className="mono">{p.code ?? "—"}</td>
                <td>{p.name}</td>
                <td>
                  <span className={`badge ${b.cls}`}>{b.label}</span>
                </td>
                <td className="muted">
                  {p.creators_cm}/{p.creators_acquisition}/{p.creators_needed}
                </td>
                <td className="right">
                  {rupiah(p.actual_gmv)} / {rupiah(p.target_gmv)}
                  {p.pct_gmv !== null && <div style={{ fontSize: 11, color: "#64748b" }}>{p.pct_gmv}%</div>}
                </td>
              </tr>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Belum ada special project.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
