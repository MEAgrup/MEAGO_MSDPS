import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { rupiah, num, tanggal } from "@/lib/format";
import { projectBadge, todayJakartaYMD } from "@/lib/mcn/project-status";
import { requestTypeLabel } from "@/lib/mcn/request-types";
import {
  buildMonthlyGrowth,
  daysInMonth,
  formatYMD,
  w1w5WindowsOf,
  type GrowthRow,
} from "@/lib/mcn/weeks";
import {
  IngestForm,
  CreateRequestForm,
  ApproveRequestButton,
  RequestProgressControls,
} from "./forms";
import { ComplaintProgressControls } from "./complaint-actions";

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
  target_merchant_id: string | null;
  nominal: number | null;
  detail: string | null;
  status: string;
  needs_approval: boolean;
  approved_by: string | null;
  created_at: string;
};
// creator_period_summary lengkap (growth + detail mingguan Creator Analysis) —
// reuse satu fetch utk kedua card, dedupe per (creator, period_start) sendiri di sini
// (dedupeLatestByPeriod di lib/mcn/weeks tidak diexport, jadi direplikasi lokal).
type SummaryRow = GrowthRow & {
  mcn_creator_id: string;
  orders: number | null;
  aov: number | null;
  redemption_amount: number | null;
  redeemed_orders: number | null;
  new_posts: number | null;
  posts_with_sales: number | null;
  live_streams: number | null;
  valid_live_streams: number | null;
};

// creator_complaints (portal F.2) — antrian "Komplain Kreator".
type Complaint = {
  id: string;
  code: string | null;
  mcn_creator_id: string;
  subject: string | null;
  body: string;
  status: string;
  created_at: string;
};

const COMPLAINT_STATUS_CLASS: Record<string, string> = {
  baru: "amber",
  diproses: "slate",
  selesai: "green",
};

