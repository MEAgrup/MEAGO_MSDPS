import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { rupiah, tanggal } from "@/lib/format";
import { GenerateSkorButton } from "./forms";

// M15 Management Dashboard (Director/OD): health semua merchant (At Risk dulu),
// attainment OKR kuartal berjalan, ranking performa tim. Read-only + drill-through.

type Row = {
  merchant_id: string;
  merchant_code: string | null;
  merchant_name: string;
  am_name: string | null;
  snapshot_code: string | null;
  week_start: string | null;
  composite_score: number | null;
  band: string | null;
  trend: string | null;
  trend_driver: string | null;
  gmv_value: number | null;
  gmv_estimated: boolean | null;
  briefs_active: number;
  briefs_blocked: number;
  briefs_overdue: number;
  blocks_pending: number;
  complaints_open: number;
  band_rank: number | null;
};
type Okr = {
  period: string;
  role: string;
  metric: string;
  target_value: number;
  comparator: string;
  actual_value: number | null;
  attainment_pct: number | null;
};
type Perf = {
  code: string;
  staff_name: string;
  role: string;
  week_start: string;
  composite_score: number;
  trend: string;
};
type Monthly = {
  code: string;
  merchant_id: string;
  period: string;
  avg_score: number;
  eom_band: string;
  monthly_trend: string;
  total_gmv: number | null;
  gmv_estimated: boolean;
  total_complaints: number;
};

const BAND_BADGE: Record<string, string> = {
  Healthy: "green",
  Watch: "amber",
  "At Risk": "red",
};

