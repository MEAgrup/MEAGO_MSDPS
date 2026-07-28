// /meago/gmv-video — GMV Video Weekly Tracking. Upload file GMV per-video mingguan
// (jalur terpisah dari "Upload Data Mingguan" di /meago/creators yang mengisi
// creator_period_summary) + riwayat mingguan per kreator dari creator_video_gmv.
//
// Riwayat TIDAK ditimpa antar minggu: satu baris per (kreator, video, period_start),
// jadi minggu lama tetap utuh saat minggu baru diunggah. Tabel di bawah menampilkan
// agregat per kreator per minggu (bukan per video) supaya ringkas; kolom "Video"
// adalah jumlah video pada minggu tersebut.

import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { rupiah, num } from "@/lib/format";
import { VideoGmvForm } from "./upload-form";

type Creator = { id: string; code: string | null; name: string; username: string | null; owner_cpm_id: string | null };

type VideoRow = {
  creator_id: string;
  video_id: string;
  period_start: string;
  period_end: string;
  views: number | null;
  likes: number | null;
  sales_value: number | null;
  orders: number | null;
};

// Agregat per (kreator, minggu) — dipakai baris tabel riwayat.
type WeekAgg = {
  creatorId: string;
  periodStart: string;
  periodEnd: string;
  videos: number;
  views: number;
  likes: number;
  gmv: number;
  orders: number;
};

// Kelompokkan baris per-video menjadi agregat per (kreator, period_start). Nilai null
// dihitung sebagai 0 pada penjumlahan (kolom numerik tabel default 0 di DB), namun
// jumlah video tetap dihitung dari baris yang ada.
function aggregateByCreatorWeek(rows: VideoRow[]): WeekAgg[] {
  const byKey = new Map<string, WeekAgg>();
  for (const r of rows) {
    const key = `${r.creator_id}|${r.period_start}`;
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        creatorId: r.creator_id,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        videos: 0,
        views: 0,
        likes: 0,
        gmv: 0,
        orders: 0,
      };
      byKey.set(key, acc);
    }
    acc.videos += 1;
    acc.views += Number(r.views ?? 0);
    acc.likes += Number(r.likes ?? 0);
    acc.gmv += Number(r.sales_value ?? 0);
    acc.orders += Number(r.orders ?? 0);
  }
  // Minggu terbaru dulu; dalam minggu yang sama, GMV terbesar dulu.
  return [...byKey.values()].sort((a, b) =>
    a.periodStart === b.periodStart ? b.gmv - a.gmv : b.periodStart < a.periodStart ? -1 : 1
  );
}

export default async function GmvVideoPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  // Gate sama dengan /meago/creators (halaman ini bagian dari alur CM Kreator).
  const canView = mgmt || ["CreatorManagement", "BizDev", "Acquisition", "KOL"].includes(div);
  if (!canView) redirect("/dashboard");

  const supabase = await getCachedClient();

  const [{ data: creatorsRaw }, { data: empsRaw }, { data: videoRaw }] = await Promise.all([
    supabase
      .from("mcn_creators")
      .select("id, code, name, username, owner_cpm_id")
      .order("name", { ascending: true }),
    supabase.from("employees").select("id, full_name"),
    supabase
      .from("creator_video_gmv")
      .select("creator_id, video_id, period_start, period_end, views, likes, sales_value, orders")
      .order("period_start", { ascending: false })
      .limit(5000),
  ]);

  const creators = (creatorsRaw as Creator[] | null) ?? [];
  const creatorById = new Map(creators.map((c) => [c.id, c]));
  // Nama CM (owner_cpm_id → employees.full_name) — inilah "auto-lookup CM" pada tampilan;
  // ingest tidak menyalin nama CM ke baris video, cukup ikut master kreator.
  const empName = new Map(
    ((empsRaw as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name])
  );
  const rows = (videoRaw as VideoRow[] | null) ?? [];
  const weeks = aggregateByCreatorWeek(rows);

  // Daftar minggu unik (untuk ringkasan di atas tabel).
  const distinctWeeks = [...new Set(weeks.map((w) => w.periodStart))].sort().reverse();

  return (
    <>
      <h1>GMV Video Mingguan</h1>
      <p className="page-sub">
        Pelacakan GMV per video per minggu. Nama CM diambil otomatis dari master kreator
        (pencocokan lewat username/Creator ID) — kreator yang belum ada di master dibuat
        otomatis dan dilaporkan di ringkasan upload.
      </p>

      <div className="card">
        <h2>Upload GMV Video Mingguan</h2>
        <p className="section-sub">
          File XLSX/CSV export video TikTok. Window periode dicek otomatis dari file
          (W1–W5, tidak boleh lintas bulan). Header kolom divalidasi ketat — bila format
          export berubah, upload ditolak dengan menyebut nama kolom yang bermasalah.
        </p>
        <VideoGmvForm />
      </div>

      <div className="card">
        <h2>
          Riwayat Mingguan ({weeks.length} baris · {distinctWeeks.length} minggu)
        </h2>
        <p className="section-sub">
          Satu baris per kreator per minggu. Minggu sebelumnya tidak ditimpa saat minggu
          baru diunggah.
        </p>
        {weeks.length === 0 ? (
          <p className="muted">Belum ada data GMV video. Unggah file mingguan di atas.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Periode</th>
                  <th>Kreator</th>
                  <th>Username</th>
                  <th>CM</th>
                  <th className="right">Video</th>
                  <th className="right">Views</th>
                  <th className="right">Likes</th>
                  <th className="right">GMV</th>
                  <th className="right">Orders</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => {
                  const c = creatorById.get(w.creatorId);
                  return (
                    <tr key={`${w.creatorId}|${w.periodStart}`}>
                      <td className="mono">
                        {w.periodStart} → {w.periodEnd}
                      </td>
                      <td>{c ? c.name : "(kreator tidak dikenal)"}</td>
                      <td className="mono">{c?.username ?? "—"}</td>
                      <td>{c?.owner_cpm_id ? (empName.get(c.owner_cpm_id) ?? "—") : "—"}</td>
                      <td className="right">{num(w.videos)}</td>
                      <td className="right">{num(w.views)}</td>
                      <td className="right">{num(w.likes)}</td>
                      <td className="right">{rupiah(w.gmv)}</td>
                      <td className="right">{num(w.orders)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
