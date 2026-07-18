import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tanggal } from "@/lib/format";
import { DownloadButton } from "./download-button";

// Read-only: report yang diunggah tim CM untuk kreator ini (RLS creator-self —
// select tanpa filter tambahan aman).
type ReportRow = {
  id: string;
  title: string;
  created_at: string;
};

export default async function ReportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: creator } = await supabase
    .from("mcn_creators")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!creator) redirect("/dashboard");

  const { data: raw } = await supabase
    .from("creator_reports")
    .select("id, title, created_at")
    .order("created_at", { ascending: false });

  const reports = (raw as ReportRow[] | null) ?? [];

  return (
    <>
      <h1>Report Saya</h1>
      <p className="page-sub">Report yang dibuatkan tim Creator Management untuk kamu.</p>

      <div className="card">
        <h2>Daftar Report ({reports.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Judul</th>
                <th>Tanggal</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td className="muted">{tanggal(r.created_at)}</td>
                  <td>
                    <DownloadButton reportId={r.id} />
                  </td>
                </tr>
              ))}
              {reports.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Belum ada report dari tim CM.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
