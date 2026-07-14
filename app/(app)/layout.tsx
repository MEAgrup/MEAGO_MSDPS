import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("employees")
    .select("full_name, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canManage = mgmt;
  const seeLeads = mgmt || div === "BizDev" || div === "Marketing";
  const seeMerchants = mgmt || ["BizDev", "Account", "Finance"].includes(div);
  const seeFinance = mgmt || div === "Finance";
  const seeAccount = mgmt || div === "Account";
  const seeEcommerce = mgmt || ["Ecommerce", "Account"].includes(div);
  const seeAds = mgmt || ["Ads", "Account"].includes(div);
  const seeKol = mgmt || ["KOL", "Account"].includes(div);
  const seeLivestream = mgmt || ["Account", "LiveStream"].includes(div);

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">MSDPS</div>
        <div className="sub">MEAGO!</div>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/portal">Team Portal</Link>
        <Link href="/board">Merchant Board</Link>
        {mgmt && <Link href="/management">Manajemen</Link>}
        {mgmt && <Link href="/okr">Target OKR</Link>}
        <Link href="/campaigns">Kampanye</Link>
        {seeLeads && <Link href="/leads">Leads &amp; Prospek</Link>}
        {seeMerchants && <Link href="/merchants">Merchant</Link>}
        {seeAccount && <Link href="/account">Account</Link>}
        {seeEcommerce && <Link href="/ecommerce">E-commerce</Link>}
        {seeAds && <Link href="/ads">Ads</Link>}
        {seeKol && <Link href="/kol">KOL</Link>}
        {seeLivestream && <Link href="/livestream">Live Stream</Link>}
        {seeFinance && <Link href="/finance">Keuangan</Link>}
        {canManage && <Link href="/employees">Kelola Karyawan</Link>}
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
