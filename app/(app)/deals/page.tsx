import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { num, rupiah } from "@/lib/format";
import { DealsToolbar } from "./forms";
import { DealsTable, type Deal } from "./table";
import type { PoolLead } from "../leads/pool";

const DEAL_COLUMNS =
  "id, code, unique_id, brand_name, lead_id, bd_id, ops_name, kategori_poi, pic_name, pic_whatsapp, " +
  "tanggal_mulai_kontrak, tanggal_akhir_kontrak, bentuk_kerjasama, nominal_harga, benefit, " +
  "visit_start_date, visit_start_time, visit_end_date, visit_end_time, kreator_needed, konten_needed, " +
  "total_jam_live, brief_link, created_at";

const POOL_LEAD_COLUMNS =
  "id, code, lead_name, brand_name, bd_employee_id, brand_category, business_type, wilayah, " +
  "source, pic_name_position, pic_phone, web_socmed_link, phone_normalized, status, stale, " +
  "crm_status, benefit_dealing, nominal_bayar, tanggal_mulai_kontrak, tanggal_akhir_kontrak, created_at";

export default async function DealsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || ["BizDev", "CreatorManagement", "Account"].includes(div);
  if (!canView) redirect("/dashboard");

  const canRegister = mgmt || div === "BizDev" || div === "CreatorManagement";
  const canImport = mgmt || div === "BizDev";

  const supabase = await getCachedClient();

  const [{ data: dealsRaw }, { data: dealingLeadsRaw }, { data: emps }, { data: benefits }] =
    await Promise.all([
      supabase.from("brand_deals").select(DEAL_COLUMNS).order("created_at", { ascending: false }),
      supabase
        .from("leads")
        .select(POOL_LEAD_COLUMNS)
        .in("crm_status", ["Dealing", "Renewal"])
        .order("created_at", { ascending: false }),
      supabase.from("employees").select("id, full_name, division, active"),
      supabase.from("lead_benefit_options").select("label").order("label"),
    ]);

  const deals = (dealsRaw as Deal[] | null) ?? [];
  const dealingLeads = (dealingLeadsRaw as PoolLead[] | null) ?? [];
  const employees = (emps as { id: string; full_name: string; division: string; active: boolean | null }[] | null) ?? [];
  const benefitOptions = (benefits ?? []).map((b) => b.label);

  const bdNameById: Record<string, string> = Object.fromEntries(employees.map((e) => [e.id, e.full_name]));
  const bdOptions = employees
    .filter((e) => e.division === "BizDev" && e.active !== false)
    .map((e) => ({ id: e.id, full_name: e.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const totalTransaksi = deals.length;
  const totalNominalDeals = deals.reduce((sum, d) => sum + (d.nominal_harga ?? 0), 0);
  const berbayarCount = deals.filter((d) => d.bentuk_kerjasama === "Berbayar").length;
  const freeBarterCount = deals.filter((d) => d.bentuk_kerjasama === "Free/Barter").length;
  const skemaTotal = berbayarCount + freeBarterCount;
  const berbayarPct = skemaTotal > 0 ? Math.round((berbayarCount / skemaTotal) * 100) : 0;
  const freeBarterPct = skemaTotal > 0 ? 100 - berbayarPct : 0;

  return (
    <>
      <h1>Merchant Deals</h1>
      <p className="page-sub">
        Pendataan transaksi kerja sama POI/merchant hasil pipeline BD (Leads &amp; Prospek → Dealing /
        Renewal).
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Transaksi</div>
          <div className="v">{num(totalTransaksi)}</div>
        </div>
        <div className="stat">
          <div className="k">Total Nominal Deals</div>
          <div className="v small">{rupiah(totalNominalDeals)}</div>
        </div>
        <div className="stat">
          <div className="k">Skema Berbayar</div>
          <div className="v">
            {num(berbayarCount)} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>({berbayarPct}%)</span>
          </div>
        </div>
        <div className="stat">
          <div className="k">Skema Free/Barter</div>
          <div className="v">
            {num(freeBarterCount)} <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>({freeBarterPct}%)</span>
          </div>
        </div>
      </div>

      {canRegister && (
        <DealsToolbar
          dealingLeads={dealingLeads}
          bdOptions={bdOptions}
          benefitOptions={benefitOptions}
          canImport={canImport}
        />
      )}

      <DealsTable
        deals={deals}
        dealingLeads={dealingLeads}
        bdOptions={bdOptions}
        bdNameById={bdNameById}
        benefitOptions={benefitOptions}
        canManage={canRegister}
      />
    </>
  );
}
