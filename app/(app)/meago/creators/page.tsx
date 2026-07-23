import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { rupiah, tanggal } from "@/lib/format";
import { formatYMD } from "@/lib/mcn/weeks";
import { AssignOwnerRow, BudgetCapRow, EditCreatorModal, PortalAccountRow, ProfileRow, RosterToggleRow } from "./forms";
import { UploadReportForm, DeleteReportButton } from "./report-forms";
import { IngestForm } from "../ingest-form";
import { createAdminClient } from "@/lib/supabase/admin";

type Creator = {
  id: string;
  code: string | null;
  name: string;
  platform: string | null;
  username: string | null;
  city: string | null;
  niche: string | null;
  jenis_creator: string | null;
  creator_level: string | null;
  binding_status: string | null;
  status: string;
  status_kontrak: string | null;
  gmv: number | null;
  gmv_live: number | null;
  gmv_video: number | null;
  commission_share: number | null;
  owner_cpm_id: string | null;
  live_roster: boolean;
  ads_budget_cap: number | null;
  notes: string | null;
  top_niches: unknown;
  auth_user_id: string | null;
  created_at: string | null;
  status_changed_by: string | null;
  status_changed_at: string | null;
};

const STATUS_KONTRAK_BADGE: Record<string, { cls: string; label: string }> = {
  kontrak: { cls: "green", label: "Kontrak" },
  "non kontrak": { cls: "slate", label: "Non Kontrak" },
};

const BINDING_BADGE: Record<string, { cls: string; label: string }> = {
  "Bound creators": { cls: "green", label: "Bounded" },
  "Previously bound creators": { cls: "red", label: "Prev. Bounded" },
};

// creator_period_summary — kolom yang dipakai utk rata-rata bulanan 3 bulan terakhir.
type SummaryRow = {
  mcn_creator_id: string;
  period_start: string; // YMD
  created_at: string;
  affiliate_gmv: number | null;
  redemption_amount: number | null;
  new_posts: number | null;
  posts_with_sales: number | null;
  live_streams: number | null;
  valid_live_streams: number | null;
};

const METRIC_KEYS = [
  "affiliate_gmv",
  "redemption_amount",
  "new_posts",
  "posts_with_sales",
  "live_streams",
  "valid_live_streams",
] as const;
type MetricKey = (typeof METRIC_KEYS)[number];

type MonthlyMetricAverages = {
  avgPayGmv: number | null; // dari affiliate_gmv
  redeemedGmv: number | null; // dari redemption_amount
  totalPost: number | null; // dari new_posts
  postsWithSales: number | null;
  liveStream: number | null; // dari live_streams
  validLiveStream: number | null; // dari valid_live_streams
};

const EMPTY_AVERAGES: MonthlyMetricAverages = {
  avgPayGmv: null,
  redeemedGmv: null,
  totalPost: null,
  postsWithSales: null,
  liveStream: null,
  validLiveStream: null,
};

