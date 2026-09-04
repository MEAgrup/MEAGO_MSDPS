import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { CrmDashboard, type DashLead, type DashDeal, type DashHistory } from "./crm-dashboard";

const LEAD_COLUMNS =
  "id, code, brand_name, lead_name, bd_employee_id, brand_category, wilayah, source, crm_status, " +
  "approach_via, benefit_dealing, nominal_bayar, created_at";

const DEAL_COLUMNS = "id, brand_name, lead_id, bd_id, kategori_poi, bentuk_kerjasama, nominal_harga, created_at";

const HISTORY_COLUMNS = "lead_id, from_status, to_status, changed_at";

// Dashboard CRM — tab analitik di bawah "Leads & Prospek". Sengaja mengambil
// SELURUH baris (tanpa filter tanggal di query) lalu filter/agregasi di client
// (CrmDashboard) — konsisten dengan pola Pool Lead & Daftar Deal yang sudah
// ada di app ini (fetch sekali, filter interaktif di browser).
export default async function CrmDashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || div === "BizDev" || div === "Marketing";
  if (!canView) redirect("/dashboard");

  const supabase = await getCachedClient();

  const [{ data: leadsRaw }, { data: dealsRaw }, { data: historyRaw }, { data: emps }] = await Promise.all([
    supabase.from("leads").select(LEAD_COLUMNS).order("created_at", { ascending: true }),
    supabase.from("brand_deals").select(DEAL_COLUMNS).order("created_at", { ascending: true }),
    supabase.from("lead_status_history").select(HISTORY_COLUMNS).order("changed_at", { ascending: true }),
    supabase.from("employees").select("id, full_name, division, active"),
  ]);

  const employees = (emps as { id: string; full_name: string; division: string; active: boolean | null }[] | null) ?? [];
  const bdNameById: Record<string, string> = Object.fromEntries(employees.map((e) => [e.id, e.full_name]));
  const bdOptions = employees
    .filter((e) => e.division === "BizDev" && e.active !== false)
    .map((e) => ({ id: e.id, full_name: e.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <>
      <h1>Dashboard CRM</h1>
      <p className="page-sub">
        Analitik pipeline Leads &amp; Prospek — funnel status, kecepatan approach ke deals, dan performa
        per BD/wilayah.
      </p>

      <CrmDashboard
        leads={(leadsRaw as DashLead[] | null) ?? []}
        deals={(dealsRaw as DashDeal[] | null) ?? []}
        history={(historyRaw as DashHistory[] | null) ?? []}
        bdOptions={bdOptions}
        bdNameById={bdNameById}
      />
    </>
  );
}
