import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tanggal } from "@/lib/format";

// Read-only: special project yang meng-assign kreator ini (RLS creator-self via
// special_project_creators + special_projects). TANPA ads_budget/target_gmv (internal).
type ProjectRow = {
  code: string | null;
  name: string;
  industry_category: string;
  start_date: string;
  end_date: string;
  status: string;
  description: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  draft: "gray",
  active: "green",
  done: "blue",
  cancelled: "red",
};

export default async function SpecialProjectPage() {
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
    .from("special_project_creators")
    .select(
      "special_projects(code, name, industry_category, start_date, end_date, status, description)"
    )
    .eq("mcn_creator_id", creator.id);

  const projects: ProjectRow[] = (
    ((raw as { special_projects: ProjectRow | null }[] | null) ?? [])
      .map((r) => r.special_projects)
      .filter((p): p is ProjectRow => p !== null)
  );

  return (
    <>
      <h1>Special Project</h1>
      <p className="page-sub">Project yang meng-assign kamu. Tampilan hanya-baca.</p>

      <div className="card">
        <h2>Project Saya ({projects.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Kategori</th>
                <th>Periode</th>
                <th>Status</th>
                <th>Deskripsi</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => (
                <tr key={p.code ?? i}>
                  <td className="mono">{p.code ?? "—"}</td>
                  <td>{p.name}</td>
                  <td>{p.industry_category}</td>
                  <td>
                    {tanggal(p.start_date)} – {tanggal(p.end_date)}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[p.status] ?? "gray"}`}>{p.status}</span>
                  </td>
                  <td className="muted">{p.description ?? "—"}</td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Belum ada special project yang meng-assign kamu.
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