type ProjectSummary = {
  id: string;
  code: string | null;
  name: string;
  status: string;
  start_date: string;
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
  searchParams: Promise<{ month?: string; week?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();

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

  const supabase = await getCachedClient();

  // Scope CPM: staff CM hanya lihat kreator miliknya (RLS juga menegakkan; UI ikut supaya jelas).
  let creatorQuery = supabase
    .from("mcn_creators")
    .select("id, name, code, owner_cpm_id")
    .order("name", { ascending: true });
  if (isStaffCM) creatorQuery = creatorQuery.eq("owner_cpm_id", me!.id);

  // (c) Alerts unresolved.
  let alertQuery = supabase
    .from("platform_alerts")
    .select("id, alert_type, mcn_creator_id, shop_id, detail, created_at")
    .eq("resolved", false)
    .order("created_at", { ascending: false });
  if (isStaffCM) alertQuery = alertQuery.eq("target_member_id", me!.id);

  // Stage 1: semua query yang saling independen di-fetch paralel (satu round-trip).
  const [
    { data: creatorsRaw },
    { data: allCreatorsRaw },
    { data: alertsRaw },
    { data: complaintsRaw },
    { data: projRaw },
  ] = await Promise.all([
    creatorQuery,
    supabase.from("mcn_creators").select("id, name, code"),
    alertQuery,
    // (d.1) Komplain Kreator — RLS creator_complaints_select_internal (0312) sudah
    // menyaring baris (staff CM hanya kreator miliknya, Lead CM lintas, mgmt semua).
    supabase
      .from("creator_complaints")
      .select("id, code, mcn_creator_id, subject, body, status, created_at")
      .order("created_at", { ascending: false }),
    // (e) Special Project (read-only): semua kecuali cancelled — project yang belum
    // mulai tampil sebagai [Persiapan] (keputusan QA 2026-07-17).
    supabase
      .from("v_project_summary")
      .select(
        "id, code, name, status, start_date, creators_assigned, creators_cm, creators_acquisition, creators_needed, merchant_count, actual_gmv, target_gmv, pct_gmv"
      )
      .neq("status", "cancelled")
      .order("start_date", { ascending: false }),
  ]);

  const creators = (creatorsRaw as CreatorRow[] | null) ?? [];
  const creatorIds = creators.map((c) => c.id);

  const creatorName = new Map<string, string>(
    ((allCreatorsRaw as { id: string; name: string; code: string | null }[] | null) ?? []).map(
      (c) => [c.id, `${c.code ?? "(draft)"} · ${c.name}`]
    )
  );

  // (d) Creator requests — bergantung creatorIds saat isStaffCM.
  let reqQuery = supabase
    .from("creator_requests")
    .select(
      "id, code, mcn_creator_id, type, target_brand, target_merchant_id, nominal, detail, status, needs_approval, approved_by, created_at"
    )
    .order("created_at", { ascending: false });
  if (isStaffCM) reqQuery = reqQuery.in("mcn_creator_id", creatorIds.length ? creatorIds : ["-"]);

  // (b) Growth W1-W5 + Detail Mingguan (Creator Analysis) — satu fetch, dua tampilan.
  const growthByCreator = new Map<string, ReturnType<typeof buildMonthlyGrowth>>();
  // Map<creatorId, Map<period_start, SummaryRow>> — sudah dedupe created_at terbaru.
  const dedupedByCreator = new Map<string, Map<string, SummaryRow>>();

  // Stage 2: query yang bergantung pada creatorIds — summary & requests saling independen.
  const [summaryRes, { data: reqRaw }] = await Promise.all([
    creatorIds.length > 0
      ? supabase
          .from("creator_period_summary")
          .select(
            "mcn_creator_id, period_start, created_at, affiliate_gmv, orders, aov, redemption_amount, redeemed_orders, new_posts, posts_with_sales, live_streams, valid_live_streams"
          )
          .in("mcn_creator_id", creatorIds)
          .gte("period_start", monthStart)
          .lte("period_start", monthEnd)
      : Promise.resolve({ data: null as SummaryRow[] | null }),
    reqQuery,
  ]);

  if (creatorIds.length > 0) {
    const rows = (summaryRes.data as SummaryRow[] | null) ?? [];
    const byCreator = new Map<string, SummaryRow[]>();
    for (const r of rows) {
      const arr = byCreator.get(r.mcn_creator_id) ?? [];
      arr.push(r);
      byCreator.set(r.mcn_creator_id, arr);
    }
    for (const c of creators) {
      const creatorRows = byCreator.get(c.id) ?? [];
      growthByCreator.set(c.id, buildMonthlyGrowth(creatorRows));

      // Dedupe per period_start — created_at terbaru menang (pola sama seperti
      // dedupeLatestByPeriod di lib/mcn/weeks.ts).
      const byPeriod = new Map<string, SummaryRow>();
      for (const r of creatorRows) {
        const existing = byPeriod.get(r.period_start);
        if (!existing || r.created_at > existing.created_at) byPeriod.set(r.period_start, r);
      }
      dedupedByCreator.set(c.id, byPeriod);
    }
  }

  // Window W1-W5 dari lib/mcn/weeks (JANGAN hitung tanggal manual / new Date(iso)).
  const weekWindows = w1w5WindowsOf(ymYear, ymMonth);
  const weekHasData = weekWindows.map((w) =>
    creators.some((c) => dedupedByCreator.get(c.id)?.has(w.start))
  );
  let defaultWeekIndex = 1;
  for (let i = weekHasData.length - 1; i >= 0; i--) {
    if (weekHasData[i]) {
      defaultWeekIndex = i + 1;
      break;
    }
  }
  const weekParamMatch = sp.week ? /^W([1-5])$/.exec(sp.week) : null;
  const weekParamNum = weekParamMatch ? Number(weekParamMatch[1]) : null;
  const weekIndex =
    weekParamNum && weekParamNum <= weekWindows.length ? weekParamNum : defaultWeekIndex;
  const selectedWeekWindow = weekWindows[weekIndex - 1];

  const alerts = (alertsRaw as Alert[] | null) ?? [];

  const requests = (reqRaw as CreatorRequest[] | null) ?? [];
  const approvalQueue = requests.filter((r) => r.needs_approval && !r.approved_by);

  // Nama merchant target (free_meal/visit) untuk antrian approval Director. merchants
  // RLS (0102) hanya BizDev/Account/Finance/mgmt — aman karena kartu approval hanya
  // tampil untuk Director (is_director() lolos RLS merchants juga).
  const approvalMerchantIds = Array.from(
    new Set(approvalQueue.map((r) => r.target_merchant_id).filter((id): id is string => !!id))
  );
  let merchantName = new Map<string, string>();
  if (approvalMerchantIds.length > 0) {
    const { data: merchRaw } = await supabase
      .from("merchants")
      .select("id, nama_toko")
      .in("id", approvalMerchantIds);
    merchantName = new Map(
      ((merchRaw as { id: string; nama_toko: string }[] | null) ?? []).map((m) => [m.id, m.nama_toko])
    );
  }

  const allComplaints = (complaintsRaw as Complaint[] | null) ?? [];
  // Urutan tampil: baru dulu, lalu diproses, selesai paling bawah (masing-masing
  // kelompok diurutkan terbaru dulu); selesai disembunyikan bila lebih dari 20.
  const COMPLAINT_STATUS_ORDER: Record<string, number> = { baru: 0, diproses: 1, selesai: 2 };
  const sortedComplaints = [...allComplaints].sort((a, b) => {
    const oa = COMPLAINT_STATUS_ORDER[a.status] ?? 3;
    const ob = COMPLAINT_STATUS_ORDER[b.status] ?? 3;
    if (oa !== ob) return oa - ob;
    return b.created_at.localeCompare(a.created_at);
  });
  let selesaiSeen = 0;
  const complaints = sortedComplaints.filter((c) => {
    if (c.status !== "selesai") return true;
    selesaiSeen++;
    return selesaiSeen <= 20;
  });

  const projects = (projRaw as ProjectSummary[] | null) ?? [];
  const todayYMD = todayJakartaYMD();

  return (
    <>
      <h1>CM Workspace</h1>
      <p className="page-sub">
        Bulan berjalan: <strong>{ym}</strong>{" "}
        {isStaffCM && <span className="badge slate">scope: kreator saya</span>}
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20 }}>
        <Link className="btn-ghost sm" href={`/meago/workspace?month=${prevYM}`}>
          ← {prevYM}
        </Link>
        <strong>{ym}</strong>
        <Link className="btn-ghost sm" href={`/meago/workspace?month=${nextYM}`}>
          {nextYM} →
        </Link>
        {ym !== curYM && (
          <Link className="sm" href={`/meago/workspace?month=${curYM}`}>
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
        <h2>Detail Mingguan — {ym}</h2>
        <p className="section-sub">
          Data Creator Analysis per minggu (window W1-W5, W1: {weekWindows[0].start} s/d{" "}
          {weekWindows[0].end}, dst).
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {weekWindows.map((w, i) => {
            const wn = i + 1;
            const active = wn === weekIndex;
            return (
              <Link
                key={wn}
                className={active ? "btn sm" : "btn-ghost sm"}
                href={`/meago/workspace?month=${ym}&week=W${wn}`}
              >
                W{wn}
              </Link>
            );
          })}
        </div>
        <p className="section-sub">
          Periode terpilih: {selectedWeekWindow.start} s/d {selectedWeekWindow.end}
        </p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kreator</th>
                <th className="right">Sales</th>
                <th className="right">Redemption</th>
                <th className="right">Orders</th>
                <th className="right">AOV</th>
                <th className="right">Posts</th>
                <th className="right">LIVE</th>
              </tr>
            </thead>
            <tbody>
              {creators.map((c) => {
                const row = dedupedByCreator.get(c.id)?.get(selectedWeekWindow.start);
                return (
                  <tr key={c.id}>
                    <td>
                      {c.code ?? "—"} · {c.name}
                    </td>
                    <td className="right">
                      {row?.affiliate_gmv != null ? (
                        rupiah(row.affiliate_gmv)
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="right">
                      {row?.redemption_amount != null ? (
                        <>
                          {rupiah(row.redemption_amount)}
                          {row.redeemed_orders != null && (
                            <div style={{ fontSize: 11, color: "#64748b" }}>
                              {num(row.redeemed_orders)} order
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="right">
                      {row?.orders != null ? num(row.orders) : <span className="muted">—</span>}
                    </td>
                    <td className="right">
                      {row?.aov != null ? rupiah(row.aov) : <span className="muted">—</span>}
                    </td>
                    <td className="right">
                      {row && (row.new_posts != null || row.posts_with_sales != null) ? (
                        `${row.new_posts ?? "—"}/${row.posts_with_sales ?? "—"}`
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="right">
                      {row && (row.live_streams != null || row.valid_live_streams != null) ? (
                        `${row.live_streams ?? "—"}/${row.valid_live_streams ?? "—"}`
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
        <h2>Komplain Kreator ({complaints.length})</h2>
        <p className="section-sub">
          Antrian komplain &amp; feedback dari kreator. Staff CM hanya melihat kreator
          miliknya, Lead CM &amp; management lintas kreator. Komplain selesai lebih dari 20
          disembunyikan.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Kreator</th>
                <th>Subjek</th>
                <th>Isi</th>
                <th>Status</th>
                <th>Tanggal</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code ?? "—"}</td>
                  <td>{creatorName.get(c.mcn_creator_id) ?? "—"}</td>
                  <td className="muted">{c.subject ?? "—"}</td>
                  <td className="muted" style={{ maxWidth: 260 }}>
                    {c.body}
                  </td>
                  <td>
                    <span className={`badge ${COMPLAINT_STATUS_CLASS[c.status] ?? "gray"}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="muted">{tanggal(c.created_at)}</td>
                  <td>
                    <ComplaintProgressControls id={c.id} status={c.status} />
                  </td>
                </tr>
              ))}
              {complaints.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Tidak ada komplain.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
                <td className="muted">{requestTypeLabel(r.type)}</td>
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
                <th>Jenis</th>
                <th>Target</th>
                <th className="right">Nominal</th>
                <th>Detail</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {approvalQueue.map((r) => {
                const target = r.target_merchant_id
                  ? merchantName.get(r.target_merchant_id) ?? "—"
                  : r.target_brand ?? "—";
                return (
                  <tr key={r.id}>
                    <td className="mono">{r.code ?? "—"}</td>
                    <td>{creatorName.get(r.mcn_creator_id) ?? "—"}</td>
                    <td className="muted">{requestTypeLabel(r.type)}</td>
                    <td className="muted">{target}</td>
                    <td className="right">{r.nominal !== null ? rupiah(r.nominal) : "—"}</td>
                    <td className="muted">{r.detail ?? "—"}</td>
                    <td>
                      <ApproveRequestButton id={r.id} />
                    </td>
                  </tr>
                );
              })}
              {approvalQueue.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Tidak ada request menunggu approval.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Special Project</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Status</th>
              <th>Kreator (cm/akuisisi/butuh)</th>
              <th>Merchant</th>
              <th className="right">GMV Aktual / Target</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const b = projectBadge(p.status, p.start_date, todayYMD);
              return (
              <tr key={p.id}>
                <td className="mono">{p.code ?? "—"}</td>
                <td>{p.name}</td>
                <td>
                  <span className={`badge ${b.cls}`}>{b.label}</span>
                </td>
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
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Belum ada special project.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
