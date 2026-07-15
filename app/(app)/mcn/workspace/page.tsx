import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rupiah, tanggal } from "@/lib/format";
import { buildMonthlyGrowth, daysInMonth, formatYMD, type GrowthRow } from "@/lib/mcn/weeks";
import {
  IngestForm,
  CreateRequestForm,
  ApproveRequestButton,
  RequestProgressControls,
} from "./forms";

type CreatorRow = { id: string; name: string; code: string | null; owner_cpm_id: string | null };
type Alert = {
  id: string;
  alert_type: string;
  mcn_creator_id: string | null;
  shop_id: string | null;
  detail: unknown;
  created_at: string;
};
type CreatorRequest = {
  id: string;
  code: string | null;
  mcn_creator_id: string;
  type: string;
  target_brand: string | null;
  detail: string | null;
  status: string;
  needs_approval: boolean;
  approved_by: string | null;
  created_at: string;
};
type ProjectSummary = {
  id: string;
  code: string | null;
  name: string;
  status: string;
  creators_assigned: number;
  creators_cm: number;
  creators_acquisition: number;
  creators_needed: number;
  merchant_count: number;
  actual_gmv: number;
  target_gmv: number | null;
  pct_gmv: number | null;
};

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export default async function McnWorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("employees")
    .select("id, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  // Workspace CM-only + management (per nav).
  if (!(mgmt || div === "CreatorManagement")) redirect("/dashboard");

  const isStaffCM = div === "CreatorManagement" && me?.rank === "staff" && !mgmt;

  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const sp = await searchParams;
  const monthParam = sp.month;
  let ym = curYM;
  if (monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) ym = monthParam;
  const [ymYear, ymMonth] = ym.split("-").map(Number);
  const monthStart = `${ym}-01`;
  const monthEnd = formatYMD(ymYear, ymMonth, daysInMonth(ymYear, ymMonth));
  const prevYM = shiftMonth(ym, -1);
  const nextYM = shiftMonth(ym, 1);

  // Scope CPM: staff CM hanya lihat kreator miliknya (RLS juga menegakkan; UI ikut supaya jelas).
  let creatorQuery = supabase
    .from("mcn_creators")
    .select("id, name, code, owner_cpm_id")
    .order("name", { ascending: true });
  if (isStaffCM) creatorQuery = creatorQuery.eq("owner_cpm_id", me!.id);
  const { data: creatorsRaw } = await creatorQuery;
  const creators = (creatorsRaw as CreatorRow[] | null) ?? [];
  const creatorIds = creators.map((c) => c.id);

  const { data: allCreatorsRaw } = await supabase.from("mcn_creators").select("id, name, code");
  const creatorName = new Map<string, string>(
    ((allCreatorsRaw as { id: string; name: string; code: string | null }[] | null) ?? []).map(
      (c) => [c.id, `${c.code ?? "(draft)"} · ${c.name}`]
    )
  );

  // (b) Growth W1-W5.
  const growthByCreator = new Map<string, ReturnType<typeof buildMonthlyGrowth>>();
  if (creatorIds.length > 0) {
    const { data: summaryRaw } = await supabase
      .from("creator_period_summary")
      .select("mcn_creator_id, period_start, created_at, affiliate_gmv")
      .in("mcn_creator_id", creatorIds)
      .gte("period_start", monthStart)
      .lte("period_start", monthEnd);
    const rows =
      (summaryRaw as (GrowthRow & { mcn_creator_id: string })[] | null) ?? [];
    const byCreator = new Map<string, GrowthRow[]>();
    for (const r of rows) {
      const arr = byCreator.get(r.mcn_creator_id) ?? [];
      arr.push(r);
      byCreator.set(r.mcn_creator_id, arr);
    }
    for (const c of creators) {
      growthByCreator.set(c.id, buildMonthlyGrowth(byCreator.get(c.id) ?? []));
    }
  }

  // (c) Alerts unresolved.
  let alertQuery = supabase
    .from("platform_alerts")
    .select("id, alert_type, mcn_creator_id, shop_id, detail, created_at")
    .eq("resolved", false)
    .order("created_at", { ascending: false });
  if (isStaffCM) alertQuery = alertQuery.eq("target_member_id", me!.id);
  const { data: alertsRaw } = await alertQuery;
  const alerts = (alertsRaw as Alert[] | null) ?? [];

  // (d) Creator requests.
  let reqQuery = supabase
    .from("creator_requests")
    .select(
      "id, code, mcn_creator_id, type, target_brand, detail, status, needs_approval, approved_by, created_at"
    )
    .order("created_at", { ascending: false });
  if (isStaffCM) reqQuery = reqQuery.in("mcn_creator_id", creatorIds.length ? creatorIds : ["-"]);
  const { data: reqRaw } = await reqQuery;
  const requests = (reqRaw as CreatorRequest[] | null) ?? [];
  const approvalQueue = requests.filter((r) => r.needs_approval && !r.approved_by);

  // (e) Special Project aktif (read-only).
  const { data: projRaw } = await supabase
    .from("v_project_summary")
    .select(
      "id, code, name, status, creators_assigned, creators_cm, creators_acquisition, creators_needed, merchant_count, actual_gmv, target_gmv, pct_gmv"
    )
    .eq("status", "active");
  const projects = (projRaw as ProjectSummary[] | null) ?? [];

  return (
    <>
      <h1>CM Workspace</h1>
      <p className="page-sub">
        Bulan berjalan: <strong>{ym}</strong>{" "}
        {isStaffCM && <span className="badge slate">scope: kreator saya</span>}
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20 }}>
        <Link className="btn-ghost sm" href={`/mcn/workspace?month=${prevYM}`}>
          ← {prevYM}
        </Link>
        <strong>{ym}</strong>
        <Link className="btn-ghost sm" href={`/mcn/workspace?month=${nextYM}`}>
          {nextYM} →
        </Link>
        {ym !== curYM && (
          <Link className="sm" href={`/mcn/workspace?month=${curYM}`}>
            Ke bulan berjalan ({curYM})
          </Link>
        )}
      </div>

      <div className="card">
        <h2>Upload Data Mingguan</h2>
        <p className="section-sub">
          Window W1-W5 dicek otomatis dari kolom tanggal file. Data mentah tidak disimpan — hanya
          3 agregat hasil olah.
        </p>
        <IngestForm />
      </div>

      <div className="card">
        <h2>Growth W1-W5 — {ym}</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kreator</th>
                <th className="right">W1</th>
                <th className="right">W2</th>
                <th className="right">W3</th>
                <th className="right">W4</th>
                <th className="right">W5</th>
                <th className="right">Month Growth</th>
              </tr>
            </thead>
            <tbody>
              {creators.map((c) => {
                const g = growthByCreator.get(c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      {c.code ?? "—"} · {c.name}
                    </td>
                    {(g?.weeks ?? []).map((w) => (
                      <td key={w.week} className="right">
                        {w.value === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <>
                            {rupiah(w.value)}
                            {w.delta !== null && (
                              <div style={{ fontSize: 11, color: w.delta >= 0 ? "#15803d" : "#b91c1c" }}>
                                {w.delta >= 0 ? "+" : ""}
                                {rupiah(w.delta)}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    ))}
                    <td className="right">
                      {g?.monthGrowth !== null && g?.monthGrowth !== undefined ? (
                        <span className={g.monthGrowth >= 0 ? "badge green" : "badge red"}>
                          {(g.monthGrowth * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {creators.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Tidak ada kreator dalam scope Anda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Alert Belum Diselesaikan ({alerts.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Tipe</th>
              <th>Kreator</th>
              <th>Detail</th>
              <th>Tanggal</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id}>
                <td>
                  <span className="badge amber">{a.alert_type}</span>
                </td>
                <td>{a.mcn_creator_id ? creatorName.get(a.mcn_creator_id) ?? "—" : a.shop_id ?? "—"}</td>
                <td className="mono" style={{ fontSize: 11 }}>
                  {a.detail ? JSON.stringify(a.detail) : "—"}
                </td>
                <td className="muted">{tanggal(a.created_at)}</td>
              </tr>
            ))}
            {alerts.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Tidak ada alert aktif.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Request Kreator</h2>
        <CreateRequestForm creators={creators} />
        <table style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Kreator</th>
              <th>Tipe</th>
              <th>Target Brand</th>
              <th>Status</th>
              <th>Approval</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.code ?? "—"}</td>
                <td>{creatorName.get(r.mcn_creator_id) ?? "—"}</td>
                <td className="muted">{r.type}</td>
                <td className="muted">{r.target_brand ?? "—"}</td>
                <td>
                  <span className="badge slate">{r.status}</span>
                </td>
                <td>
                  {!r.needs_approval ? (
                    <span className="muted">tidak perlu</span>
                  ) : r.approved_by ? (
                    <span className="badge green">disetujui</span>
                  ) : (
                    <span className="badge amber">menunggu Director</span>
                  )}
                </td>
                <td>
                  <RequestProgressControls id={r.id} status={r.status} />
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Belum ada request.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!!me?.is_director && (
        <div className="card">
          <h2>Antrean Approval Director ({approvalQueue.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Kreator</th>
                <th>Detail</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {approvalQueue.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.code ?? "—"}</td>
                  <td>{creatorName.get(r.mcn_creator_id) ?? "—"}</td>
                  <td className="muted">{r.detail ?? "—"}</td>
                  <td>
                    <ApproveRequestButton id={r.id} />
                  </td>
                </tr>
              ))}
              {approvalQueue.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Tidak ada request menunggu approval.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Special Project Aktif</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Kreator (cm/akuisisi/butuh)</th>
              <th>Merchant</th>
              <th className="right">GMV Aktual / Target</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.code ?? "—"}</td>
                <td>{p.name}</td>
                <td className="muted">
                  {p.creators_cm}/{p.creators_acquisition}/{p.creators_needed}
                </td>
                <td className="muted">{p.merchant_count}</td>
                <td className="right">
                  {rupiah(p.actual_gmv)} / {rupiah(p.target_gmv)}
                  {p.pct_gmv !== null && (
                    <div style={{ fontSize: 11, color: "#64748b" }}>{p.pct_gmv}%</div>
                  )}
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Tidak ada special project aktif.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
