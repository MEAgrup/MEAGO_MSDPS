import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { DealsBoard, type Deal, type DealChangeRequest } from "./table";
import type { PoolLead } from "../leads/pool";

const DEAL_COLUMNS =
  "id, code, unique_id, brand_name, lead_id, bd_id, ops_name, kategori_poi, pic_name, pic_whatsapp, " +
  "tanggal_mulai_kontrak, tanggal_akhir_kontrak, bentuk_kerjasama, nominal_harga, benefit, " +
  "visit_start_date, visit_start_time, visit_end_date, visit_end_time, kreator_needed, konten_needed, " +
  "total_jam_live, brief_link, created_at";

const CHANGE_REQUEST_COLUMNS =
  "id, deal_id, deal_code, deal_brand_name, action, payload, status, requested_by, requested_at, " +
  "reviewed_by, reviewed_at, review_note";

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
  // Edit & Hapus transaksi deal LANGSUNG dibatasi ke role "leader dan atasnya"
  // — untuk saat ini is_director() saja (migrasi 0341/lib/actions/deals.ts).
  const canEditDelete = !!me?.is_director;
  // BD/CM tetap punya tombol Edit/Lengkapi Data & Hapus, tapi hasilnya masuk
  // antrian approval Director (migrasi 0349 · deal_change_requests).
  const canRequestChange = canRegister && !canEditDelete;

  const supabase = await getCachedClient();

  const [{ data: dealsRaw }, { data: dealingLeadsRaw }, { data: emps }, { data: benefits }, { data: changeReqRaw }] =
    await Promise.all([
      supabase.from("brand_deals").select(DEAL_COLUMNS).order("created_at", { ascending: false }),
      supabase
        .from("leads")
        .select(POOL_LEAD_COLUMNS)
        .in("crm_status", ["Dealing", "Renewal"])
        .order("created_at", { ascending: false }),
      supabase.from("employees").select("id, full_name, division, active"),
      supabase.from("lead_benefit_options").select("label").order("label"),
      // RLS deal_change_requests: Director/OD lihat semua, pemohon lihat
      // miliknya sendiri — tidak perlu filter tambahan di sini.
      supabase
        .from("deal_change_requests")
        .select(CHANGE_REQUEST_COLUMNS)
        .order("requested_at", { ascending: false })
        .limit(100),
    ]);

  const deals = (dealsRaw as Deal[] | null) ?? [];
  const dealingLeads = (dealingLeadsRaw as PoolLead[] | null) ?? [];
  const employees = (emps as { id: string; full_name: string; division: string; active: boolean | null }[] | null) ?? [];
  const benefitOptions = (benefits ?? []).map((b) => b.label);

  const changeRequests = (changeReqRaw as DealChangeRequest[] | null) ?? [];

  const bdNameById: Record<string, string> = Object.fromEntries(employees.map((e) => [e.id, e.full_name]));
  const empNameById: Record<string, string> = bdNameById;

  // Riwayat nominal per lead — saran "Nominal Deals" hanya dari POI/Merchant
  // yang sedang dipilih, bukan seluruh nominal di pipeline.
  const nominalHistoryByLead: Record<string, number[]> = {};
  for (const d of deals) {
    if (!d.lead_id || !d.nominal_harga) continue;
    (nominalHistoryByLead[d.lead_id] ??= []).push(d.nominal_harga);
  }
  const bdOptions = employees
    .filter((e) => e.division === "BizDev" && e.active !== false)
    .map((e) => ({ id: e.id, full_name: e.full_name }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  return (
    <>
      <h1>Merchant Deals</h1>
      <p className="page-sub">
        Pendataan transaksi kerja sama POI/merchant hasil pipeline BD (Leads &amp; Prospek → Dealing /
        Renewal).
      </p>

      <DealsBoard
        deals={deals}
        dealingLeads={dealingLeads}
        bdOptions={bdOptions}
        bdNameById={bdNameById}
        benefitOptions={benefitOptions}
        nominalHistoryByLead={nominalHistoryByLead}
        changeRequests={changeRequests}
        empNameById={empNameById}
        canRegister={canRegister}
        canEditDelete={canEditDelete}
        canRequestChange={canRequestChange}
      />
    </>
  );
}
