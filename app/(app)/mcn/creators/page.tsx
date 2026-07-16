import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rupiah } from "@/lib/format";
import { formatYMD } from "@/lib/mcn/weeks";
import { AddCreatorForm } from "./forms";
import { IngestForm } from "../ingest-form";

type Creator = {
  id: string;
  code: string | null;
  name: string;
  username: string | null;
  niche: string | null;
  jenis_creator: string | null;
  creator_level: string | null;
  binding_status: string | null;
  commission_share: number | null;
  owner_cpm_id: string | null;
  live_roster: boolean;
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

export default async function McnCreatorsPage() {
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
  const canView = mgmt || ["CreatorManagement", "BizDev", "Acquisition", "KOL"].includes(div);
  if (!canView) redirect("/dashboard");

  const canAddProspect = mgmt || div === "CreatorManagement" || div === "Acquisition";

  const { data: creatorsRaw } = await supabase
    .from("mcn_creators")
    .select(
      "id, code, name, username, niche, jenis_creator, creator_level, binding_status, commission_share, owner_cpm_id, live_roster"
    )
    .order("name", { ascending: true });
  const creators = (creatorsRaw as Creator[] | null) ?? [];
  const creatorIds = creators.map((c) => c.id);

  const { data: emps } = await supabase.from("employees").select("id, full_name");
  const empName = new Map(
    ((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name])
  );

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

  const averagesByCreator = new Map<string, MonthlyMetricAverages>();
  if (creatorIds.length > 0) {
    const { data: summaryRaw } = await supabase
      .from("creator_period_summary")
      .select(
        "mcn_creator_id, period_start, created_at, affiliate_gmv, redemption_amount, new_posts, posts_with_sales, live_streams, valid_live_streams"
      )
      .in("mcn_creator_id", creatorIds)
      .gte("period_start", boundaryStart);
    const rows = (summaryRaw as SummaryRow[] | null) ?? [];
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
      <h1>Data Kreator MCN</h1>
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
                  </tr>
                );
              })}
              {creators.length === 0 && (
                <tr>
                  <td colSpan={15} className="muted">
                    Belum ada kreator terdaftar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canAddProspect && (
        <div className="card">
          <h2>Daftarkan Prospek Baru</h2>
          <AddCreatorForm />
        </div>
      )}
    </>
  );
}
