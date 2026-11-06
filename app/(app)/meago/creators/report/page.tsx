// /meago/creators/report — Report Kreator Bulanan OTOMATIS (permintaan Rizal, ACC Yohan
// 2026-11-06). Disusun dari data yang sudah diunggah CM — tanpa input tambahan:
// performa All mingguan (creator_period_summary), GMV per kategori (0383), dan GMV Video
// (creator_video_gmv). Melengkapi — bukan menggantikan — upload file report manual di
// kartu "Report Kreator" /meago/creators. Hasilnya bisa dicetak/PDF atau diunduh Excel
// lalu diunggah lewat kartu tsb bila perlu dibaca kreator di portal.

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { rupiah, num } from "@/lib/format";
import { daysInMonth, formatYMD } from "@/lib/mcn/weeks";
import { GMV_CATEGORIES, type GmvSubCategory } from "@/lib/mcn/gmv-category";
import {
  buildCreatorMonthlyReport,
  type ReportCategoryRow,
  type ReportSummaryRow,
  type ReportVideoRow,
} from "@/lib/mcn/creator-monthly-report";
import { ReportActions } from "./report-actions";

const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const SUB_CATS = GMV_CATEGORIES.filter((c) => c.key !== "all");

type Creator = {
  id: string;
  code: string | null;
  name: string;
  username: string | null;
  owner_cpm_id: string | null;
  niche: string | null;
  creator_level: string | null;
  city: string | null;
};

function Dash() {
  return <span className="muted">—</span>;
}
const rp = (v: number | null | undefined) => (v === null || v === undefined ? <Dash /> : rupiah(v));
const n = (v: number | null | undefined) => (v === null || v === undefined ? <Dash /> : num(v));