// Rata-rata BULANAN 3 bulan kalender terakhir (bulan berjalan + 2 sebelumnya) utk SATU
// creator. Caller sudah memfilter `rows` ke creator + rentang tanggal yang relevan.
// - Dedupe per period_start: created_at terbaru menang.
// - Group by bulan (period_start.slice(0,7)); jumlahkan per bulan per metrik (baris
//   dgn nilai null di-skip dari sum metrik itu; bulan yg SEMUA nilainya null utk metrik
//   itu = bulan tanpa data utk metrik itu).
// - Rata-rata = sum-bulanan dibagi JUMLAH BULAN YANG PUNYA DATA utk metrik tsb. Tidak
//   ada data sama sekali → null (BUKAN 0).
function build3MonthAverages(rows: SummaryRow[]): MonthlyMetricAverages {
  const byPeriod = new Map<string, SummaryRow>();
  for (const r of rows) {
    const existing = byPeriod.get(r.period_start);
    if (!existing || r.created_at > existing.created_at) byPeriod.set(r.period_start, r);
  }

  type MonthAcc = Record<MetricKey, { sum: number; has: boolean }>;
  const monthAcc = new Map<string, MonthAcc>();
  for (const row of byPeriod.values()) {
    const month = row.period_start.slice(0, 7);
    let acc = monthAcc.get(month);
    if (!acc) {
      acc = {
        affiliate_gmv: { sum: 0, has: false },
        redemption_amount: { sum: 0, has: false },
        new_posts: { sum: 0, has: false },
        posts_with_sales: { sum: 0, has: false },
        live_streams: { sum: 0, has: false },
        valid_live_streams: { sum: 0, has: false },
      };
      monthAcc.set(month, acc);
    }
    for (const key of METRIC_KEYS) {
      const v = row[key];
      if (v !== null) {
        acc[key].sum += v;
        acc[key].has = true;
      }
    }
  }

  const average = (key: MetricKey): number | null => {
    let sum = 0;
    let count = 0;
    for (const acc of monthAcc.values()) {
      if (acc[key].has) {
        sum += acc[key].sum;
        count += 1;
      }
    }
    return count > 0 ? sum / count : null;
  };

  return {
    avgPayGmv: average("affiliate_gmv"),
    redeemedGmv: average("redemption_amount"),
    totalPost: average("new_posts"),
    postsWithSales: average("posts_with_sales"),
    liveStream: average("live_streams"),
    validLiveStream: average("valid_live_streams"),
  };
}

// Format angka aktivitas (bukan rupiah) — boleh 1 desimal (mis. rata-rata "12.5").
function num1(n: number | null): string {
  if (n === null) return "—";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(n);
}

// creator_reports (portal F.2) — daftar report terbaru utk kartu "Report Kreator".
type ReportRow = { id: string; mcn_creator_id: string; title: string; created_at: string };

