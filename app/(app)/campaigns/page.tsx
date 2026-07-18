import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rupiah, num, tanggal } from "@/lib/format";
import { NewCampaignForm, StatusButtons, BudgetForm } from "./forms";

type Campaign = {
  id: string;
  code: string | null;
  campaign_name: string;
  channel: string;
  is_online: boolean;
  is_offline: boolean;
  start_date: string | null;
  end_date: string | null;
  status: string;
  owner_id: string | null;
};

type Metric = {
  campaign_id: string;
  campaign_code: string | null;
  budget: number | null;
  lead_by_dashboard: number;
  lead_real_by_sales: number;
  lead_quality_rate: number | null;
  attributed_revenue: number;
  cost_per_lead: number | null;
  cost_per_real_lead: number | null;
  roas: number | null;
  collected_roas: number | null;
};

const STATUS_CLASS: Record<string, string> = {
  "[Draft]": "slate",
  "[Active]": "green",
  "[Paused]": "amber",
  "[Closed]": "blue",
  "[Archived]": "gray",
};

export default async function CampaignsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const canEdit = !!(me?.is_director || me?.division === "Marketing");
  // The M2 dashboard aggregates across leads/attempts/merchants/transactions —
  // tables Marketing has no row-level access to. v_marketing_metrics is
  // security_invoker, so a Marketing session sees zeros. Read it with the
  // service-role client (server-only) and gate visibility to Marketing/OD/Director,
  // which mirrors the marketing_performance_records RLS (budget confidentiality).
  const canSeeMetrics = !!(me?.is_od || me?.is_director || me?.division === "Marketing");

  const supabase = await getCachedClient();
  const admin = canSeeMetrics ? createAdminClient() : null;

  const [{ data: campaigns }, { data: budgets }, { data: metrics }, { data: owners }] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select("id, code, campaign_name, channel, is_online, is_offline, start_date, end_date, status, owner_id")
        .order("created_at", { ascending: false }),
      admin
        ? admin.from("marketing_performance_records").select("campaign_id, budget")
        : Promise.resolve({ data: [] as { campaign_id: string; budget: number }[] }),
      admin
        ? admin.from("v_marketing_metrics").select("*")
        : Promise.resolve({ data: [] as Metric[] }),
      supabase
        .from("employees")
        .select("id, full_name")
        .eq("division", "Marketing")
        .order("full_name"),
    ]);

  const budgetMap = new Map<string, number>(
    (budgets ?? []).map((b) => [b.campaign_id as string, Number(b.budget)])
  );

  const list = (campaigns as Campaign[] | null) ?? [];
  const mlist = (metrics as Metric[] | null) ?? [];
  const ownerList = owners ?? [];
  const active = list.filter((c) => c.status === "[Active]").length;

  return (
    <>
      <h1>Kampanye Akuisisi</h1>
      <p className="page-sub">
        Benang merah akuisisi (M3). Owner: Marketing. Metrik ROAS/CPL dihitung otomatis dari
        leads + closing (M2).
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Kampanye</div>
          <div className="v">{list.length}</div>
        </div>
        <div className="stat">
          <div className="k">Aktif</div>
          <div className="v">{active}</div>
        </div>
        <div className="stat">
          <div className="k">Dengan Budget</div>
          <div className="v">{budgetMap.size}</div>
        </div>
        <div className="stat">
          <div className="k">Terukur (ROAS)</div>
          <div className="v">{mlist.filter((m) => m.roas !== null).length}</div>
        </div>
      </div>

      <div className="card">
        <h2>Daftar Kampanye ({list.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Channel</th>
              <th>Jenis</th>
              <th>Mulai</th>
              <th>Status</th>
              {canEdit && <th>Transisi</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td className="mono">{c.code ?? "—"}</td>
                <td>{c.campaign_name}</td>
                <td>{c.channel}</td>
                <td className="muted">
                  {[c.is_online ? "Online" : null, c.is_offline ? "Offline" : null]
                    .filter(Boolean)
                    .join(" + ") || "—"}
                </td>
                <td>{tanggal(c.start_date)}</td>
                <td>
                  <span className={`badge ${STATUS_CLASS[c.status] ?? "gray"}`}>{c.status}</span>
                </td>
                {canEdit && (
                  <td>
                    <StatusButtons id={c.id} status={c.status} />
                  </td>
                )}
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="muted">
                  Belum ada kampanye.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canSeeMetrics && (
      <div className="card">
        <h2>Dashboard Performa Marketing (M2)</h2>
        <p className="section-sub">
          ROAS = Attributed Revenue ÷ Budget · CPL = Budget ÷ Lead Dashboard · Quality = Lead Real ÷
          Lead Dashboard. Isi budget per kampanye untuk mengaktifkan metrik.
        </p>
        <table>
          <thead>
            <tr>
              <th>Kampanye</th>
              <th className="right">Budget</th>
              <th className="right">Lead Dash</th>
              <th className="right">Lead Real</th>
              <th className="right">Quality</th>
              <th className="right">CPL</th>
              <th className="right">Revenue</th>
              <th className="right">ROAS</th>
              {canEdit && <th>Set Budget</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const m = mlist.find((x) => x.campaign_id === c.id);
              return (
                <tr key={c.id}>
                  <td>
                    <span className="mono">{c.code ?? "—"}</span> {c.campaign_name}
                  </td>
                  <td className="right">{m ? rupiah(m.budget) : rupiah(budgetMap.get(c.id) ?? null)}</td>
                  <td className="right">{m ? num(m.lead_by_dashboard) : "—"}</td>
                  <td className="right">{m ? num(m.lead_real_by_sales) : "—"}</td>
                  <td className="right">
                    {m?.lead_quality_rate !== null && m?.lead_quality_rate !== undefined
                      ? `${m.lead_quality_rate}%`
                      : "—"}
                  </td>
                  <td className="right">{m?.cost_per_lead != null ? rupiah(m.cost_per_lead) : "—"}</td>
                  <td className="right">{m ? rupiah(m.attributed_revenue) : "—"}</td>
                  <td className="right">
                    {m?.roas != null ? (
                      <span className={`badge ${m.roas >= 1 ? "green" : "red"}`}>{m.roas}×</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <BudgetForm campaignId={c.id} current={budgetMap.get(c.id) ?? null} />
                    </td>
                  )}
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 9 : 8} className="muted">
                  Belum ada data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {canEdit && (
        <div className="card">
          <h2>Buat Kampanye Baru</h2>
          <NewCampaignForm owners={ownerList} />
        </div>
      )}
    </>
  );
}
