import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getMerchantPortal, hasMerchantAccount } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { MobileShell } from "@/components/mobile-shell";
import { PortalInactive } from "@/components/portal-inactive";

// Merchant Portal (read-only) — DI LUAR route group (app). Akses hanya bila ada
// merchant_portal_users aktif untuk auth.uid() DAN lead masih closing; data
// dibaca lewat RPC merchant_portal_* (migrasi 0374) yang sudah memfilter ke
// merchant milik akun ini. Bukan merchant (karyawan/kreator nyasar) → /dashboard.
export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const brands = await getMerchantPortal();
  if (!brands) {
    if (await hasMerchantAccount()) return <PortalInactive portal="Merchant Portal" />;
    redirect("/dashboard");
  }

  const sidebar = (
    <>
      <div className="brand">MEAGO!</div>
      <div className="sub">Merchant Portal</div>

      <Link href="/merchant">Beranda</Link>
      <Link href="/merchant/kampanye">Status Kampanye</Link>
      <Link href="/merchant/laporan">Laporan GMV</Link>

      <div className="spacer" />
      <div className="me">
        {brands.map((b) => (
          <div key={b.lead_id} style={{ color: "#e2e8f0", fontWeight: 600 }}>
            {b.brand_name}
          </div>
        ))}
        <div style={{ fontSize: 12 }}>{user.email}</div>
        <form action={signOut} style={{ marginTop: 10 }}>
          <button className="btn-ghost" style={{ width: "100%" }}>
            Keluar
          </button>
        </form>
      </div>
    </>
  );

  return (
    <MobileShell brand="MEAGO!" sidebar={sidebar}>
      {children}
    </MobileShell>
  );
}
