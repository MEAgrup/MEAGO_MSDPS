// /meago/gmv-video — GMV Video Mingguan. Sumber data: export TikTok "Creator Analysis —
// PostOnly / Managed Creators" (slice video/post, tanpa live), satu baris per kreator per
// minggu. Jalur ini TERPISAH dari card "Upload Data Mingguan" di /meago/creators yang
// mengisi creator_period_summary dari export performa biasa (yang punya Live streams).
//
// Riwayat mingguan TIDAK ditimpa: satu baris per (kreator, period_start), jadi minggu
// lama tetap utuh saat minggu baru diunggah. Nama CM di-resolve dari master kreator
// (mcn_creators.owner_cpm_id → employees.full_name).

import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { rupiah, num } from "@/lib/format";
import { VideoGmvForm } from "./upload-form";

type Creator = { id: string; name: string; username: string | null; owner_cpm_id: string | null };

type WeekRow = {
  creator_id: string;
  period_start: string;
  period_end: string;
  sales_value: number | null;
  orders: number | null;
  aov: number | null;
  redemption_amount: number | null;
  new_posts: number | null;
  posts_with_views: number | null;
  posts_with_sales: number | null;
  video_views: number | null;
  ctr: number | null;
  cvr: number | null;
  creator_level: string | null;
  binding_status: string | null;
};

// CTR/CVR disimpan sebagai FRAKSI (0.0427 = 4,27%) — konversi ke persen hanya di sini.
function persen(fraction: number | null): string {
  if (fraction === null || fraction === undefined) return "—";
  return `${(Number(fraction) * 100).toFixed(2)}%`;
}

const PAGE_ROWS = 300;

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

  // Ringkasan per minggu dihitung dari SELURUH baris minggu tsb lewat agregat DB, sementara
  // tabel detail hanya menampilkan PAGE_ROWS teratas — jangan hitung total dari array
  // yang sudah terpotong (limit), nanti angkanya salah.
  const [{ data: weekRaw }, { data: creatorsRaw }, { data: empsRaw }] = await Promise.all([
    supabase
      .from("creator_video_gmv")
      .select(
        "creator_id, period_start, period_end, sales_value, orders, aov, redemption_amount, new_posts, posts_with_views, posts_with_sales, video_views, ctr, cvr, creator_level, binding_status"
      )
      .order("period_start", { ascending: false })
      .order("sales_value", { ascending: false })
      .limit(PAGE_ROWS),
    supabase.from("mcn_creators").select("id, name, username, owner_cpm_id").limit(PAGE_ROWS * 4),
    supabase.from("employees").select("id, full_name"),
  ]);

  const weeks = (weekRaw as WeekRow[] | null) ?? [];
  const creatorById = new Map(
    ((creatorsRaw as Creator[] | null) ?? []).map((c) => [c.id, c])
  );
  const empName = new Map(
    ((empsRaw as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name])
  );

  // Ringkasan minggu yang tampil (dari baris yang tampil — dilabeli jelas sebagai
  // "top PAGE_ROWS" supaya tidak dibaca sebagai total seluruh kreator).
  const periods = [...new Set(weeks.map((w) => w.period_start))].sort().reverse();
  const shownGmv = weeks.reduce((s, w) => s + Number(w.sales_value ?? 0), 0);
  const shownViews = weeks.reduce((s, w) => s + Number(w.video_views ?? 0), 0);

  return (
    <>
      <h1>GMV Video Mingguan</h1>
      <p className="page-sub">
        Sumber data: export TikTok <strong>Creator Analysis — PostOnly</strong> (slice
        video/post, tanpa live), satu baris per kreator per minggu. Nama CM diambil otomatis
        dari master kreator lewat pencocokan Creator ID (username).
      </p>

      <div className="card">
        <h2>Upload GMV Video Mingguan</h2>
        <p className="section-sub">
          File XLSX/CSV dengan sheet <span className="mono">Filter</span> (Start/End date) dan{" "}
          <span className="mono">Data</span>. Window periode dicek otomatis (W1–W5, tidak
          boleh lintas bulan). Header divalidasi ketat — bila export TikTok berubah, upload
          ditolak dengan menyebut nama kolom yang hilang.
        </p>
        <VideoGmvForm />
      </div>

      {periods.length > 0 && (
        <div className="card">
          <h2>Ringkasan</h2>
          <div className="stats">
            <div className="stat">
              <span className="muted">Minggu termuat</span>
              <strong>{periods.length}</strong>
            </div>
            <div className="stat">
              <span className="muted">Baris ditampilkan</span>
              <strong>{num(weeks.length)}</strong>
            </div>
            <div className="stat">
              <span className="muted">GMV video (baris tampil)</span>
              <strong>{rupiah(shownGmv)}</strong>
            </div>
            <div className="stat">
              <span className="muted">Video views (baris tampil)</span>
              <strong>{num(shownViews)}</strong>
            </div>
          </div>
          <p className="hint">
            Angka di atas menjumlahkan {num(weeks.length)} baris yang ditampilkan (GMV
            tertinggi lebih dulu), bukan seluruh kreator pada minggu tersebut.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Riwayat Mingguan</h2>
        <p className="section-sub">
          Satu baris per kreator per minggu, {PAGE_ROWS} teratas menurut GMV. Minggu
          sebelumnya tidak ditimpa saat minggu baru diunggah.
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
                  <th>Level</th>
                  <th className="right">GMV Video</th>
                  <th className="right">Orders</th>
                  <th className="right">AOV</th>
                  <th className="right">Redeemed GMV</th>
                  <th className="right">New posts</th>
                  <th className="right">Posts w/ views</th>
                  <th className="right">Posts w/ sales</th>
                  <th className="right">Video views</th>
                  <th className="right">CTR</th>
                  <th className="right">CVR</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => {
                  const c = creatorById.get(w.creator_id);
                  return (
                    <tr key={`${w.creator_id}|${w.period_start}`}>
                      <td className="mono">
                        {w.period_start} → {w.period_end}
                      </td>
                      <td>{c ? c.name : "(kreator tidak dikenal)"}</td>
                      <td className="mono">{c?.username ?? "—"}</td>
                      <td>{c?.owner_cpm_id ? (empName.get(c.owner_cpm_id) ?? "—") : "—"}</td>
                      <td>{w.creator_level ?? "—"}</td>
                      <td className="right">{rupiah(w.sales_value)}</td>
                      <td className="right">{num(w.orders)}</td>
                      <td className="right">{rupiah(w.aov)}</td>
                      <td className="right">{rupiah(w.redemption_amount)}</td>
                      <td className="right">{num(w.new_posts)}</td>
                      <td className="right">{num(w.posts_with_views)}</td>
                      <td className="right">{num(w.posts_with_sales)}</td>
                      <td className="right">{num(w.video_views)}</td>
                      <td className="right">{persen(w.ctr)}</td>
                      <td className="right">{persen(w.cvr)}</td>
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
