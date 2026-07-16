import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tanggal, rupiah, num } from "@/lib/format";
import { addDays } from "@/lib/mcn/weeks";
import {
  DealsTabs,
  PipelineStageSelect,
  DealsMainTabs,
  RegisterPoiDealForm,
  PoiRealisasiForm,
  CreatePoiFinanceForm,
} from "./forms";

type Deal = {
  id: string;
  code: string | null;
  brand_name: string;
  shop_id: string | null;
  exp_date: string | null;
  status: string;
  pipeline_stage: string;
  review_flags: Record<string, unknown> | null;
  kategori_poi: string | null;
  pic_name: string | null;
  pic_whatsapp: string | null;
  bentuk_kerjasama: string | null;
  nominal_harga: number | null;
  benefit: string | null;
  visit_start_date: string | null;
  visit_start_time: string | null;
  visit_end_date: string | null;
  visit_end_time: string | null;
  kreator_needed: number | null;
  konten_needed: number | null;
  brief_link: string | null;
  bd_id: string | null;
  listing_date: string | null;
  visit_realized_date: string | null;
  kreator_realized: number | null;
  video_realized: number | null;
  visit_checked: boolean | null;
  poin: number | null;
  transaction_id: string | null;
};

type PoiSummaryRow = {
  period: string;
  bd_id: string | null;
  bd_name: string | null;
  kategori_poi: string;
  total_deal: number;
  realisasi_visit: number;
  poin_sum: number;
};

