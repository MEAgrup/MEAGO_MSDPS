import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

// Layout portal kreator — DI LUAR route group (app). Server-side gating: resolve
// kreator via mcn_creators.auth_user_id = auth.uid(); bukan kreator (mis. karyawan
// yang nyasar ke /kreator) → /dashboard; tanpa sesi → /login.
export default async function KreatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: creator } = await supabase
    .from("mcn_creators")
    .select("code, name")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!creator) redirect("/dashboard");

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">MCN MEA</div>
        <div className="sub">Portal Kreator</div>

        <Link href="/kreator/performa">Performa Saya</Link>
        <Link href="/kreator/agency-plan">Merchant Deals</Link>
        <Link href="/kreator/report">Report Saya</Link>
        <Link href="/kreator/request">Request Brand/Ads</Link>
        <Link href="/kreator/special-project">Special Project</Link>
        <Link href="/kreator/komplain">Komplain &amp; Feedback</Link>

        <div className="spacer" />
        <div className="me">
          <div style={{ color: "#e2e8f0", fontWeight: 600 }}>{creator.name}</div>
          {creator.code && (
            <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{creator.code}</div>
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
