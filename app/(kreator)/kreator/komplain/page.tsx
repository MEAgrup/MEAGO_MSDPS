import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tanggal } from "@/lib/format";
import { ComplaintForm } from "./complaint-form";

// RLS creator-self: kreator hanya lihat komplain miliknya (select tanpa filter aman).
type ComplaintRow = {
  id: string;
  code: string | null;
  subject: string | null;
  body: string;
  status: string;
  created_at: string;
};

const STATUS_BADGE: Record<string, string> = {
  baru: "amber",
  diproses: "blue",
  selesai: "green",
};

export default async function KomplainPage() {
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
    .from("creator_complaints")
    .select("id, code, subject, body, status, created_at")
    .order("created_at", { ascending: false });

  const complaints = (raw as ComplaintRow[] | null) ?? [];

  return (
    <>
      <h1>Komplain &amp; Feedback</h1>
      <p className="page-sub">Sampaikan komplain atau feedback ke Creator Manager kamu.</p>

      <div className="card">
        <h2>Kirim Komplain Baru</h2>
        <ComplaintForm />
      </div>

      <div className="card">
        <h2>Komplain Saya ({complaints.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Subjek</th>
                <th>Isi</th>
                <th>Status</th>
                <th>Tanggal</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code ?? "—"}</td>
                  <td>{c.subject ?? "—"}</td>
                  <td>{c.body}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[c.status] ?? "gray"}`}>{c.status}</span>
                  </td>
                  <td className="muted">{tanggal(c.created_at)}</td>
                </tr>
              ))}
              {complaints.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Belum ada komplain.
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
