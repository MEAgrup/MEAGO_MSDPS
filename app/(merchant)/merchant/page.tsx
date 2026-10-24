import Link from "next/link";
import { getCachedClient, getMerchantPortal } from "@/lib/supabase/server";
import { rupiah } from "@/lib/format";
import {
  campaignStageLabel,
  periodLabel,
  recentPeriods,
  stageBadge,
  type GmvMonth,
  type PortalCampaign,
} from "@/lib/merchant-portal";

// Beranda: GMV bulan berjalan + 3 bulan terakhir (sumber otoritatif bila ada,
// tandai estimasi) dan ringkasan kampanye yang sedang berjalan.
export default async function MerchantHome() {
  const brands = (await getMerchantPortal()) ?? [];
  const supabase = await getCachedClient();
  const [{ data: gmvRaw }, { data: campRaw }] = await Promise.all([
    supabase.rpc("merchant_portal_gmv_monthly"),
    supabase.rpc("merchant_portal_campaigns"),
  ]);
  const gmv = (gmvRaw as GmvMonth[] | null) ?? [];
  const campaigns = (campRaw as PortalCampaign[] | null) ?? [];
  const byPeriod = new Map(gmv.map((g) => [g.period, g]));
  const [current, ...previous] = recentPeriods(3);
  const cur = byPeriod.get(current);
  const running = campaigns.filter((c) => campaignStageLabel(c.campaign_stage, c.status) === "Berjalan");

  return (
    <>
      <h1>Halo, {brands.map((b) => b.brand_name).join(" · ")}</h1>
      <p className="page-sub">Ringkasan performa kampanye bersama MEAGO!.</p>

      <div className="stats">
        <div className="stat">
          <div className="k">GMV {periodLabel(current)}</div>
          <div className="v">{cur ? rupiah(cur.gmv) : "—"}</div>
          {cur && <div className="muted" style={{ fontSize: 11 }}>{cur.label}</div>}
        </div>
        {previous.map((p) => {
          const g = byPeriod.get(p);
          return (
            <div className="stat" key={p}>
              <div className="k">GMV {periodLabel(p)}</div>
              <div className="v">{g ? rupiah(g.gmv) : "—"}</div>
              {g && <div className="muted" style={{ fontSize: 11 }}>{g.label}</div>}
            </div>
          );
        })}
        <div className="stat">
          <div className="k">Kampanye berjalan</div>
          <div className="v">{running.length}</div>
        </div>
      </div>

      <div className="card">
        <h2>Kampanye Terbaru</h2>
        {campaigns.length === 0 ? (
          <p className="muted">Belum ada kampanye.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <tbody>
                {campaigns.slice(0, 5).map((c) => {
                  const label = campaignStageLabel(c.campaign_stage, c.status);
                  return (
                    <tr key={c.deal_id}>
                      <td>{c.campaign_name ?? c.brand_name ?? "Kampanye"}</td>
                      <td className="right">
                        <span className={`badge ${stageBadge(label)}`}>{label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ marginTop: 12 }}>
          <Link href="/merchant/kampanye">Lihat semua status kampanye →</Link>
        </p>
      </div>
      <p className="hint">
        &quot;Estimasi&quot; = angka sementara yang masih bisa berubah setelah verifikasi. Pertanyaan? Hubungi
        tim MEAGO!.
      </p>
    </>
  );
}
