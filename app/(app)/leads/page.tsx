import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { NewLeadModal } from "./forms";
import { PoolLeadSection, type PoolLead } from "./pool";
import { BRAND_CATEGORIES, WEBSITE_LEAD_SOURCE, isDealStatus, type BrandCategory } from "@/lib/leads/intake";
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
  const canSendPortal = isBizDev || !!me?.is_od || !!me?.is_director;

  const supabase = await getCachedClient();

  const [
    { data: leads },
    { data: emps },
    { data: businessTypes },
    { data: benefits },
    { data: recordedDeals },
    { data: webAttr },
    { data: portalUsers },
  ] = await Promise.all([
      supabase.from("leads").select(POOL_LEAD_COLUMNS).order("created_at", { ascending: false }),
      supabase.from("employees").select("id, full_name, division, active"),
      supabase.from("lead_business_types").select("brand_category, label").order("label"),
      supabase.from("lead_benefit_options").select("label").order("label"),
      supabase.from("brand_deals").select("lead_id, nominal_harga").not("lead_id", "is", null),
      supabase.from("lead_web_attribution").select("lead_id, cta_id"),
      supabase.from("merchant_portal_users").select("lead_id, active"),
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

  const ctaByLead = new Map((webAttr ?? []).map((a) => [a.lead_id as string, a.cta_id as string | null]));
  const leadList = ((leads as PoolLead[] | null) ?? []).map((l) =>
    ctaByLead.has(l.id) ? { ...l, web_cta: ctaByLead.get(l.id) ?? null } : l
  );
  const unprocessedWeb = leadList.filter(
    (l) => l.source === WEBSITE_LEAD_SOURCE && !l.bd_employee_id
  ).length;
  const countByStatus = (status: string) => leadList.filter((l) => l.crm_status === status).length;
  const recordedLeadIds = new Set(
    (recordedDeals ?? []).map((d) => d.lead_id).filter((id): id is string => !!id)
  );
  // Merchant Portal (migrasi 0372): lead closing = Dealing/Renewal + sudah ada
  // brand_deals. Tombol "Kirim Akses Portal" hanya untuk lead ini.
  const portalEligibleIds = new Set(
    leadList.filter((l) => isDealStatus(l.crm_status) && recordedLeadIds.has(l.id)).map((l) => l.id)
  );
  const portalLinkedIds = new Set(
    (portalUsers ?? []).filter((u) => u.active).map((u) => u.lead_id as string)
  );
  // Riwayat nominal transaksi per lead — jadi saran "Nominal Deals" di form
  // "Catat Transaksi", dibatasi ke lead yang bersangkutan saja.
  const nominalHistoryByLead: Record<string, number[]> = {};
  for (const d of recordedDeals ?? []) {
    if (!d.lead_id || !d.nominal_harga) continue;
    (nominalHistoryByLead[d.lead_id] ??= []).push(d.nominal_harga);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Leads &amp; Prospek</h1>
          <p className="page-sub">
            Pool lead dedup by nomor (E.164). Prospek = salinan kerja BizDev; yang pertama closing
            menang, sisanya otomatis [Closed - Kalah Kompetisi].
          </p>
        </div>
        {canManage && <NewLeadModal bdOptions={bdOptions} businessTypeOptions={businessTypeOptions} />}
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Lead</div>
          <div className="v">{leadList.length}</div>
        </div>
        <div className="stat">
          <div className="k">Lead Website baru</div>
          <div className="v">{unprocessedWeb}</div>
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
        recordedLeadIds={recordedLeadIds}
        nominalHistoryByLead={nominalHistoryByLead}
        isBizDev={isBizDev}
        canManage={canManage}
        canSendPortal={canSendPortal}
        portalEligibleIds={portalEligibleIds}
        portalLinkedIds={portalLinkedIds}
      />
    </>
  );
}
