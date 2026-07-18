import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { tanggal } from "@/lib/format";
import {
  AssignAmForm,
  CreateStrategyForm,
  StrategyActions,
  CreateBriefForm,
  BriefStatusButton,
  CreateComplaintForm,
  ComplaintActions,
} from "./forms";

type Merchant = {
  id: string;
  code: string | null;
  nama_toko: string;
  kota: string;
  am_id: string | null;
  am_assigned_at: string | null;
};
type Service = {
  id: string;
  code: string | null;
  merchant_id: string;
  service_type: string;
  status: string;
  execution_status: string;
  requires_strategy_plan: boolean | null;
};
type Strategy = {
  id: string;
  code: string | null;
  service_id: string;
  status: string;
  revision_count: number;
  revision_notes: string | null;
  target_kpis: string;
};
type Brief = {
  id: string;
  code: string | null;
  service_id: string;
  assigned_division: string;
  deliverable_type: string;
  quantity_target: number | null;
  due_date: string;
  priority: string;
  status: string;
  completion_pct: number;
  revision_count: number;
};
type Complaint = {
  id: string;
  code: string | null;
  merchant_id: string;
  source: string | null;
  description: string;
  severity: string;
  status: string;
};
type Trx = { merchant_id: string; released_to_account_at: string | null };

