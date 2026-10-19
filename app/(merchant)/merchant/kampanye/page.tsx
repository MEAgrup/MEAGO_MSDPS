import { getCachedClient } from "@/lib/supabase/server";
import { tanggal, num } from "@/lib/format";
import { campaignStageLabel, stageBadge, type PortalCampaign } from "@/lib/merchant-portal";

function range(a: string | null, b: string | null): string {
  if (!a && !b) return "—";
  return `${tanggal(a)} – ${tanggal(b)}`;
}

function progress(done: number | null, need: number | null): string {
  if (need === null || need === undefined) return done === null ? "—" : num(done);
  return `${num(done ?? 0)} / ${num(need)}`;
}

// Status Kampanye: brand_deals milik merchant ini saja (RPC merchant_portal_campaigns).
export default async function MerchantCampaignsPage() {
  const supabase = await getCachedClient();
  const { data } = await supabase.rpc("merchant_portal_campaigns");
  const campaigns = (data as PortalCampaign[] | null) ?? [];

  return (
    <>
      <h1>Status Kampanye</h1>
      <p className="page-sub">Jadwal kunjungan, kreator, dan konten untuk setiap kampanye Anda.</p>

      {campaigns.length === 0 && (
        <div className="card">
          <p className="muted">Belum ada kampanye.</p>
        </div>
      )}

      {campaigns.map((c) => {
        const label = campaignStageLabel(c.campaign_stage, c.status);
        return (
          <div className="card" key={c.deal_id}>
            <div className="table-toolbar">
              <h2 style={{ margin: 0 }}>{c.campaign_name ?? c.brand_name ?? "Kampanye"}</h2>
              <span className={`badge ${stageBadge(label)}`}>{label}</span>
            </div>
            <div className="stats">
              <div className="stat">
                <div className="k">Jadwal kunjungan</div>
                <div className="v" style={{ fontSize: 14 }}>{range(c.visit_start_date, c.visit_end_date)}</div>
              </div>
              <div className="stat">
                <div className="k">Kreator (terealisasi / dibutuhkan)</div>
                <div className="v">{progress(c.kreator_realized, c.kreator_needed)}</div>
              </div>
              <div className="stat">
                <div className="k">Video (terealisasi / dibutuhkan)</div>
                <div className="v">{progress(c.video_realized, c.videos_needed)}</div>
              </div>
              <div className="stat">
                <div className="k">Periode posting</div>
                <div className="v" style={{ fontSize: 14 }}>{range(c.post_window_start, c.post_window_end)}</div>
              </div>
            </div>
            {(c.kontrak_mulai || c.kategori) && (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                {c.kategori ? `${c.kategori} · ` : ""}
                {c.kontrak_mulai ? `Kontrak ${range(c.kontrak_mulai, c.kontrak_akhir)}` : ""}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
