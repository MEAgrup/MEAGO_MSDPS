import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { durasi, tanggal } from "@/lib/format";
import { AjukanBlockForm, PutuskanBlockForms, ResumeBriefButton } from "./forms";

// M15 Team Portal (internal): My Tasks (M11) + My Performance (M14) +
// block-request saya + antrian approve SPV/Lead (M12) + Speed Score (M12).
// Tidak ada aksi eksekusi baru selain alur block M12 — aksi lain di modul asal.

type Task = {
  brief_id: string;
  brief_code: string | null;
  merchant_name: string;
  division: string;
  service_type: string;
  brief_status: string;
  kanban_column: string;
  completion_pct: number | null;
  due_date: string | null;
  units_done: number;
  units_total: number;
  flag_overdue: boolean;
  flag_blocked: boolean;
  flag_pending_block: boolean;
  work_time_seconds: number;
  timer_started_at: string | null;
  assigned_pic: string | null;
};
type Perf = {
  code: string;
  staff_id: string;
  staff_name: string;
  role: string;
  week_start: string;
  composite_score: number;
  output_component: number | null;
  speed_component: number | null;
  quality_component: number | null;
  trend: string;
};
type Blk = {
  id: string;
  code: string;
  status: string;
  reason: string;
  created_at: string;
  requested_by: string;
  requested_by_name: string | null;
  approver_name: string | null;
  brief_code: string | null;
  brief_id: string;
  division: string;
  brief_status: string;
  blocked_from: string | null;
  blocked_to: string | null;
};
type Speed = {
  kind: string;
  brief_code: string | null;
  unit_code: string | null;
  staff_name: string | null;
  sla_working_days: number;
  elapsed_working_days: number;
  blocked_working_days: number;
  deadline_date: string | null;
  speed_score: string;
};

const SPEED_BADGE: Record<string, string> = {
  "[On-Time]": "green",
  "[Slight Delay]": "amber",
  "[Late]": "red",
  "[Berjalan]": "slate",
  "[Berjalan - Lewat SLA]": "red",
  "[Belum Mulai]": "gray",
};

