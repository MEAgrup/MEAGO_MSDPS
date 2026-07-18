import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCreator, getCachedClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

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

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const isLead = me?.rank === "lead";
  const canManage = mgmt;
  const seeLeads = mgmt || div === "BizDev" || div === "Marketing";
  const seeMerchants = mgmt || ["BizDev", "Account", "Finance"].includes(div);
  const seeFinance = mgmt || div === "Finance";
  const seeAccount = mgmt || div === "Account";
  const seeEcommerce = mgmt || ["Ecommerce", "Account"].includes(div);
  const seeAds = mgmt || ["Ads", "Account"].includes(div);
  const seeKol = mgmt || ["KOL", "Account"].includes(div);
  const seeLivestream = mgmt || ["Account", "LiveStream"].includes(div);

  // ---- MCN nav groups ----
  const seeCM = mgmt || div === "CreatorManagement";
  const seeBD = mgmt || div === "BizDev";
  const seeAcq = mgmt || div === "Acquisition";
  const seeProj =
    mgmt || isLead || ["CreatorManagement", "BizDev", "Acquisition"].includes(div);

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

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">MSDPS</div>
        <div className="sub">MEAGO!</div>

        {sectionHeading("Umum")}
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/portal">Team Portal</Link>
        {seeFinance && <Link href="/finance">Keuangan</Link>}
        {mgmt && <Link href="/okr">Target OKR</Link>}
        {mgmt && <Link href="/management">Manajemen</Link>}
        {canManage && <Link href="/employees">Kelola Karyawan</Link>}

        {seeCM && sectionHeading("CM Kreator")}
        {(seeCM || div === "BizDev") && <Link href="/meago/creators">Data Kreator</Link>}
        {seeCM && <Link href="/meago/workspace">CM Workspace</Link>}
        {(seeCM || div === "BizDev") && <Link href="/meago/schedule">Jadwal Live</Link>}

        {seeBD && sectionHeading("BizDev & Admin Ops")}
        {seeLeads && <Link href="/leads">Leads &amp; Prospek</Link>}
        {seeBD && <Link href="/deals">Merchant Deals</Link>}
        {seeBD && <Link href="/bizdev">BizDev Workspace</Link>}

        {seeAcq && sectionHeading("Akuisisi Kreator")}
        {seeAcq && <Link href="/acquisition">Akuisisi Kreator</Link>}

        {seeProj && sectionHeading("Special Project")}
        {seeProj && <Link href="/projects">Special Project</Link>}

        {sectionHeading("Account & Service")}
        <Link href="/board">Merchant Board</Link>
        {seeAccount && <Link href="/account">Account</Link>}
        {seeEcommerce && <Link href="/ecommerce">E-commerce</Link>}
        {seeAds && <Link href="/ads">Ads</Link>}
        {seeKol && <Link href="/kol">KOL</Link>}
        {seeLivestream && <Link href="/livestream">Live Stream</Link>}
        {seeMerchants && <Link href="/merchants">Merchant</Link>}
        <Link href="/campaigns">Kampanye</Link>

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
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
