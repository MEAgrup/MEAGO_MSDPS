import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getCreator } from "@/lib/supabase/server";
import { rupiah, tanggal } from "@/lib/format";
import { requestTypeLabel } from "@/lib/mcn/request-types";
import { RequestForm, type PortalMerchant } from "./request-form";

type RequestRow = {
  code: string | null;
  type: string;
  target_brand: string | null;
  target_merchant_id: string | null;
  nominal: number | null;
  status: string;
  needs_approval: boolean;
  approved_at: string | null;
  created_at: string;
};

const STATUS_BADGE: Record<string, string> = {
  diajukan: "amber",
  diproses: "blue",
  selesai: "green",
  ditolak: "red",
};

export default async function RequestPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const creator = await getCreator();
  if (!creator) redirect("/dashboard");

  const supabase = await getCachedClient();
  const [{ data: reqRaw }, { data: merchRaw }] = await Promise.all([
    supabase
      .from("creator_requests")
      .select(
        "code, type, target_brand, target_merchant_id, nominal, status, needs_approval, approved_at, created_at"
      )
      .eq("mcn_creator_id", creator.id)
      .order("created_at", { ascending: false }),
    supabase.from("v_portal_merchants").select("id, nama_toko, kota, kategori"),
  ]);

  const requests = (reqRaw as RequestRow[] | null) ?? [];
  const merchants = (merchRaw as PortalMerchant[] | null) ?? [];
  const merchantName = new Map(merchants.map((m) => [m.id, m.nama_toko]));

  return (
    <>
      <h1>Request Brand/Ads</h1>
      <p className="page-sub">Ajukan request ke agency (Free Meal, Visit, Ads Budget Live, Harga Special Live).</p>

      <div className="card">
        <h2>Ajukan Request Baru</h2>
        <RequestForm merchants={merchants} />
      </div>

      <div className="card">
        <h2>Request Saya ({requests.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Jenis</th>
                <th>Target</th>
                <th className="right">Nominal</th>
                <th>Status</th>
                <th>Tanggal</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r, i) => {
                const target = r.target_merchant_id
                  ? merchantName.get(r.target_merchant_id) ?? "(merchant)"
                  : r.target_brand ?? "—";
                const waitingApproval =
                  r.needs_approval && !r.approved_at && r.status === "diajukan";
                return (
                  <tr key={r.code ?? i}>
                    <td className="mono">{r.code ?? "—"}</td>
                    <td>{requestTypeLabel(r.type)}</td>
                    <td>{target}</td>
                    <td className="right">{r.nominal !== null ? rupiah(r.nominal) : "—"}</td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[r.status] ?? "gray"}`}>{r.status}</span>
                      {waitingApproval && (
                        <div>
                          <span className="badge amber" style={{ marginTop: 4 }}>
                            Menunggu approval Director
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="muted">{tanggal(r.created_at)}</td>
                  </tr>
                );
              })}
              {requests.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Belum ada request.
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