export default async function McnCreatorsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || ["CreatorManagement", "BizDev", "Acquisition", "KOL"].includes(div);
  if (!canView) redirect("/dashboard");

  // Lead Creator Growth = lead divisi CreatorManagement. Management (OD/Director) selalu boleh.
  const canAssignOwner = mgmt || (div === "CreatorManagement" && me?.rank === "lead");

  // Gate card "Budget Cap Ads & Roster Live" — mengikuti policy RLS mcn_creators_update.
  // BizDev & KOL tidak melihat card ini.
  const canManageOps = mgmt || div === "Acquisition" || div === "CreatorManagement";

  const supabase = await getCachedClient();

  // Kartu "Report Kreator" (portal F.2): gate mengikuti RLS insert creator_reports
  // (0312) — hanya CreatorManagement + mgmt (Acquisition/BizDev/KOL tidak insert).
  const isLeadCM = div === "CreatorManagement" && me?.rank === "lead";
  const canReportCreator = mgmt || div === "CreatorManagement";

  // Daftar CM aktif (divisi CreatorManagement) — dipakai di dropdown assign owner.
  // Hanya di-fetch bila section-nya bakal dirender (canAssignOwner).
  const cmEmployeesQuery =
    canAssignOwner || canManageOps
      ? supabase
          .from("employees")
          .select("id, full_name, rank")
          .eq("division", "CreatorManagement")
          .eq("active", true)
          .order("full_name", { ascending: true })
      : Promise.resolve({ data: [] as { id: string; full_name: string; rank: string }[] });

  // Kartu report hanya di-fetch bila bakal dirender (canReportCreator).
  const reportsQuery = canReportCreator
    ? supabase
        .from("creator_reports")
        .select("id, mcn_creator_id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(30)
    : Promise.resolve({ data: [] as ReportRow[] });

  // Stage 1: query yang saling independen di-fetch paralel (satu round-trip).
  const [
    { data: creatorsRaw },
    { data: emps },
    { data: cmEmpsRaw },
    { data: reportsRaw },
  ] = await Promise.all([
    supabase
      .from("mcn_creators")
      .select(
        "id, code, name, platform, username, city, niche, jenis_creator, creator_level, binding_status, status, status_kontrak, gmv, gmv_live, gmv_video, commission_share, owner_cpm_id, live_roster, ads_budget_cap, notes, top_niches, auth_user_id, created_at, status_changed_by, status_changed_at"
      )
      .order("name", { ascending: true }),
    supabase.from("employees").select("id, full_name"),
    cmEmployeesQuery,
    reportsQuery,
  ]);

  const creators = (creatorsRaw as Creator[] | null) ?? [];
  const creatorIds = creators.map((c) => c.id);

  // Baris yang ditampilkan di card ops: lead CM/Acquisition/management lihat semua;
  // CM staff hanya lihat kreator miliknya sendiri (mencegah kegagalan RLS yang
  // membingungkan saat mereka mencoba mengubah kreator milik CM lain).
  const canManageAllOps =
    mgmt || div === "Acquisition" || (div === "CreatorManagement" && me?.rank === "lead");
  const opsCreators = canManageAllOps
    ? creators
    : creators.filter((c) => c.owner_cpm_id === me?.id);

  const empName = new Map(
    ((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name])
  );

  const cmEmployees = (cmEmpsRaw as { id: string; full_name: string; rank: string }[] | null) ?? [];

  // Dropdown kreator: staff CM hanya kreator miliknya (RLS insert scope owner), Lead
  // CM & mgmt lintas kreator.
  const reportCreators = mgmt || isLeadCM ? creators : creators.filter((c) => c.owner_cpm_id === me?.id);
  const creatorNameById = new Map(
    creators.map((c) => [c.id, `${c.code ?? "(draft)"} · ${c.name}`])
  );
  const reports = (reportsRaw as ReportRow[] | null) ?? [];

  // Boundary bulan berjalan + 2 sebelumnya (hari-1 bulan M-2). Pakai `new Date()` tanpa
  // argumen (wall-clock sekarang) — BUKAN new Date(isoString), jadi aman dari pergeseran
  // timezone yang dilarang untuk date-only math (lihat lib/mcn/weeks.ts).
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  let boundaryYear = curYear;
  let boundaryMonth = curMonth - 2;
  if (boundaryMonth <= 0) {
    boundaryMonth += 12;
    boundaryYear -= 1;
  }
  const boundaryStart = formatYMD(boundaryYear, boundaryMonth, 1);

  // Stage 2: query turunan yang bergantung pada daftar kreator — summary (creatorIds)
  // & email akun portal (creators) saling independen → paralel.
  const summaryPromise =
    creatorIds.length > 0
      ? supabase
          .from("creator_period_summary")
          .select(
            "mcn_creator_id, period_start, created_at, affiliate_gmv, redemption_amount, new_posts, posts_with_sales, live_streams, valid_live_streams"
          )
          .in("mcn_creator_id", creatorIds)
          .gte("period_start", boundaryStart)
      : Promise.resolve({ data: null as SummaryRow[] | null });

  // Email akun portal untuk kreator yang sudah punya auth_user_id (service-role,
  // server-only). Hanya di-fetch bila card "Akun Portal Kreator" bakal dirender.
  const accountEmail = new Map<string, string>();
  const emailPromise = canAssignOwner
    ? (async () => {
        // Jangan biarkan lookup email menjatuhkan render (mis. service key belum diset
        // di environment) — kolom email cukup tampil "—".
        try {
          const admin = createAdminClient();
          const linked = creators.filter((c) => c.auth_user_id);
          await Promise.all(
            linked.map(async (c) => {
              const { data } = await admin.auth.admin.getUserById(c.auth_user_id as string);
              if (data?.user?.email) accountEmail.set(c.id, data.user.email);
            })
          );
        } catch (err) {
          console.error("[creators] lookup email akun portal gagal:", err);
        }
      })()
    : Promise.resolve();

  const [summaryRes] = await Promise.all([summaryPromise, emailPromise]);

  const averagesByCreator = new Map<string, MonthlyMetricAverages>();
  if (creatorIds.length > 0) {
    const rows = (summaryRes.data as SummaryRow[] | null) ?? [];
    const byCreator = new Map<string, SummaryRow[]>();
    for (const r of rows) {
      const arr = byCreator.get(r.mcn_creator_id) ?? [];
      arr.push(r);
      byCreator.set(r.mcn_creator_id, arr);
    }
    for (const c of creators) {
      averagesByCreator.set(c.id, build3MonthAverages(byCreator.get(c.id) ?? []));
    }
  }

  return (
    <>
      <h1>Data Kreator Meago</h1>
      <p className="page-sub">
        Master kreator affiliate TikTok — terpisah dari master KOL (M9). Kolom GMV & aktivitas
        adalah rata-rata bulanan 3 bulan kalender terakhir (bulan berjalan + 2 sebelumnya).
      </p>

      <div className="card">
        <h2>Upload Data Mingguan</h2>
        <p className="section-sub">
          File XLSX Creator Analysis. Window periode dicek otomatis dari kolom tanggal file.
        </p>
        <IngestForm />
      </div>

      <div className="card">
        <h2>Master Kreator ({creators.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Nama</th>
                <th>Username</th>
                <th>CM</th>
                <th>Status</th>
                <th>Industry</th>
                <th>Jenis</th>
                <th>Level</th>
                <th className="right">Avg Pay GMV</th>
                <th className="right">Redeemed GMV</th>
                <th>Komisi</th>
                <th className="right">Total post</th>
                <th className="right">Posts with sales</th>
                <th className="right">Live stream</th>
                <th className="right">Valid live stream</th>
                <th>Roster Live</th>
                <th>Kontrak</th>
                {canManageOps && <th>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {creators.map((c) => {
                const avg = averagesByCreator.get(c.id) ?? EMPTY_AVERAGES;
                const binding = c.binding_status ? BINDING_BADGE[c.binding_status] : null;
                return (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      {c.code && <div className="mono muted" style={{ fontSize: 11 }}>{c.code}</div>}
                    </td>
                    <td className="mono">{c.username ?? "—"}</td>
                    <td>{empName.get(c.owner_cpm_id ?? "") ?? <span className="muted">—</span>}</td>
                    <td>
                      {c.binding_status ? (
                        <span className={`badge ${binding?.cls ?? "gray"}`}>
                          {binding?.label ?? c.binding_status}
                        </span>
                      ) : (
                        <span className="muted">Unbounded</span>
                      )}
                    </td>
                    <td className="muted">{c.niche ?? "—"}</td>
                    <td className="muted">{c.jenis_creator ?? "—"}</td>
                    <td>
                      {c.creator_level ? (
                        <span className="badge slate">{c.creator_level}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="right">{rupiah(avg.avgPayGmv)}</td>
                    <td className="right">{rupiah(avg.redeemedGmv)}</td>
                    <td className="muted">
                      {c.commission_share !== null ? `${c.commission_share}%` : "—"}
                    </td>
                    <td className="right">{num1(avg.totalPost)}</td>
                    <td className="right">{num1(avg.postsWithSales)}</td>
                    <td className="right">{num1(avg.liveStream)}</td>
                    <td className="right">{num1(avg.validLiveStream)}</td>
                    <td>
                      {c.live_roster ? (
                        <span className="badge green">Roster</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {c.status_kontrak ? (
                        <span className={`badge ${STATUS_KONTRAK_BADGE[c.status_kontrak]?.cls ?? "gray"}`}>
                          {STATUS_KONTRAK_BADGE[c.status_kontrak]?.label ?? c.status_kontrak}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {canManageOps && (
                      <td>
                        <EditCreatorModal creator={c} cmOptions={cmEmployees} />
                      </td>
                    )}
                  </tr>
                );
              })}
              {creators.length === 0 && (
                <tr>
                  <td colSpan={canManageOps ? 17 : 16} className="muted">
                    Belum ada kreator terdaftar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canAssignOwner && (
        <div className="card">
          <h2>Assign CM / CPM</h2>
          <p className="section-sub">
            Tetapkan atau lepas CM/CPM penanggung jawab per kreator. Hanya Lead Creator Growth
            dan management yang bisa mengubah.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  <th>Username</th>
                  <th>CM Saat Ini</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {creators.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.code ?? "—"}</td>
                    <td>{c.name}</td>
                    <td className="mono">{c.username ?? "—"}</td>
                    <td>{empName.get(c.owner_cpm_id ?? "") ?? <span className="muted">—</span>}</td>
                    <td>
                      <AssignOwnerRow
                        creatorId={c.id}
                        currentOwnerId={c.owner_cpm_id}
                        cmOptions={cmEmployees}
                      />
                    </td>
                  </tr>
                ))}
                {creators.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Belum ada kreator terdaftar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canAssignOwner && (
        <div className="card">
          <h2>Akun Portal Kreator</h2>
          <p className="section-sub">
            Buat akun login portal /kreator untuk kreator (tidak ada pendaftaran mandiri).
            Hanya CM Lead / OD / Director. Kreator memakai email &amp; password ini untuk masuk.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  <th>Akun Portal</th>
                </tr>
              </thead>
              <tbody>
                {creators.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.code ?? "—"}</td>
                    <td>{c.name}</td>
                    <td>
                      {c.auth_user_id ? (
                        <span>
                          <span className="badge green">Akun portal aktif</span>{" "}
                          <span className="mono muted">{accountEmail.get(c.id) ?? "—"}</span>
                        </span>
                      ) : (
                        <PortalAccountRow creatorId={c.id} />
                      )}
                    </td>
                  </tr>
                ))}
                {creators.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      Belum ada kreator terdaftar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canManageOps && (
        <div className="card">
          <h2>Kelola Kreator — Profil, Budget Cap Ads & Roster Live</h2>
          <p className="section-sub">
            Atur batas budget ads per kreator (dipakai gate approval request ads) dan
            keanggotaan roster live. CM staff hanya bisa mengubah kreator miliknya. Jenis &amp;
            Industry diisi manual di sini — fase auto-fill dari export konten video dibatalkan.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  <th>Jenis & Industry</th>
                  <th>Budget Cap Ads</th>
                  <th>Roster Live</th>
                  <th>Status Roster</th>
                </tr>
              </thead>
              <tbody>
                {opsCreators.map((c) => (
                  <tr key={c.id}>
                    <td className="mono">{c.code ?? "—"}</td>
                    <td>{c.name}</td>
                    <td>
                      <ProfileRow
                        creatorId={c.id}
                        currentJenis={c.jenis_creator}
                        currentNiche={c.niche}
                      />
                    </td>
                    <td>
                      <BudgetCapRow creatorId={c.id} currentCap={c.ads_budget_cap} />
                    </td>
                    <td>
                      <RosterToggleRow creatorId={c.id} inRoster={c.live_roster} />
                    </td>
                    <td>
                      {c.live_roster ? (
                        <span className="badge green">Roster</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {opsCreators.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Tidak ada kreator yang bisa Anda kelola.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canReportCreator && (
        <div className="card">
          <h2>Report Kreator</h2>
          <p className="section-sub">
            Unggah file report untuk kreator (dibaca kreator ybs di portal /kreator/report).
            Staff CM hanya bisa mengunggah untuk kreator miliknya; Lead CM &amp; management
            lintas kreator.
          </p>
          <UploadReportForm creators={reportCreators} />
          <div style={{ overflowX: "auto", marginTop: 16 }}>
            <table>
              <thead>
                <tr>
                  <th>Kreator</th>
                  <th>Judul</th>
                  <th>Tanggal</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td>{creatorNameById.get(r.mcn_creator_id) ?? "—"}</td>
                    <td>{r.title}</td>
                    <td className="muted">{tanggal(r.created_at)}</td>
                    <td>
                      <DeleteReportButton reportId={r.id} />
                    </td>
                  </tr>
                ))}
                {reports.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Belum ada report diunggah.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
