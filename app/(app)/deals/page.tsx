import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { DealsBoard, type Deal, type DealChangeRequest } from "./table";
import type { PoolLead } from "../leads/pool";

const DEAL_COLUMNS =
  "id, code, unique_id, brand_name, lead_id, bd_id, ops_name, kategori_poi, pic_name, pic_whatsapp, " +
  "tanggal_mulai_kontrak, tanggal_akhir_kontrak, bentuk_kerjasama, nominal_harga, benefit, " +
  "visit_start_date, visit_start_time, visit_end_date, visit_end_time, kreator_needed, konten_needed, " +
  "total_jam_live, brief_link, transaction_id, created_at";

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

  const [{ data: dealsRaw }, { data: dealingLeadsRaw }, { data: emps }, { data: benefits }, { data: changeReqRaw }, { data: outboxRaw }] =
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
      // Bridge MSDPS→CDPS Fase 1 (B4) — status pengiriman per deal, satu baris
      // per deal (cdps_outbox_deal_id_uniq, migrasi 0360).
      supabase.from("cdps_outbox").select("deal_id, status, ord_code, last_error"),
    ]);

  const deals = (dealsRaw as Deal[] | null) ?? [];

  // Bridge MSDPS→CDPS Fase 1 (B4) — gerbang pembayaran butuh tahu apakah
  // transaction_id SUDAH terverifikasi Finance (released_to_account_at), bukan
  // cuma ada — brand_deals sendiri tidak menyimpan itu. Query terpisah karena
  // embed PostgREST 1:1 lewat FK butuh nama constraint eksplisit yang belum
  // ada konvensinya di repo ini untuk kolom ini.
  const trxIds = [...new Set(deals.map((d) => d.transaction_id).filter((id): id is string => !!id))];
  const { data: trxRaw } =
    trxIds.length > 0
      ? await supabase.from("transactions").select("id, released_to_account_at").in("id", trxIds)
      : { data: [] as { id: string; released_to_account_at: string | null }[] };
  const verifiedByTrxId: Record<string, boolean> = {};
  for (const t of trxRaw ?? []) verifiedByTrxId[t.id as string] = !!(t as { released_to_account_at: string | null }).released_to_account_at;

  const bridgeByDeal: Record<string, { status: string; ord_code: string | null; last_error: string | null }> = {};
  for (const o of (outboxRaw as { deal_id: string | null; status: string; ord_code: string | null; last_error: string | null }[] | null) ?? []) {
    if (o.deal_id) bridgeByDeal[o.deal_id] = { status: o.status, ord_code: o.ord_code, last_error: o.last_error };
  }
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
        verifiedByTrxId={verifiedByTrxId}
        bridgeByDeal={bridgeByDeal}
      />
    </>
  );
}
