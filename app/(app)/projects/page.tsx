import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rupiah, tanggal } from "@/lib/format";
import {
  CreateProjectForm,
  ProjectStatusControls,
  AddMerchantForm,
  RemoveMerchantButton,
  AssignCreatorForm,
  UnassignCreatorButton,
} from "./forms";

type ProjectSummary = {
  id: string;
  code: string | null;
  name: string;
  industry_category: string;
  start_date: string;
  end_date: string;
  ads_budget: number | null;
  target_gmv: number | null;
  creators_needed: number;
  status: string;
  creators_assigned: number;
  creators_cm: number;
  creators_acquisition: number;
  merchant_count: number;
  actual_gmv: number;
  pct_gmv: number | null;
};

const STATUS_CLASS: Record<string, string> = {
  draft: "slate",
  active: "green",
  done: "gray",
  cancelled: "red",
};

export default async function ProjectsPage() {
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
  const isLead = me?.rank === "lead";
  const canView = mgmt || ["CreatorManagement", "BizDev", "Acquisition", "Account"].includes(div);
  if (!canView) redirect("/dashboard");

  const canCreate = mgmt || isLead;
  const canManageStatus = canCreate;
  const canManageAssignment = mgmt || div === "CreatorManagement" || div === "Acquisition";
  const canManageMerchant = mgmt || isLead || ["CreatorManagement", "BizDev", "Acquisition"].includes(div);

  const { data: projRaw } = await supabase
    .from("v_project_summary")
    .select(
      "id, code, name, industry_category, start_date, end_date, ads_budget, target_gmv, creators_needed, status, creators_assigned, creators_cm, creators_acquisition, merchant_count, actual_gmv, pct_gmv"
    )
    .order("start_date", { ascending: false });
  const projects = (projRaw as ProjectSummary[] | null) ?? [];

  const { data: merchantsRaw } = await supabase
    .from("merchants")
    .select("id, code, nama_toko")
    .order("nama_toko", { ascending: true });
  const merchants = (merchantsRaw as { id: string; code: string | null; nama_toko: string }[] | null) ?? [];

  const { data: creatorsRaw } = await supabase
    .from("mcn_creators")
    .select("id, name, code")
    .order("name", { ascending: true });
  const creators = (creatorsRaw as { id: string; name: string; code: string | null }[] | null) ?? [];

  const projectIds = projects.map((p) => p.id);
  const { data: pmRaw } =
    projectIds.length > 0
      ? await supabase
          .from("special_project_merchants")
          .select("id, project_id, merchant_id")
          .in("project_id", projectIds)
      : { data: [] };
  const projMerchants = (pmRaw as { id: string; project_id: string; merchant_id: string }[] | null) ?? [];

  const { data: pcRaw } =
    projectIds.length > 0
      ? await supabase
          .from("special_project_creators")
          .select("id, project_id, mcn_creator_id, filled_by")
          .in("project_id", projectIds)
      : { data: [] };
  const projCreators =
    (pcRaw as { id: string; project_id: string; mcn_creator_id: string; filled_by: string }[] | null) ?? [];

  const merchantName = new Map(merchants.map((m) => [m.id, `${m.code ?? "—"} · ${m.nama_toko}`]));
  const creatorName = new Map(creators.map((c) => [c.id, `${c.code ?? "—"} · ${c.name}`]));

  return (
    <>
      <h1>Special Project &amp; Campaign</h1>
      <p className="page-sub">
        Lead/OD/Director mendaftarkan project dengan target kreator &amp; GMV. Kreator di-assign
        oleh CM (roster internal) dan Akuisisi (kreator baru); GMV aktual dihitung otomatis dari
        ingest mingguan.
      </p>

      {canCreate && (
        <div className="card">
          <h2>Buat Project Baru</h2>
          <CreateProjectForm />
        </div>
      )}

      <div className="card">
        <h2>Daftar Project ({projects.length})</h2>
        {projects.map((p) => {
          const pMerchants = projMerchants.filter((m) => m.project_id === p.id);
          const pCreators = projCreators.filter((c) => c.project_id === p.id);
          return (
            <div key={p.id} className="subcard" style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <strong>
                    {p.code ?? "—"} · {p.name}
                  </strong>{" "}
                  <span className={`badge ${STATUS_CLASS[p.status] ?? "gray"}`}>{p.status}</span>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {p.industry_category} · {tanggal(p.start_date)} – {tanggal(p.end_date)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div>
                    Kreator: {p.creators_assigned}/{p.creators_needed} (cm {p.creators_cm} · akuisisi{" "}
                    {p.creators_acquisition})
                  </div>
                  <div>
                    GMV: {rupiah(p.actual_gmv)} / {rupiah(p.target_gmv)}{" "}
                    {p.pct_gmv !== null && <span className="badge indigo">{p.pct_gmv}%</span>}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    Merchant: {p.merchant_count} · Ads Budget: {rupiah(p.ads_budget)}
                  </div>
                </div>
              </div>

              {canManageStatus && (
                <div style={{ marginTop: 8 }}>
                  <ProjectStatusControls id={p.id} status={p.status} />
                </div>
              )}

              <details style={{ marginTop: 10 }}>
                <summary>Kelola merchant &amp; kreator</summary>

                <div style={{ marginTop: 8 }}>
                  <h3 style={{ fontSize: 13 }}>Merchant Peserta ({pMerchants.length})</h3>
                  <ul style={{ paddingLeft: 18, margin: "6px 0" }}>
                    {pMerchants.map((m) => (
                      <li key={m.id} style={{ marginBottom: 4 }}>
                        {merchantName.get(m.merchant_id) ?? "—"}{" "}
                        {canManageMerchant && <RemoveMerchantButton id={m.id} />}
                      </li>
                    ))}
                    {pMerchants.length === 0 && <li className="muted">Belum ada merchant.</li>}
                  </ul>
                  {canManageMerchant && <AddMerchantForm projectId={p.id} merchants={merchants} />}
                </div>

                <div style={{ marginTop: 14 }}>
                  <h3 style={{ fontSize: 13 }}>Kreator Ter-assign ({pCreators.length})</h3>
                  <ul style={{ paddingLeft: 18, margin: "6px 0" }}>
                    {pCreators.map((c) => (
                      <li key={c.id} style={{ marginBottom: 4 }}>
                        {creatorName.get(c.mcn_creator_id) ?? "—"}{" "}
                        <span className="badge slate">{c.filled_by}</span>{" "}
                        {canManageAssignment && <UnassignCreatorButton id={c.id} />}
                      </li>
                    ))}
                    {pCreators.length === 0 && <li className="muted">Belum ada kreator ter-assign.</li>}
                  </ul>
                  {canManageAssignment && (
                    <AssignCreatorForm projectId={p.id} creators={creators} showFilledBy={mgmt} />
                  )}
                </div>
              </details>
            </div>
          );
        })}
        {projects.length === 0 && <p className="muted">Belum ada project terdaftar.</p>}
      </div>
    </>
  );
}
