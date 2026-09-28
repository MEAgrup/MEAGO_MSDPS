import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCreator, getCachedClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { isCampaignStaff } from "@/lib/campaign-access";
import { LEAD_ONBOARDING_KEY, isWindowOpen, parseWindow } from "@/lib/employee-onboarding";
import { MobileShell } from "@/components/mobile-shell";
import { NavLink } from "@/components/nav-link";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();

  // Cross-blocking identitas: sesi yang BUKAN karyawan tidak boleh masuk route (app).
  // Kreator → portal; akun tanpa identitas apa pun → sign-out + login.
  if (!me) {
    const creator = await getCreator();
    if (creator) redirect("/kreator/performa");
    const supabase = await getCachedClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  // Password sementara (migrasi 0367): akun yang dibuat SPV/Lead atau OD dengan
  // password titipan tidak boleh memakai sistem sebelum menetapkan passwordnya
  // sendiri. /ganti-password sengaja di luar grup (app) supaya redirect ini
  // tidak memutar pada dirinya sendiri.
  if (me?.must_change_password) redirect("/ganti-password");

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const isLead = me?.rank === "lead";

  // Nav "Kelola Karyawan" terbuka untuk SPV/Lead HANYA selama jendela onboarding
  // berlaku — sesudah tutup, menu itu hilang lagi dengan sendirinya. Satu baris
  // app_config (primary key) dan hanya untuk lead non-mgmt.
  let leadWindowOpen = false;
  if (isLead && !mgmt) {
    const supabase = await getCachedClient();
    const { data: cfg } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", LEAD_ONBOARDING_KEY)
      .maybeSingle();
    leadWindowOpen = isWindowOpen(parseWindow(cfg?.value));
  }
  const canManage = mgmt || leadWindowOpen;
  const seeLeads = mgmt || div === "BizDev" || div === "Marketing";
  const seeMerchants = mgmt || ["BizDev", "Finance"].includes(div);
  const seeFinance = mgmt || div === "Finance";
  // seeAccount/seeEcommerce/seeAds/seeKol/seeLivestream DIHAPUS 2026-09-12:
  // eksekusi layanan pindah ke CDPS lewat Bridge Fase 1, halamannya dinisankan
  // (components/retired.tsx). Route-nya masih ada dan menjelaskan dirinya sendiri.

  // ---- MCN nav groups ----
  const seeCM = mgmt || div === "CreatorManagement";
  const seeBD = mgmt || div === "BizDev";
  const seeAcq = mgmt || div === "Acquisition";
  // Campaign MEA GO: pemilik = BizDev + SPV Creator Management (rank lead),
  // pelaksana = AM (Account). Lihat lib/campaign-access.ts.
  const seeCampaign = isCampaignStaff(me);
  const seeProj =
    mgmt || isLead || ["CreatorManagement", "BizDev", "Acquisition"].includes(div);

  // Notif "Leads & Prospek" + "Merchant Deals": brand berstatus Dealing/Renewal
  // yang belum punya transaksi deal (brand_deals.lead_id). Sama untuk kedua
  // link — dihitung sekali di sini. Dibatasi ke mgmt/BizDev (bukan seeLeads
  // penuh) karena RLS brand_deals tidak mengizinkan Marketing SELECT — badge
  // untuk Marketing akan selalu tampak "penuh" (dealtSet kosong) kalau dipaksa.
  let missingDealCount = 0;
  // Deal yang berhenti tanpa kategori_poi (baris Import Master Deal belum dilengkapi).
  // Tracker operasional memfilter kolom itu, jadi baris seperti ini tak pernah
  // dikerjakan siapa pun sampai ada yang membuka /deals dan sadar. Badge ini yang
  // membuatnya terlihat dari nav.
  let incompleteDealCount = 0;
  if (mgmt || div === "BizDev") {
    const supabase = await getCachedClient();
    const [{ data: dealingLeads }, { data: dealtLeads }, { count: incompleteCount }] = await Promise.all([
      supabase.from("leads").select("id").in("crm_status", ["Dealing", "Renewal"]),
      supabase.from("brand_deals").select("lead_id").not("lead_id", "is", null),
      supabase.from("brand_deals").select("id", { count: "exact", head: true }).is("kategori_poi", null),
    ]);
    const dealtSet = new Set((dealtLeads ?? []).map((d) => d.lead_id));
    missingDealCount = (dealingLeads ?? []).filter((l) => !dealtSet.has(l.id)).length;
    incompleteDealCount = incompleteCount ?? 0;
  }

  const NotifBadge = ({ count }: { count: number }) =>
    count > 0 ? (
      <span className="badge red" style={{ marginLeft: 6 }} title="Dealing/Renewal belum ada transaksi deal">
        {count}
      </span>
    ) : null;

  const IncompleteBadge = ({ count }: { count: number }) =>
    count > 0 ? (
      <span
        className="badge amber"
        style={{ marginLeft: 6 }}
        title="Transaksi deal belum dilengkapi — belum masuk tracker operasional"
      >
        {count}
      </span>
    ) : null;

  const sectionHeading = (label: string) => (
    <div
      style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: ".04em",
        color: "#64748b",
        marginTop: 14,
        marginBottom: 2,
        padding: "0 12px",
      }}
    >
      {label}
    </div>
  );

  const sidebar = (
    <>
      <div className="brand">MSDPS</div>
      <div className="sub">MEAGO!</div>

      {sectionHeading("Umum")}
        <NavLink href="/dashboard">Dashboard</NavLink>
        {seeFinance && <NavLink href="/finance">Keuangan</NavLink>}
        {mgmt && <NavLink href="/okr">Target OKR</NavLink>}
        {canManage && <NavLink href="/employees">Kelola Karyawan</NavLink>}

        {seeCM && sectionHeading("CM Kreator")}
        {(seeCM || div === "BizDev") && <NavLink href="/meago/creators">Data Kreator</NavLink>}
        {seeCM && <NavLink href="/meago/workspace">CM Workspace</NavLink>}
        {(seeCM || div === "BizDev") && <NavLink href="/meago/gmv-video">GMV Video Mingguan</NavLink>}
        {(seeCM || div === "BizDev") && <NavLink href="/meago/schedule">Jadwal Live</NavLink>}

        {seeBD && sectionHeading("BizDev & Admin Ops")}
        {seeLeads && (
          <NavLink href="/leads">
            Leads &amp; Prospek
            <NotifBadge count={missingDealCount} />
          </NavLink>
        )}
        {seeLeads && <NavLink href="/leads/dashboard">Dashboard CRM</NavLink>}
        {seeBD && (
          <NavLink href="/deals">
            Merchant Deals
            <NotifBadge count={missingDealCount} />
            <IncompleteBadge count={incompleteDealCount} />
          </NavLink>
        )}
        {seeBD && <NavLink href="/bizdev">BizDev Workspace</NavLink>}
        {seeBD && <NavLink href="/bizdev/poi">POI Accommodation &amp; TTD</NavLink>}
        {seeBD && <NavLink href="/bizdev/poi-dining">POI Dining</NavLink>}
        {seeBD && <NavLink href="/bizdev/skor">Papan Skor BD</NavLink>}
        {me?.is_director && <NavLink href="/bizdev/settings">Setting Bizdev &amp; Admin Ops</NavLink>}

        {seeCampaign && sectionHeading("Campaign MEA GO")}
        {seeCampaign && <NavLink href="/meago/campaigns">Campaign MEA GO</NavLink>}

        {seeAcq && sectionHeading("Akuisisi Kreator")}
        {seeAcq && <NavLink href="/acquisition">Akuisisi Kreator</NavLink>}

        {seeProj && sectionHeading("Special Project")}
        {seeProj && <NavLink href="/projects">Special Project</NavLink>}

        {/* Grup "Account & Service" PENSIUN 2026-09-12 — /board /account /ecommerce
            /ads /kol /livestream beserta /portal dan /management dinisankan; eksekusinya
            di CDPS. Yang tersisa di sini bukan modul eksekusi: Merchant (M4) adalah induk
            yang dipakai close_deal + bridge, Kampanye (M3) menyuapi Leads (M1) dan ROAS
            Marketing (M2). Keduanya tetap hidup. */}
        {sectionHeading("Merchant & Kampanye")}
        {seeMerchants && <NavLink href="/merchants">Merchant</NavLink>}
        <NavLink href="/campaigns">Kampanye</NavLink>

        <div className="spacer" />
        <div className="me">
          {me ? (
            <>
              <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{me.full_name}</div>
              <div>
                {me.division} · {me.rank === "lead" ? "Lead/SPV" : "Staff"}
                {me.is_director ? " · Director" : ""}
                {me.is_od ? " · OD" : ""}
              </div>
            </>
          ) : (
            <div>{user.email}</div>
          )}
          <form action={signOut} style={{ marginTop: 10 }}>
            <button className="btn-ghost" style={{ width: "100%" }}>
              Keluar
            </button>
          </form>
        </div>
    </>
  );

  return (
    <MobileShell brand="MSDPS" sidebar={sidebar}>
      {children}
    </MobileShell>
  );
}
