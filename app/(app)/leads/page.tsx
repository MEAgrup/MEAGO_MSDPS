import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { NewLeadForm, ImportCsvForm } from "./forms";
import { PoolLeadSection, type PoolLead } from "./pool";
import { BRAND_CATEGORIES, type BrandCategory } from "@/lib/leads/intake";
import type { BusinessTypeOptions } from "./intake-fields";

const POOL_LEAD_COLUMNS =
  "id, code, lead_name, brand_name, bd_employee_id, brand_category, business_type, wilayah, " +
  "source, pic_name_position, pic_phone, web_socmed_link, phone_normalized, status, stale, " +
  "crm_status, benefit_dealing, nominal_bayar, tanggal_mulai_kontrak, tanggal_akhir_kontrak, created_at";

export default async function LeadsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const isBizDev = me?.division === "BizDev";
  const canManage = isBizDev || me?.division === "Marketing" || !!me?.is_director;

  const supabase = await getCachedClient();

  const [{ data: leads }, { data: emps }, { data: businessTypes }, { data: benefits }] =
    await Promise.all([
      supabase.from("leads").select(POOL_LEAD_COLUMNS).order("created_at", { ascending: false }),
      supabase.from("employees").select("id, full_name, division, active"),
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
  const countByStatus = (status: string) => leadList.filter((l) => l.crm_status === status).length;

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
          <div className="k">Approaching</div>
          <div className="v">{countByStatus("Approaching")}</div>
        </div>
        <div className="stat">
          <div className="k">Follow Up</div>
          <div className="v">{countByStatus("Follow Up")}</div>
        </div>
        <div className="stat">
          <div className="k">Dealing</div>
          <div className="v">{countByStatus("Dealing")}</div>
        </div>
        <div className="stat">
          <div className="k">Renewal</div>
          <div className="v">{countByStatus("Renewal")}</div>
        </div>
        <div className="stat">
          <div className="k">Rejected</div>
          <div className="v">{countByStatus("Rejected")}</div>
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

      {canManage && (
        <>
          <div className="card">
            <h2>Daftarkan Lead</h2>
            <NewLeadForm bdOptions={bdOptions} businessTypeOptions={businessTypeOptions} />
          </div>
          <div className="card">
            <details className="disclose">
              <summary>Impor Massal (CSV)</summary>
              <ImportCsvForm />
            </details>
          </div>
        </>
      )}
    </>
  );
}