const DIV_LABEL: Record<string, string> = {
  Ecommerce: "E-commerce",
  Ads: "Ads",
  KOL: "KOL",
  LiveStream: "Live Stream",
};

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const mgmt = !!(me?.is_od || me?.is_director);
  const isAccount = me?.division === "Account" || mgmt;
  if (!isAccount) redirect("/dashboard");
  const isLead = me?.rank === "lead" || mgmt;

  const supabase = await getCachedClient();
  const [{ data: merchants }, { data: services }, { data: strategies }, { data: briefs }, { data: complaints }, { data: trxs }, { data: ams }] =
    await Promise.all([
      supabase
        .from("merchants")
        .select("id, code, nama_toko, kota, am_id, am_assigned_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("services")
        .select("id, code, merchant_id, service_type, status, execution_status, requires_strategy_plan"),
      supabase
        .from("strategies")
        .select("id, code, service_id, status, revision_count, revision_notes, target_kpis"),
      supabase
        .from("briefs")
        .select(
          "id, code, service_id, assigned_division, deliverable_type, quantity_target, due_date, priority, status, completion_pct, revision_count"
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("complaints")
        .select("id, code, merchant_id, source, description, severity, status")
        .order("created_at", { ascending: false }),
      supabase.from("transactions").select("merchant_id, released_to_account_at"),
      supabase
        .from("employees")
        .select("id, full_name")
        .eq("division", "Account")
        .eq("active", true)
        .order("full_name"),
    ]);

  const mList = (merchants as Merchant[] | null) ?? [];
  const sList = (services as Service[] | null) ?? [];
  const strList = (strategies as Strategy[] | null) ?? [];
  const bList = (briefs as Brief[] | null) ?? [];
  const cList = (complaints as Complaint[] | null) ?? [];
  const released = new Set(
    ((trxs as Trx[] | null) ?? []).filter((t) => t.released_to_account_at).map((t) => t.merchant_id)
  );

  const merchantById = new Map(mList.map((m) => [m.id, m]));
  const strategyByService = new Map(strList.map((s) => [s.service_id, s]));
  const svcById = new Map(sList.map((s) => [s.id, s]));
  const empById = new Map(((ams as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e]));

  // Antrian intake: sudah dirilis Finance tapi belum punya AM (visible SPV).
  const intakeQueue = mList.filter((m) => released.has(m.id) && !m.am_id);
  // Merchant milikku (AM) atau semua (lead/mgmt).
  const myMerchants = mList.filter(
    (m) => m.am_id && (isLead ? true : m.am_id === me?.id) && released.has(m.id)
  );

  const openComplaints = cList.filter((c) => c.status !== "[Closed]").length;

  return (
    <>
      <h1>Account &amp; Service</h1>
      <p className="page-sub">
        Lapisan penerjemah M6: intake merchant dari Finance → assignment AM → Strategy Plan
        (Plan-gated) → Brief per divisi. Komplain dicatat di sini (pintu primer AM).
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Antrian Intake</div>
          <div className="v">{intakeQueue.length}</div>
        </div>
        <div className="stat">
          <div className="k">Merchant Ditangani</div>
          <div className="v">{mList.filter((m) => m.am_id).length}</div>
        </div>
        <div className="stat">
          <div className="k">Brief Aktif</div>
          <div className="v">
            {bList.filter((b) => !["[Completed]", "[Approved]", "[Cancelled - Service Voided]"].includes(b.status)).length}
          </div>
        </div>
        <div className="stat">
          <div className="k">Komplain Terbuka</div>
          <div className="v">{openComplaints}</div>
        </div>
      </div>

      {isLead && (
        <div className="card">
          <h2>Antrian Intake (Unassigned)</h2>
          <p className="section-sub">
            Merchant muncul di sini begitu Finance memverifikasi pembayaran pertama. Assignment AM
            manual oleh SPV/Head Account; satu AM memiliki seluruh relasi merchant.
          </p>
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Kota</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {intakeQueue.map((m) => (
                <tr key={m.id}>
                  <td>
                    <span className="mono">{m.code ?? "—"}</span> · {m.nama_toko}
                  </td>
                  <td>{m.kota}</td>
                  <td>
                    <AssignAmForm
                      merchantId={m.id}
                      ams={(ams as { id: string; full_name: string }[] | null) ?? []}
                      isReassign={false}
                    />
                  </td>
                </tr>
              ))}
              {intakeQueue.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    Tidak ada merchant menunggu assignment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {myMerchants.map((m) => {
        const svcs = sList.filter((s) => s.merchant_id === m.id);
        return (
          <div className="card" key={m.id}>
            <h2>
              <span className="mono">{m.code ?? "—"}</span> · {m.nama_toko}
            </h2>
            <p className="section-sub">
              AM: {empById.get(m.am_id ?? "")?.full_name ?? "—"} (sejak {tanggal(m.am_assigned_at)})
              {isLead && (
                <span style={{ marginLeft: 12 }}>
                  <AssignAmForm
                    merchantId={m.id}
                    ams={(ams as { id: string; full_name: string }[] | null) ?? []}
                    isReassign={true}
                  />
                </span>
              )}
            </p>

            {svcs.map((s) => {
              const str = strategyByService.get(s.id);
              const svcBriefs = bList.filter((b) => b.service_id === s.id);
              const planGated = !!s.requires_strategy_plan;
              const canBrief =
                s.status === "[Active]" &&
                (!planGated ||
                  ["[Strategy Approved]", "[Briefed]", "[In Execution]"].includes(
                    s.execution_status
                  ));
              return (
                <div key={s.id} className="subcard" style={{ marginBottom: 14 }}>
                  <h3>
                    <span className="mono">{s.code ?? "—"}</span> · {s.service_type}{" "}
                    <span className="badge slate">{s.execution_status}</span>{" "}
                    <span className="badge slate">{planGated ? "Plan-gated" : "Direct"}</span>
                  </h3>

                  {planGated && !str && s.status === "[Active]" && (
                    <details>
                      <summary>Buat Strategy Plan (wajib sebelum Brief)</summary>
                      <CreateStrategyForm serviceId={s.id} />
                    </details>
                  )}
                  {str && (
                    <div style={{ margin: "8px 0" }}>
                      <span className="mono">{str.code}</span>{" "}
                      <span className="badge slate">{str.status}</span> · Target: {str.target_kpis} ·
                      Revisi: {str.revision_count}
                      {str.revision_notes && str.status === "[Strategy Drafting]" && (
                        <span className="muted"> · Catatan: {str.revision_notes}</span>
                      )}
                      <StrategyActions strategyId={str.id} status={str.status} isLead={isLead} />
                    </div>
                  )}

                  {svcBriefs.length > 0 && (
                    <table style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Brief</th>
                          <th>Divisi</th>
                          <th>Target</th>
                          <th>SLA</th>
                          <th>Status</th>
                          <th className="right">Completion</th>
                          <th>Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {svcBriefs.map((b) => (
                          <tr key={b.id}>
                            <td className="mono">{b.code ?? "—"}</td>
                            <td>{DIV_LABEL[b.assigned_division] ?? b.assigned_division}</td>
                            <td>{b.quantity_target ?? "—"}</td>
                            <td>{tanggal(b.due_date)}</td>
                            <td>
                              <span
                                className={`badge ${
                                  b.status === "[Completed]"
                                    ? "green"
                                    : b.status.includes("Cancelled")
                                    ? "red"
                                    : "slate"
                                }`}
                              >
                                {b.status}
                              </span>
                              {b.revision_count >= 3 && (
                                <span className="badge amber" title="3+ revisi — visibilitas SPV">
                                  ⚠ {b.revision_count} revisi
                                </span>
                              )}
                            </td>
                            <td className="right">{Number(b.completion_pct).toFixed(0)}%</td>
                            <td>
                              {b.status === "[Menunggu Forward ke Vendor]" && (
                                <BriefStatusButton
                                  briefId={b.id}
                                  toStatus="[Diteruskan ke Vendor]"
                                  label="Tandai Diteruskan ke Vendor"
                                />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {canBrief && (
                    <details style={{ marginTop: 8 }}>
                      <summary>+ Buat Brief baru</summary>
                      <CreateBriefForm
                        serviceId={s.id}
                        division={
                          s.service_type === "E-commerce"
                            ? "Ecommerce"
                            : s.service_type === "Ads"
                            ? "Ads"
                            : s.service_type === "Live Stream"
                            ? "LiveStream"
                            : "KOL"
                        }
                        serviceType={s.service_type}
                      />
                    </details>
                  )}
                  {planGated && !canBrief && (
                    <p className="muted">[strategi belum disetujui, brief belum bisa dibuat]</p>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {myMerchants.length === 0 && (
        <div className="card">
          <p className="muted">
            Belum ada merchant di queue Anda. {isLead ? "Tugaskan AM dari antrian intake di atas." : "Tunggu assignment dari SPV."}
          </p>
        </div>
      )}

      <div className="card">
        <h2>Komplain (CPL)</h2>
        <p className="section-sub">
          Pintu primer: AM (WhatsApp/direct). Severity memengaruhi Merchant Health (M13): Low −5 ·
          Medium −15 · High −30.
        </p>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Merchant</th>
              <th>Sumber</th>
              <th>Severity</th>
              <th>Deskripsi</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {cList.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.code ?? "—"}</td>
                <td>{merchantById.get(c.merchant_id)?.nama_toko ?? "—"}</td>
                <td>{c.source ?? "—"}</td>
                <td>
                  <span
                    className={`badge ${
                      c.severity === "High" ? "red" : c.severity === "Medium" ? "amber" : "slate"
                    }`}
                  >
                    {c.severity}
                  </span>
                </td>
                <td>{c.description}</td>
                <td>
                  <span className={`badge ${c.status === "[Closed]" ? "green" : "slate"}`}>
                    {c.status}
                  </span>
                </td>
                <td>
                  <ComplaintActions complaintId={c.id} status={c.status} />
                </td>
              </tr>
            ))}
            {cList.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Belum ada komplain.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <details style={{ marginTop: 10 }}>
          <summary>+ Catat komplain baru</summary>
          <CreateComplaintForm
            merchants={mList
              .filter((m) => m.am_id)
              .map((m) => ({ id: m.id, label: `${m.code ?? ""} · ${m.nama_toko}` }))}
            services={sList.map((s) => ({
              id: s.id,
              merchant_id: s.merchant_id,
              label: `${s.code ?? ""} · ${s.service_type} (${merchantById.get(s.merchant_id)?.nama_toko ?? ""})`,
            }))}
          />
        </details>
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        Semua transisi status ditegakkan di Postgres (state machine + audit immutable); UI hanya
        memanggil aksi yang sah.
      </p>
    </>
  );
}