export default async function ManagementPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  if (!(me?.is_od || me?.is_director)) redirect("/dashboard");

  const supabase = await getCachedClient();
  const [{ data: rows }, { data: okr }, { data: perf }, { data: monthly }] = await Promise.all([
    supabase
      .from("v_management_dashboard")
      .select(
        "merchant_id, merchant_code, merchant_name, am_name, snapshot_code, week_start, composite_score, band, trend, trend_driver, gmv_value, gmv_estimated, briefs_active, briefs_blocked, briefs_overdue, blocks_pending, complaints_open, band_rank"
      )
      .order("band_rank", { ascending: true, nullsFirst: false })
      .order("composite_score", { ascending: true }),
    supabase
      .from("v_okr_attainment")
      .select("period, role, metric, target_value, comparator, actual_value, attainment_pct")
      .order("role")
      .order("metric"),
    supabase
      .from("v_team_portal_performance")
      .select("code, staff_name, role, week_start, composite_score, trend")
      .order("week_start", { ascending: false })
      .order("composite_score", { ascending: false })
      .limit(20),
    supabase
      .from("merchant_health_monthly")
      .select(
        "code, merchant_id, period, avg_score, eom_band, monthly_trend, total_gmv, gmv_estimated, total_complaints"
      )
      .order("period", { ascending: false })
      .limit(24),
  ]);

  const mList = (rows as Row[] | null) ?? [];
  const oList = (okr as Okr[] | null) ?? [];
  const pList = (perf as Perf[] | null) ?? [];
  const hList = (monthly as Monthly[] | null) ?? [];
  const atRisk = mList.filter((m) => m.band === "At Risk").length;

  return (
    <>
      <h1>Management Dashboard</h1>
      <p className="page-sub">
        Overview seluruh merchant (M13) — At Risk muncul paling atas. Snapshot dihitung otomatis
        tiap Senin 00:30 WIB; skor performa 00:45. Read-only: intervensi lewat modul asal /{" "}
        <Link href="/board">Merchant Board</Link>.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Merchant</div>
          <div className="v">{mList.length}</div>
        </div>
        <div className="stat">
          <div className="k">At Risk</div>
          <div className="v">{atRisk}</div>
        </div>
        <div className="stat">
          <div className="k">Block pending</div>
          <div className="v">{mList.reduce((a, m) => a + m.blocks_pending, 0)}</div>
        </div>
        <div className="stat">
          <div className="k">Komplain open</div>
          <div className="v">{mList.reduce((a, m) => a + m.complaints_open, 0)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Kesehatan Merchant</h2>
        <GenerateSkorButton />
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>AM</th>
              <th>Skor</th>
              <th>Band</th>
              <th>Tren</th>
              <th>Penggerak</th>
              <th>GMV (bulan)</th>
              <th>Brief aktif</th>
              <th>Blocked</th>
              <th>Overdue</th>
              <th>Komplain</th>
              <th>Board</th>
            </tr>
          </thead>
          <tbody>
            {mList.map((m) => (
              <tr key={m.merchant_id}>
                <td>
                  {m.merchant_name} <span style={{ color: "#94a3b8" }}>{m.merchant_code}</span>
                </td>
                <td>{m.am_name ?? "—"}</td>
                <td>
                  <strong>{m.composite_score ?? "—"}</strong>
                </td>
                <td>
                  {m.band ? (
                    <span className={`badge ${BAND_BADGE[m.band] ?? "gray"}`}>{m.band}</span>
                  ) : (
                    <span className="badge gray">Belum ada snapshot</span>
                  )}
                </td>
                <td>{m.trend ?? "—"}</td>
                <td>{m.trend_driver ?? "—"}</td>
                <td>
                  {rupiah(m.gmv_value)}
                  {m.gmv_estimated ? " (est.)" : ""}
                </td>
                <td>{m.briefs_active}</td>
                <td>{m.briefs_blocked > 0 ? <span className="badge red">{m.briefs_blocked}</span> : 0}</td>
                <td>{m.briefs_overdue > 0 ? <span className="badge amber">{m.briefs_overdue}</span> : 0}</td>
                <td>{m.complaints_open}</td>
                <td>
                  <Link className="btn-ghost sm" href={`/board?merchant=${m.merchant_id}`}>
                    Buka board
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Ringkasan Bulanan (bahan laporan merchant)</h2>
        {hList.length === 0 ? (
          <p>Belum ada ringkasan bulanan (dihitung otomatis awal bulan).</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Periode</th>
                <th>Rata-rata skor</th>
                <th>Band akhir bulan</th>
                <th>Tren</th>
                <th>Total GMV</th>
                <th>Komplain</th>
              </tr>
            </thead>
            <tbody>
              {hList.map((h) => (
                <tr key={h.code}>
                  <td>{h.code}</td>
                  <td>{h.period}</td>
                  <td>{Number(h.avg_score)}</td>
                  <td>
                    <span className={`badge ${BAND_BADGE[h.eom_band] ?? "gray"}`}>{h.eom_band}</span>
                  </td>
                  <td>{h.monthly_trend}</td>
                  <td>
                    {rupiah(h.total_gmv)}
                    {h.gmv_estimated ? " (est.)" : ""}
                  </td>
                  <td>{h.total_complaints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>OKR Attainment (kuartal berjalan)</h2>
        <p style={{ marginTop: -4 }}>
          <Link className="btn-ghost sm" href="/okr">
            Atur target OKR per section →
          </Link>
        </p>
        <table>
          <thead>
            <tr>
              <th>Periode</th>
              <th>Role</th>
              <th>Metrik</th>
              <th>Target</th>
              <th>Aktual</th>
              <th>Attainment</th>
            </tr>
          </thead>
          <tbody>
            {oList.map((o, i) => (
              <tr key={i}>
                <td>{o.period}</td>
                <td>{o.role}</td>
                <td>{o.metric}</td>
                <td>
                  {o.comparator === "lte" ? "≤" : "≥"} {Number(o.target_value)}
                </td>
                <td>{o.actual_value ?? "—"}</td>
                <td>
                  <span
                    className={`badge ${
                      Number(o.attainment_pct ?? 0) >= 100
                        ? "green"
                        : Number(o.attainment_pct ?? 0) >= 60
                          ? "amber"
                          : "red"
                    }`}
                  >
                    {o.attainment_pct ?? 0}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Ranking Performa Tim (terbaru)</h2>
        {pList.length === 0 ? (
          <p>Belum ada skor performa.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Staff</th>
                <th>Role</th>
                <th>Minggu</th>
                <th>Skor</th>
                <th>Tren</th>
              </tr>
            </thead>
            <tbody>
              {pList.map((p, i) => (
                <tr key={p.code}>
                  <td>{i + 1}</td>
                  <td>{p.staff_name}</td>
                  <td>{p.role}</td>
                  <td>{tanggal(p.week_start)}</td>
                  <td>
                    <strong>{Number(p.composite_score)}</strong>
                  </td>
                  <td>{p.trend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