export default async function CreatorMonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ creator?: string; month?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();
  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  // Gate = kartu "Report Kreator" (/meago/creators): CreatorManagement + management.
  if (!(mgmt || div === "CreatorManagement")) redirect("/dashboard");
  const isStaffCM = div === "CreatorManagement" && me?.rank === "staff" && !mgmt;

  const sp = await searchParams;
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const ym = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : curYM;
  const [year, month] = ym.split("-").map(Number);
  const monthStart = `${ym}-01`;
  const monthEnd = formatYMD(year, month, daysInMonth(year, month));
  const creatorId = sp.creator && /^[0-9a-f-]{36}$/i.test(sp.creator) ? sp.creator : null;

  const back = (
    <p>
      <Link href="/meago/creators">← Kembali ke Kreator</Link>
    </p>
  );
  if (!creatorId) {
    return (
      <>
        <h1>Report Kreator Bulanan</h1>
        {back}
        <div className="card">
          <p className="muted">Pilih kreator &amp; bulan dari kartu &ldquo;Report Kreator&rdquo; di halaman Kreator.</p>
        </div>
      </>
    );
  }

  const supabase = await getCachedClient();
  const [{ data: creatorRaw }, { data: summaryRaw }, { data: catRaw }, { data: videoRaw }] = await Promise.all([
    supabase
      .from("mcn_creators")
      .select("id, code, name, username, owner_cpm_id, niche, creator_level, city")
      .eq("id", creatorId)
      .maybeSingle(),
    supabase
      .from("creator_period_summary")
      .select(
        "period_start, created_at, affiliate_gmv, orders, aov, redemption_amount, redeemed_orders, new_posts, posts_with_sales, live_streams, valid_live_streams"
      )
      .eq("mcn_creator_id", creatorId)
      .gte("period_start", monthStart)
      .lte("period_start", monthEnd),
    supabase
      .from("creator_period_category_summary")
      .select("category, period_start, created_at, affiliate_gmv")
      .eq("mcn_creator_id", creatorId)
      .gte("period_start", monthStart)
      .lte("period_start", monthEnd),
    supabase
      .from("creator_video_gmv")
      .select("video_id, video_title, period_start, views, likes, sales_value, orders")
      .eq("creator_id", creatorId)
      .gte("period_start", monthStart)
      .lte("period_start", monthEnd),
  ]);

  const creator = creatorRaw as Creator | null;
  // Staff CM hanya kreator miliknya (sama dengan scope upload report manual).
  if (!creator || (isStaffCM && creator.owner_cpm_id !== me?.id)) {
    return (
      <>
        <h1>Report Kreator Bulanan</h1>
        {back}
        <div className="card">
          <p className="err">Kreator tidak ditemukan atau bukan kreator milikmu.</p>
        </div>
      </>
    );
  }

  let cmName: string | null = null;
  if (creator.owner_cpm_id) {
    const { data: emp } = await supabase
      .from("employees")
      .select("full_name")
      .eq("id", creator.owner_cpm_id)
      .maybeSingle();
    cmName = (emp as { full_name: string } | null)?.full_name ?? null;
  }

  const report = buildCreatorMonthlyReport({
    year,
    month,
    summary: (summaryRaw as ReportSummaryRow[] | null) ?? [],
    categories: (catRaw as ReportCategoryRow[] | null) ?? [],
    videos: (videoRaw as ReportVideoRow[] | null) ?? [],
  });
  const t = report.totals;
  const hasCategory = SUB_CATS.some((c) => t.categoryGmv[c.key as GmvSubCategory] !== null);
  const monthLabel = `${MONTH_NAMES_ID[month - 1]} ${year}`;

  const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const href = (m: string) => `/meago/creators/report?creator=${creator.id}&month=${m}`;

  // Baris Excel: satu baris per minggu + baris Total (kolom sama dengan tabel di layar).
  const excelRows: Record<string, unknown>[] = [
    ...report.weeks.map((w) => ({
      Minggu: `W${w.week}`,
      Periode: `${w.window.start} s/d ${w.window.end}`,
      "GMV (All)": w.summary?.affiliate_gmv ?? null,
      Orders: w.summary?.orders ?? null,
      AOV: w.summary?.aov ?? null,
      Redemption: w.summary?.redemption_amount ?? null,
      "Redeemed Orders": w.summary?.redeemed_orders ?? null,
      "Post Baru": w.summary?.new_posts ?? null,
      "Post Ber-sales": w.summary?.posts_with_sales ?? null,
      LIVE: w.summary?.live_streams ?? null,
      "LIVE Valid": w.summary?.valid_live_streams ?? null,
      ...Object.fromEntries(SUB_CATS.map((c) => [`GMV ${c.label}`, w.categoryGmv[c.key as GmvSubCategory]])),
      "Jumlah Video": w.video?.videos ?? null,
      "Views Video": w.video?.views ?? null,
      "GMV Video": w.video?.gmv ?? null,
      "Orders Video": w.video?.orders ?? null,
    })),
    {
      Minggu: "TOTAL",
      Periode: monthLabel,
      "GMV (All)": t.gmv,
      Orders: t.orders,
      AOV: t.aov,
      Redemption: t.redemption,
      "Redeemed Orders": t.redeemedOrders,
      "Post Baru": t.newPosts,
      "Post Ber-sales": t.postsWithSales,
      LIVE: t.liveStreams,
      "LIVE Valid": t.validLiveStreams,
      ...Object.fromEntries(SUB_CATS.map((c) => [`GMV ${c.label}`, t.categoryGmv[c.key as GmvSubCategory]])),
      "Jumlah Video": t.video?.videos ?? null,
      "Views Video": t.video?.views ?? null,
      "GMV Video": t.video?.gmv ?? null,
      "Orders Video": t.video?.orders ?? null,
    },
  ];
  const fileSlug = (creator.username ?? creator.code ?? creator.id).replace(/[^\w.-]+/g, "_");

  return (
    <>
      <h1>Report Kreator Bulanan</h1>
      <div className="no-print">{back}</div>
      <p className="page-sub">
        <strong>
          {creator.code ?? "(draft)"} · {creator.name}
        </strong>
        {creator.username && <> · @{creator.username.replace(/^@+/, "")}</>} — {monthLabel}
      </p>
      <div className="no-print" style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Link className="btn-ghost sm" href={href(prev)}>
          ← {prev}
        </Link>
        <strong>{ym}</strong>
        <Link className="btn-ghost sm" href={href(next)}>
          {next} →
        </Link>
        <ReportActions filename={`report-${fileSlug}-${ym}`} rows={excelRows} />
      </div>

      <div className="card">
        <h2>Ringkasan Bulan</h2>
        <p className="section-sub">
          CM: {cmName ?? "—"} · Industri: {creator.niche ?? "—"} · Level: {creator.creator_level ?? "—"} · Kota:{" "}
          {creator.city ?? "—"} · Minggu terisi: {t.weeksWithData}/{report.weeks.length}
        </p>
        <div style={{ overflowX: "auto" }}>
          <table>
            <tbody>
              <tr><td>GMV (All)</td><td className="right"><strong>{rp(t.gmv)}</strong></td></tr>
              <tr><td>Orders</td><td className="right">{n(t.orders)}</td></tr>
              <tr><td>AOV bulan (GMV ÷ Orders)</td><td className="right">{rp(t.aov)}</td></tr>
              <tr><td>Redemption</td><td className="right">{rp(t.redemption)} {t.redeemedOrders !== null && <span className="muted">({num(t.redeemedOrders)} order)</span>}</td></tr>
              <tr><td>Post baru / ber-sales</td><td className="right">{n(t.newPosts)} / {n(t.postsWithSales)}</td></tr>
              <tr><td>LIVE / valid</td><td className="right">{n(t.liveStreams)} / {n(t.validLiveStreams)}</td></tr>
              <tr><td>GMV Video ({t.video ? `${num(t.video.videos)} video-minggu` : "belum ada data"})</td><td className="right">{rp(t.video?.gmv)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Detail Mingguan (W1-W5)</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Minggu</th>
                <th className="right">GMV (All)</th>
                <th className="right">Orders</th>
                <th className="right">AOV</th>
                <th className="right">Redemption</th>
                <th className="right">Posts</th>
                <th className="right">LIVE</th>
              </tr>
            </thead>
            <tbody>
              {report.weeks.map((w) => (
                <tr key={w.week}>
                  <td>
                    W{w.week}
                    <div className="muted" style={{ fontSize: 11 }}>
                      {w.window.start} s/d {w.window.end}
                    </div>
                  </td>
                  <td className="right">{rp(w.summary?.affiliate_gmv)}</td>
                  <td className="right">{n(w.summary?.orders)}</td>
                  <td className="right">{rp(w.summary?.aov)}</td>
                  <td className="right">{rp(w.summary?.redemption_amount)}</td>
                  <td className="right">
                    {w.summary ? `${w.summary.new_posts ?? "—"}/${w.summary.posts_with_sales ?? "—"}` : <Dash />}
                  </td>
                  <td className="right">
                    {w.summary ? `${w.summary.live_streams ?? "—"}/${w.summary.valid_live_streams ?? "—"}` : <Dash />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>— = minggu itu belum diunggah (bukan nol).</p>
      </div>

      <div className="card">
        <h2>GMV per Kategori</h2>
        {!hasCategory ? (
          <p className="muted">
            Belum ada file kategori (Dining/Accommodation/TTD/LIVE) diunggah untuk bulan ini. Unggah lewat
            &ldquo;Upload Data Mingguan&rdquo; dengan memilih kategori.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Kategori</th>
                  {report.weeks.map((w) => (
                    <th key={w.week} className="right">W{w.week}</th>
                  ))}
                  <th className="right">Total</th>
                </tr>
              </thead>
              <tbody>
                {SUB_CATS.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    {report.weeks.map((w) => (
                      <td key={w.week} className="right">{rp(w.categoryGmv[c.key as GmvSubCategory])}</td>
                    ))}
                    <td className="right"><strong>{rp(t.categoryGmv[c.key as GmvSubCategory])}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>GMV Video</h2>
        {!t.video ? (
          <p className="muted">
            Belum ada data GMV Video bulan ini. Unggah di <Link href="/meago/gmv-video">GMV Video Mingguan</Link> —
            bagian ini terisi otomatis sesudahnya.
          </p>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Minggu</th>
                    <th className="right">Video</th>
                    <th className="right">Views</th>
                    <th className="right">Likes</th>
                    <th className="right">GMV</th>
                    <th className="right">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {report.weeks.map((w) => (
                    <tr key={w.week}>
                      <td>W{w.week}</td>
                      <td className="right">{n(w.video?.videos)}</td>
                      <td className="right">{n(w.video?.views)}</td>
                      <td className="right">{n(w.video?.likes)}</td>
                      <td className="right">{rp(w.video?.gmv)}</td>
                      <td className="right">{n(w.video?.orders)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 style={{ marginTop: 16 }}>Video Terlaris Bulan Ini (Top {report.topVideos.length})</h3>
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Video</th>
                    <th className="right">Minggu</th>
                    <th className="right">Views</th>
                    <th className="right">GMV</th>
                    <th className="right">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topVideos.map((v) => (
                    <tr key={v.video_id}>
                      <td>
                        {v.video_title ?? <span className="muted">(tanpa judul)</span>}
                        <div className="muted mono" style={{ fontSize: 11 }}>{v.video_id}</div>
                      </td>
                      <td className="right">{num(v.weeks)}</td>
                      <td className="right">{num(v.views)}</td>
                      <td className="right">{rupiah(v.gmv)}</td>
                      <td className="right">{num(v.orders)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
