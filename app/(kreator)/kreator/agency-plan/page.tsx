import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tanggal } from "@/lib/format";

// Read-only: deal merchant yang sedang berjalan (view v_portal_deals — kreator-only
// via RLS helper). Hanya deal status running yang muncul.
type DealRow = {
  id: string;
  code: string | null;
  brand_name: string | null;
  niche: string | null;
  campaign_type: string | null;
  komisi_kreator_pct: number | null;
  kreators_needed: number | null;
  videos_needed: number | null;
  poi_location: string | null;
  deal_end: string | null;
  created_at: string;
};

const CAMPAIGN_TYPE_LABEL: Record<string, string> = {
  paid: "Berbayar",
  sample: "Sampel",
  extra_commission: "Komisi Ekstra",
};

function dash(v: string | null | undefined): string {
  return v ?? "—";
}

export default async function AgencyPlanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: creator } = await supabase
    .from("mcn_creators")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!creator) redirect("/dashboard");

  const { data: raw } = await supabase
    .from("v_portal_deals")
    .select(
      "id, code, brand_name, niche, campaign_type, komisi_kreator_pct, kreators_needed, videos_needed, poi_location, deal_end, created_at"
    )
    .order("created_at", { ascending: false });

  const deals = (raw as DealRow[] | null) ?? [];

  return (
    <>
      <h1>Merchant Deals</h1>
      <p className="page-sub">Deal merchant yang sedang berjalan. Tampilan hanya-baca.</p>

      {deals.length === 0 && (
        <div className="card">
          <p className="muted">Belum ada deal berjalan.</p>
        </div>
      )}

      {deals.map((d) => (
        <div className="card" key={d.id}>
          <h2>{dash(d.brand_name)}</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <span className="mono">{dash(d.code)}</span>
            <span className="badge blue">
              {d.campaign_type ? CAMPAIGN_TYPE_LABEL[d.campaign_type] ?? d.campaign_type : "—"}
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table>
              <tbody>
                <tr>
                  <th>Niche</th>
                  <td>{dash(d.niche)}</td>
                </tr>
                <tr>
                  <th>Komisi kreator</th>
                  <td>{d.komisi_kreator_pct !== null ? `${d.komisi_kreator_pct}%` : "—"}</td>
                </tr>
                <tr>
                  <th>Kebutuhan kreator</th>
                  <td>{d.kreators_needed !== null ? d.kreators_needed : "—"}</td>
                </tr>
                <tr>
                  <th>Jumlah video</th>
                  <td>{d.videos_needed !== null ? d.videos_needed : "—"}</td>
                </tr>
                <tr>
                  <th>Lokasi POI</th>
                  <td>{dash(d.poi_location)}</td>
                </tr>
                <tr>
                  <th>Deal berakhir</th>
                  <td>{d.deal_end ? tanggal(d.deal_end) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}