export default async function PortalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("employees")
    .select("id, full_name, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  const mgmt = !!(me?.is_od || me?.is_director);
  const isLead = me?.rank === "lead" || mgmt;

  const [{ data: tasks }, { data: perf }, { data: blocks }, { data: speed }] = await Promise.all([
    supabase
      .from("v_team_portal_tasks")
      .select(
        "brief_id, brief_code, merchant_name, division, service_type, brief_status, kanban_column, completion_pct, due_date, units_done, units_total, flag_overdue, flag_blocked, flag_pending_block, work_time_seconds, timer_started_at, assigned_pic"
      )
      .order("brief_code"),
    supabase
      .from("v_team_portal_performance")
      .select(
        "code, staff_id, staff_name, role, week_start, composite_score, output_component, speed_component, quality_component, trend"
      )
      .order("week_start", { ascending: false })
      .order("composite_score", { ascending: false })
      .limit(50),
    supabase
      .from("v_team_portal_blocks")
      .select(
        "id, code, status, reason, created_at, requested_by, requested_by_name, approver_name, brief_code, brief_id, division, brief_status, blocked_from, blocked_to"
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("v_speed_score")
      .select(
        "kind, brief_code, unit_code, staff_name, sla_working_days, elapsed_working_days, blocked_working_days, deadline_date, speed_score"
      )
      .order("brief_code"),
  ]);

  const tList = (tasks as Task[] | null) ?? [];
  const pList = (perf as Perf[] | null) ?? [];
  const bList = (blocks as Blk[] | null) ?? [];
  const sList = (speed as Speed[] | null) ?? [];
  const pendingQueue = bList.filter((b) => b.status === "[Pending]");
  const myPerf = pList.filter((p) => p.staff_id === me?.id);
  const aktif = tList.filter((t) => t.kanban_column !== "[Completed]");

  return (
    <>
      <h1>Team Portal</h1>
      <p className="page-sub">
        Satu tempat untuk tugas saya (M11), skor performa (M14), dan block request (M12).
        Aksi eksekusi tetap di modul divisi — lihat papan lengkap di{" "}
        <Link href="/board">Merchant Board</Link>.
      </p>

      {/* Antrian approval block — hanya relevan untuk SPV/Lead/OD/Director */}
      {isLead && pendingQueue.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: "4px solid #d97706" }}>
          <h2>Antrian Approval Block ({pendingQueue.length})</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Brief</th>
                <th>Divisi</th>
                <th>Pemohon</th>
                <th>Alasan</th>
                <th>Keputusan</th>
              </tr>
            </thead>
            <tbody>
              {pendingQueue.map((b) => (
                <tr key={b.id}>
                  <td>{b.code}</td>
                  <td>{b.brief_code}</td>
                  <td>{b.division}</td>
                  <td>{b.requested_by_name ?? "—"}</td>
                  <td>{b.reason}</td>
                  <td>
                    <PutuskanBlockForms blockId={b.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Tugas Saya ({aktif.length} aktif)</h2>
        {tList.length === 0 ? (
          <p>Tidak ada tugas untuk Anda saat ini.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Brief</th>
                <th>Merchant</th>
                <th>Divisi</th>
                <th>Kolom</th>
                <th>Progress</th>
                <th>Due</th>
                <th>⏱</th>
                <th>Block</th>
              </tr>
            </thead>
            <tbody>
              {tList.map((t) => {
                let sec = Number(t.work_time_seconds);
                if (t.timer_started_at) {
                  sec += Math.max(0, (Date.now() - new Date(t.timer_started_at).getTime()) / 1000);
                }
                const bisaAjukan =
                  t.assigned_pic === me?.id &&
                  ["[In Progress]", "[Overdue]"].includes(t.brief_status) &&
                  !t.flag_pending_block;
                return (
                  <tr key={t.brief_id}>
                    <td>{t.brief_code}</td>
                    <td>{t.merchant_name}</td>
                    <td>{t.division}</td>
                    <td>
                      <span
                        className={`badge ${
                          t.kanban_column === "[Blocked]"
                            ? "red"
                            : t.kanban_column === "[Completed]"
                              ? "green"
                              : "slate"
                        }`}
                      >
                        {t.kanban_column}
                      </span>{" "}
                      {t.flag_overdue && <span className="badge red">Overdue</span>}
                    </td>
                    <td>
                      {t.units_done}/{t.units_total} · {Number(t.completion_pct ?? 0)}%
                    </td>
                    <td>{tanggal(t.due_date)}</td>
                    <td>
                      {durasi(sec)}
                      {t.timer_started_at ? " · berjalan" : ""}
                    </td>
                    <td>
                      {bisaAjukan && <AjukanBlockForm briefId={t.brief_id} />}
                      {t.flag_pending_block && <span className="badge amber">Menunggu SPV</span>}
                      {t.flag_blocked && <ResumeBriefButton briefId={t.brief_id} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Skor Performa {isLead ? "(tim)" : "(saya)"}</h2>
        <p className="page-sub">
          Derived otomatis tiap Senin: Output 40% / Speed 30% / Quality 30%, ternormalisasi vs
          target role — skor rendah = bahan coaching, bukan penalti otomatis.
        </p>
        {(isLead ? pList : myPerf).length === 0 ? (
          <p>Belum ada skor (dihitung otomatis tiap Senin, atau belum ada aktivitas terukur).</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Minggu</th>
                <th>Staff</th>
                <th>Role</th>
                <th>Skor</th>
                <th>Output</th>
                <th>Speed</th>
                <th>Quality</th>
                <th>Tren</th>
              </tr>
            </thead>
            <tbody>
              {(isLead ? pList : myPerf).map((p) => (
                <tr key={p.code}>
                  <td>{tanggal(p.week_start)}</td>
                  <td>{p.staff_name}</td>
                  <td>{p.role}</td>
                  <td>
                    <strong>{Number(p.composite_score)}</strong>
                  </td>
                  <td>{p.output_component ?? "—"}</td>
                  <td>{p.speed_component ?? "—"}</td>
                  <td>{p.quality_component ?? "—"}</td>
                  <td>{p.trend}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Speed Score / SLA</h2>
        <p className="page-sub">
          SLA hari kerja: E-com 3 hk/20 SKU (pro-rata) · Ads 6 hk ke go-live · KOL 5 hk ·
          Live Stream start 3 hk. Waktu [Blocked] yang di-approve tidak dihitung.
        </p>
        <table>
          <thead>
            <tr>
              <th>Jenis</th>
              <th>Brief/Unit</th>
              <th>Staff</th>
              <th>SLA (hk)</th>
              <th>Terpakai (hk)</th>
              <th>Blocked (hk)</th>
              <th>Deadline</th>
              <th>Speed</th>
            </tr>
          </thead>
          <tbody>
            {sList.map((s, i) => (
              <tr key={i}>
                <td>{s.kind}</td>
                <td>
                  {s.brief_code}
                  {s.unit_code ? ` · ${s.unit_code}` : ""}
                </td>
                <td>{s.staff_name ?? "—"}</td>
                <td>{Number(s.sla_working_days)}</td>
                <td>{s.elapsed_working_days}</td>
                <td>{s.blocked_working_days}</td>
                <td>{tanggal(s.deadline_date)}</td>
                <td>
                  <span className={`badge ${SPEED_BADGE[s.speed_score] ?? "gray"}`}>
                    {s.speed_score}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Block Request Saya / Divisi</h2>
        {bList.length === 0 ? (
          <p>Belum ada block request.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Brief</th>
                <th>Alasan</th>
                <th>Status</th>
                <th>Pemohon</th>
                <th>Diputuskan oleh</th>
                <th>Rentang blocked</th>
              </tr>
            </thead>
            <tbody>
              {bList.map((b) => (
                <tr key={b.id}>
                  <td>{b.code}</td>
                  <td>{b.brief_code}</td>
                  <td>{b.reason}</td>
                  <td>
                    <span
                      className={`badge ${
                        b.status === "[Approved]"
                          ? "red"
                          : b.status === "[Pending]"
                            ? "amber"
                            : "gray"
                      }`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td>{b.requested_by_name ?? "—"}</td>
                  <td>{b.approver_name ?? "—"}</td>
                  <td>
                    {b.blocked_from
                      ? `${tanggal(b.blocked_from)} → ${b.blocked_to ? tanggal(b.blocked_to) : "masih blocked"}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
