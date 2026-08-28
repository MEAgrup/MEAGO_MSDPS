import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { NewLeadForm, ImportCsvForm, AttemptControls } from "./forms";
import { PoolLeadSection, type PoolLead } from "./pool";
import { BRAND_CATEGORIES, type BrandCategory } from "@/lib/leads/intake";
import type { BusinessTypeOptions } from "./intake-fields";

const POOL_LEAD_COLUMNS =
  "id, code, lead_name, brand_name, bd_employee_id, brand_category, business_type, wilayah, " +
  "source, pic_name_position, pic_phone, web_socmed_link, phone_normalized, status, stale, " +
  "crm_status, benefit_dealing, nominal_bayar, tanggal_mulai_kontrak, tanggal_akhir_kontrak, created_at";

type Attempt = {
  id: string;
  code: string | null;
  parent_lead_id: string;
  owner_id: string;
  status: string;
  won: boolean;
  not_qualified_reason: string | null;
};

const ATTEMPT_STATUS_CLASS: Record<string, string> = {
  "[Pending Validation]": "slate",
  "[New Lead]": "slate",
  "[Contacted]": "blue",
  "[Qualified]": "blue",
  "[Negotiation]": "amber",
  "[Closed - Success]": "green",
  "[Closed - Lost]": "red",
  "[Closed - Kalah Kompetisi]": "red",
  "[Not Qualified]": "amber",
};

export default async function LeadsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const isBizDev = me?.division === "BizDev";
  const canManage = isBizDev || me?.division === "Marketing" || !!me?.is_director;
  const canControl = (ownerId: string) =>
    ownerId === me?.id || (isBizDev && me?.rank === "lead") || !!me?.is_director;

  const supabase = await getCachedClient();

  const [{ data: leads }, { data: attempts }, { data: emps }, { data: campaigns }, { data: businessTypes }, { data: benefits }] =
    await Promise.all([
      supabase.from("leads").select(POOL_LEAD_COLUMNS).order("created_at", { ascending: false }),
      supabase
        .from("prospect_attempts")
        .select("id, code, parent_lead_id, owner_id, status, won, not_qualified_reason")
        .order("created_at", { ascending: false }),
      supabase.from("employees").select("id, full_name, division, active"),
      supabase
        .from("campaigns")
        .select("id, code, campaign_name")
        .order("created_at", { ascending: false }),
      supabase.from("lead_business_types").select("brand_category, label").order("label"),
      supabase.from("lead_benefit_options").select("label").order("label"),
    ]);

  const bdNameById: Record<string, string> = Object.fromEntries(
    (emps ?? []).map((e) => [e.id, e.full_name])
  );
  // Dropdown "Nama BD" pada form intake = karyawan BizDev yang masih aktif.
  const bdOptions = (emps ?? [])
    .filter((e) => e.division === "BizDev" && e.active !== false)
    .map((e) => ({ id: e.id, full_name: e.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const businessTypeOptions: BusinessTypeOptions = Object.fromEntries(
    BRAND_CATEGORIES.map((c) => [c, [] as string[]])
  ) as BusinessTypeOptions;
  for (const row of businessTypes ?? []) {
    const cat = row.brand_category as BrandCategory;
    if (businessTypeOptions[cat]) businessTypeOptions[cat].push(row.label);
  }
  const benefitOptions = (benefits ?? []).map((b) => b.label);

  const leadList = (leads as PoolLead[] | null) ?? [];
  const attList = (attempts as Attempt[] | null) ?? [];
  const attByLead = new Map<string, Attempt[]>();
  for (const a of attList) {
    const arr = attByLead.get(a.parent_lead_id) ?? [];
    arr.push(a);
    attByLead.set(a.parent_lead_id, arr);
  }

  const poolCount = leadList.filter((l) => l.status === "[Pool]").length;
  const myOpen = attList.filter(
    (a) => a.owner_id === me?.id && a.status.startsWith("[") && !a.status.startsWith("[Closed")
  ).length;
  const contested = [...attByLead.values()].filter((arr) => arr.length > 1).length;

  return (
    <>
      <h1>Leads &amp; Prospek</h1>
      <p className="page-sub">
        Pool lead dedup by nomor (E.164). Prospek = salinan kerja BizDev; yang pertama closing
        menang, sisanya otomatis [Closed - Kalah Kompetisi].
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Lead</div>
          <div className="v">{leadList.length}</div>
        </div>
        <div className="stat">
          <div className="k">Di Pool</div>
          <div className="v">{poolCount}</div>
        </div>
        <div className="stat">
          <div className="k">Prospek Saya (aktif)</div>
          <div className="v">{myOpen}</div>
        </div>
        <div className="stat">
          <div className="k">Diperebutkan</div>
          <div className="v">{contested}</div>
        </div>
      </div>

      <PoolLeadSection
        leads={leadList}
        bdOptions={bdOptions}
        bdNameById={bdNameById}
        businessTypeOptions={businessTypeOptions}
        benefitOptions={benefitOptions}
        isBizDev={isBizDev}
        canManage={canManage}
      />

      <div className="card">
        <h2>Papan Kompetisi Prospek</h2>
        <p className="section-sub">
          Setiap prospek yang Anda lihat sesuai hak akses. Closing dilakukan di menu Merchant
          (memanggil close_deal).
        </p>
        <table>
          <thead>
            <tr>
              <th>Prospek</th>
              <th>Lead</th>
              <th>Owner (BizDev)</th>
              <th>Status</th>
              <th>Lanjutkan</th>
            </tr>
          </thead>
          <tbody>
            {attList.map((a) => {
              const lead = leadList.find((l) => l.id === a.parent_lead_id);
              return (
                <tr key={a.id}>
                  <td className="mono">{a.code ?? "(pending)"}</td>
                  <td>
                    <span className="mono">{lead?.code ?? "—"}</span>{" "}
                    {lead?.brand_name ?? lead?.lead_name ?? "?"}
                  </td>
                  <td>{bdNameById[a.owner_id] ?? "—"}</td>
                  <td>
                    <span className={`badge ${ATTEMPT_STATUS_CLASS[a.status] ?? "gray"}`}>
                      {a.status}
                    </span>
                    {a.not_qualified_reason && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {a.not_qualified_reason}
                      </div>
                    )}
                  </td>
                  <td>
                    {canControl(a.owner_id) ? (
                      <AttemptControls id={a.id} status={a.status} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {attList.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Belum ada prospek. BizDev dapat mengambil lead dari pool di atas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <>
          <div className="card">
            <h2>Daftarkan Lead</h2>
            <NewLeadForm bdOptions={bdOptions} businessTypeOptions={businessTypeOptions} />
          </div>
          <div className="card">
            <details className="disclose">
              <summary>Impor Massal (CSV)</summary>
              <ImportCsvForm campaigns={campaigns ?? []} />
            </details>
          </div>
        </>
      )}
    </>
  );
}