const STATUS_CLASS: Record<string, string> = {
  running: "green",
  hold: "amber",
  done: "gray",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// periodLabel: 'YYYYMM' -> 'Jul-26' (dipakai khusus Summary — bukan tanggal(), yang
// menerima format 'YYYY-MM-DD').
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
function periodLabel(period: string): string {
  if (!period || period.length !== 6) return period;
  const year2 = period.slice(2, 4);
  const monthIdx = parseInt(period.slice(4, 6), 10) - 1;
  const name = MONTH_ABBR[monthIdx] ?? period.slice(4, 6);
  return `${name}-${year2}`;
}

function pct(numerator: number, denominator: number): string {
  if (!denominator) return "—";
  return `${((numerator / denominator) * 100).toFixed(0)}%`;
}

export default async function DealsPage() {
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
  const canView = mgmt || ["BizDev", "CreatorManagement", "Account"].includes(div);
  if (!canView) redirect("/dashboard");

  // Registrasi deal shop (MCN, existing) — dipertahankan.
  const canRegisterShop = mgmt || div === "BizDev" || div === "CreatorManagement";
  const canImport = mgmt || div === "BizDev";
  const sourcedByRole: "bd" | "cm" = div === "CreatorManagement" && !mgmt ? "cm" : "bd";
  // Input Deal POI: BizDev + mgmt saja. Realisasi: siapa saja yang bisa lihat halaman.
  const canRegisterPoi = mgmt || div === "BizDev";

  const { data: dealsRaw } = await supabase
    .from("brand_deals")
    .select(
      "id, code, brand_name, shop_id, exp_date, status, pipeline_stage, review_flags, " +
        "kategori_poi, pic_name, pic_whatsapp, bentuk_kerjasama, nominal_harga, benefit, " +
        "visit_start_date, visit_start_time, visit_end_date, visit_end_time, " +
        "kreator_needed, konten_needed, brief_link, bd_id, listing_date, " +
        "visit_realized_date, kreator_realized, video_realized, visit_checked, poin, transaction_id"
    )
    .order("created_at", { ascending: false });
  const deals = (dealsRaw as Deal[] | null) ?? [];
  const poiDeals = deals.filter((d) => d.kategori_poi != null);
  const shopDeals = deals.filter((d) => d.kategori_poi == null);

  const { data: emps } = await supabase.from("employees").select("id, full_name");
  const employees = (emps as { id: string; full_name: string }[] | null) ?? [];
  const empMap: Record<string, string> = {};
  for (const e of employees) empMap[e.id] = e.full_name;

  const { data: merchantsRaw } = await supabase
    .from("merchants")
    .select("id, code, nama_toko")
    .order("nama_toko", { ascending: true });
  const merchants = (merchantsRaw as { id: string; code: string | null; nama_toko: string }[] | null) ?? [];

  const { data: cfg } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "mcn.deal_expiring_days")
    .maybeSingle();
  const expiringDays = cfg?.value != null ? Number(cfg.value) : 14;

  const { data: poiCfgRaw } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", ["poi.kategori", "poi.benefits"]);
  const poiCfgRows = (poiCfgRaw as { key: string; value: unknown }[] | null) ?? [];
  const poiKategoriConfig =
    (poiCfgRows.find((r) => r.key === "poi.kategori")?.value as string[] | undefined) ?? [];
  const poiBenefitsConfig =
    (poiCfgRows.find((r) => r.key === "poi.benefits")?.value as Record<string, string[]> | undefined) ?? {};

  // Kode transaksi utk badge TRX — dibaca best-effort (RLS bisa membatasi utk
  // sebagian role; bila tak terlihat, badge fallback ke generik "TRX ✓").
  const trxIds = poiDeals.map((d) => d.transaction_id).filter((id): id is string => !!id);
  const trxCodeMap: Record<string, string> = {};
  if (trxIds.length > 0) {
    const { data: trxRows } = await supabase.from("transactions").select("id, code").in("id", trxIds);
    for (const t of (trxRows as { id: string; code: string | null }[] | null) ?? []) {
      if (t.code) trxCodeMap[t.id] = t.code;
    }
  }

  const { data: summaryRaw } = await supabase
    .from("v_poi_deal_summary")
    .select("period, bd_id, bd_name, kategori_poi, total_deal, realisasi_visit, poin_sum");
  const summaryRows = (summaryRaw as PoiSummaryRow[] | null) ?? [];

  // Agregasi per periode+BD (lintas kategori) & per periode+kategori (lintas BD).
  const byBdMap = new Map<
    string,
    { period: string; bd_id: string | null; bd_name: string | null; total_deal: number; realisasi_visit: number; poin_sum: number }
  >();
  const byKategoriMap = new Map<
    string,
    { period: string; kategori_poi: string; total_deal: number; realisasi_visit: number }
  >();
  for (const r of summaryRows) {
    const bdKey = `${r.period}|${r.bd_id ?? ""}`;
    const existingBd = byBdMap.get(bdKey);
    if (existingBd) {
      existingBd.total_deal += r.total_deal ?? 0;
      existingBd.realisasi_visit += r.realisasi_visit ?? 0;
      existingBd.poin_sum += r.poin_sum ?? 0;
    } else {
      byBdMap.set(bdKey, {
        period: r.period,
        bd_id: r.bd_id,
        bd_name: r.bd_name,
        total_deal: r.total_deal ?? 0,
        realisasi_visit: r.realisasi_visit ?? 0,
        poin_sum: r.poin_sum ?? 0,
      });
    }

    const katKey = `${r.period}|${r.kategori_poi}`;
    const existingKat = byKategoriMap.get(katKey);
    if (existingKat) {
      existingKat.total_deal += r.total_deal ?? 0;
      existingKat.realisasi_visit += r.realisasi_visit ?? 0;
    } else {
      byKategoriMap.set(katKey, {
        period: r.period,
        kategori_poi: r.kategori_poi,
        total_deal: r.total_deal ?? 0,
        realisasi_visit: r.realisasi_visit ?? 0,
      });
    }
  }
  const byBd = Array.from(byBdMap.values()).sort(
    (a, b) => b.period.localeCompare(a.period) || b.poin_sum - a.poin_sum
  );
  const byKategori = Array.from(byKategoriMap.values()).sort(
    (a, b) => b.period.localeCompare(a.period) || b.total_deal - a.total_deal
  );

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const thresholdDate = addDays(todayStr, expiringDays);

  const poiTab = (
    <>
      {canRegisterPoi && (
        <div className="card">
          <h2>Input Deal Baru</h2>
          <RegisterPoiDealForm poiKategori={poiKategoriConfig} poiBenefits={poiBenefitsConfig} />
        </div>
      )}
      <div className="card">
        <h2>Daftar Deal POI ({poiDeals.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama POI</th>
                <th>Kategori</th>
                <th>BD</th>
                <th>PIC</th>
                <th>Kerjasama</th>
                <th>Benefit</th>
                <th>Window Visit</th>
                <th>Target</th>
                <th>Realisasi</th>
                <th>Poin</th>
              </tr>
            </thead>
            <tbody>
              {poiDeals.map((d) => (
                <tr key={d.id}>
                  <td className="mono">{d.code ?? "—"}</td>
                  <td>{d.brand_name}</td>
                  <td>
                    <span className="badge indigo">{d.kategori_poi}</span>
                  </td>
                  <td>{d.bd_id ? empMap[d.bd_id] ?? "—" : "—"}</td>
                  <td>
                    {d.pic_name ?? "—"}
                    {d.pic_whatsapp && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {d.pic_whatsapp}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${d.bentuk_kerjasama === "Berbayar" ? "amber" : "slate"}`}>
                      {d.bentuk_kerjasama ?? "—"}
                    </span>
                    {d.bentuk_kerjasama === "Berbayar" && (
                      <div style={{ fontSize: 12 }}>{rupiah(d.nominal_harga)}</div>
                    )}
                    {d.bentuk_kerjasama === "Berbayar" && d.transaction_id && (
                      <div>
                        <span className="badge green" title={d.transaction_id}>
                          {trxCodeMap[d.transaction_id] ?? "TRX ✓"}
                        </span>
                      </div>
                    )}
                    {d.bentuk_kerjasama === "Berbayar" && !d.transaction_id && canRegisterPoi && (
                      <CreatePoiFinanceForm dealId={d.id} />
                    )}
                  </td>
                  <td>{d.benefit ?? "—"}</td>
                  <td>
                    <div>
                      {tanggal(d.visit_start_date)} {d.visit_start_time ?? ""}
                    </div>
                    <div className="muted">
                      s/d {tanggal(d.visit_end_date)} {d.visit_end_time ?? ""}
                    </div>
                  </td>
                  <td>
                    {d.kreator_needed ?? "—"} kreator / {d.konten_needed ?? "—"} konten
                  </td>
                  <td>
                    <PoiRealisasiForm
                      dealId={d.id}
                      listingDate={d.listing_date}
                      visitRealizedDate={d.visit_realized_date}
                      kreatorRealized={d.kreator_realized}
                      videoRealized={d.video_realized}
                      visitChecked={d.visit_checked}
                    />
                  </td>
                  <td>{num(d.poin)}</td>
                </tr>
              ))}
              {poiDeals.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted">
                    Belum ada deal POI terdaftar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const shopTab = (
    <>
      {canRegisterShop && (
        <DealsTabs
          employees={employees}
          merchants={merchants}
          sourcedByRole={sourcedByRole}
          canImport={canImport}
        />
      )}
      <div className="card">
        <h2>Daftar Deal Shop / MCN ({shopDeals.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Brand</th>
                <th>Shop ID</th>
                <th>Exp</th>
                <th>Status</th>
                <th>Pipeline</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {shopDeals.map((d) => {
                const expiringSoon =
                  !!d.exp_date && d.exp_date >= todayStr && d.exp_date <= thresholdDate;
                const expired = !!d.exp_date && d.exp_date < todayStr;
                return (
                  <tr key={d.id}>
                    <td className="mono">{d.code ?? "—"}</td>
                    <td>{d.brand_name}</td>
                    <td className="mono">{d.shop_id ?? "—"}</td>
                    <td>
                      {tanggal(d.exp_date)}
                      {expired && <span className="badge red">expired</span>}
                      {!expired && expiringSoon && <span className="badge amber">expiring soon</span>}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[d.status] ?? "gray"}`}>{d.status}</span>
                    </td>
                    <td>
                      {mgmt || div === "BizDev" ? (
                        <PipelineStageSelect dealId={d.id} current={d.pipeline_stage} />
                      ) : (
                        <span className="badge slate">{d.pipeline_stage}</span>
                      )}
                    </td>
                    <td>
                      {d.review_flags ? (
                        <span className="badge amber" title={JSON.stringify(d.review_flags)}>
                          perlu review
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {shopDeals.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Belum ada deal shop terdaftar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const summaryTab = (
    <>
      <div className="card">
        <h2>Summary per Periode &amp; BD</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Periode</th>
                <th>BD</th>
                <th>Total Deal</th>
                <th>Realisasi Visit</th>
                <th>%</th>
                <th>Poin</th>
              </tr>
            </thead>
            <tbody>
              {byBd.map((r) => (
                <tr key={`${r.period}|${r.bd_id ?? ""}`}>
                  <td>{periodLabel(r.period)}</td>
                  <td>{r.bd_name ?? "—"}</td>
                  <td>{num(r.total_deal)}</td>
                  <td>{num(r.realisasi_visit)}</td>
                  <td>{pct(r.realisasi_visit, r.total_deal)}</td>
                  <td>{num(r.poin_sum)}</td>
                </tr>
              ))}
              {byBd.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Belum ada data summary.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Summary per Periode &amp; Kategori POI</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Periode</th>
                <th>Kategori</th>
                <th>Total Deal</th>
                <th>Realisasi Visit</th>
                <th>% Deal to Visit</th>
              </tr>
            </thead>
            <tbody>
              {byKategori.map((r) => (
                <tr key={`${r.period}|${r.kategori_poi}`}>
                  <td>{periodLabel(r.period)}</td>
                  <td>
                    <span className="badge indigo">{r.kategori_poi}</span>
                  </td>
                  <td>{num(r.total_deal)}</td>
                  <td>{num(r.realisasi_visit)}</td>
                  <td>{pct(r.realisasi_visit, r.total_deal)}</td>
                </tr>
              ))}
              {byKategori.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    Belum ada data summary.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  return (
    <>
      <h1>POI Deals / Merchant Deals</h1>
      <p className="page-sub">
        Dealing BD dengan venue/POI utk visit kreator (tab Dealing POI), registrasi &amp;
        import Merchant Deal shop MCN (tab Deals Shop), serta rekap performa per periode
        (tab Summary).
      </p>

      <DealsMainTabs poi={poiTab} shop={shopTab} summary={summaryTab} />
    </>
  );
}
