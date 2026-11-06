// Seksi "Performa Bulanan" portal merchant — ringkasan Laporan Performa Merchant
// (migrasi 0381). Data dari RPC whitelist merchant_portal_performance*: angka
// agregat milik merchant ini saja (tanpa nama kreator, judul post, data merchant
// lain). Insight = versi yang disimpan tim BD bila ada, selain itu teks otomatis.
import { getCachedClient } from "@/lib/supabase/server";
import { monthLabelLong, monthLabel, bucketLabels } from "@/lib/merchant-report/metrics";
import { monthlyInsights, bodyToLines } from "@/lib/merchant-report/insights";
import { n, f2, pct, rpJt, rpRb, mom, delta } from "@/lib/merchant-report/format";

type Perf = {
  lead_id: string;
  period: string;
  gmv: number;
  orders: number;
  views: number;
  redemption: number;
  red_rate: number;
  aov: number;
  order_per_1k: number;
  new_posts: number;
  active_posts: number;
  outlets_seen: number;
  outlets_active: number;
  creators_active: number;
  creators_gmv: number;
  outlets_gt_top: number;
  b0: number;
  b1: number;
  b2: number;
  b3: number;
  b4: number;
  b5: number;
  bucket_edges: number[];
};
type TopOutlet = { lead_id: string; location_id: string; outlet: string | null; city: string | null; gmv: number; orders: number; red_rate: number };
type Note = { lead_id: string; section_key: string; body: string };

const PERIOD_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;

export async function PerformanceSection({
  brands,
  dari,
  sampai,
}: {
  brands: { lead_id: string; brand_name: string }[];
  dari?: string;
  sampai?: string;
}) {
  const supabase = await getCachedClient();
  const { data: mRaw } = await supabase.rpc("merchant_portal_performance_months");
  const allMonths = [...new Set(((mRaw ?? []) as { period: string }[]).map((r) => r.period))].sort();
  if (allMonths.length === 0) return null;

  let from = dari && PERIOD_RE.test(dari) ? dari : allMonths[Math.max(0, allMonths.length - 2)];
  let to = sampai && PERIOD_RE.test(sampai) ? sampai : allMonths[allMonths.length - 1];
  if (to < from) [from, to] = [to, from];

  const [{ data: pRaw }, { data: oRaw }, { data: nRaw }] = await Promise.all([
    supabase.rpc("merchant_portal_performance", { p_from: `${from}-01`, p_to: `${to}-01` }),
    supabase.rpc("merchant_portal_top_outlets", { p_from: `${from}-01`, p_to: `${to}-01`, p_limit: 5 }),
    supabase.rpc("merchant_portal_report_notes", { p_from: `${from}-01`, p_to: `${to}-01` }),
  ]);
  const perf = ((pRaw ?? []) as Perf[]).map((r) => ({ ...r, gmv: Number(r.gmv), redemption: Number(r.redemption), red_rate: Number(r.red_rate), aov: Number(r.aov), order_per_1k: Number(r.order_per_1k) }));
  const outlets = (oRaw ?? []) as TopOutlet[];
  const notes = (nRaw ?? []) as Note[];

  return (
    <div className="card">
      <h2>Performa Bulanan TikTok GO</h2>
      <form method="get" className="filters-row" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", marginBottom: 8 }}>
        <label style={{ margin: 0 }}>
          Dari{" "}
          <select name="dari" defaultValue={from} style={{ width: "auto" }}>
            {allMonths.map((m) => (
              <option key={m} value={m}>
                {monthLabelLong(m)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ margin: 0 }}>
          Sampai{" "}
          <select name="sampai" defaultValue={to} style={{ width: "auto" }}>
            {allMonths.map((m) => (
              <option key={m} value={m}>
                {monthLabelLong(m)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" style={{ width: "auto" }}>
          Tampilkan
        </button>
      </form>

      {brands.map((b) => {
        const mo = perf.filter((r) => r.lead_id === b.lead_id);
        if (mo.length === 0) return brands.length > 1 ? <p key={b.lead_id} className="muted">{b.brand_name}: belum ada data di periode ini.</p> : <p key={b.lead_id} className="muted">Belum ada data di periode ini.</p>;
        const first = mo[0], last = mo[mo.length - 1];
        const edges = last.bucket_edges ?? [5, 10, 20, 50];
        const BL = bucketLabels(edges).map((x, i) => (i === 0 ? "0 order" : x.replace("-", "–")));
        const tot = mo.reduce((s, r) => ({ gmv: s.gmv + r.gmv, orders: s.orders + Number(r.orders), red: s.red + r.redemption }), { gmv: 0, orders: 0, red: 0 });
        const lite = mo.map((r) => ({ label: monthLabel(r.period), gmv: r.gmv, orders: Number(r.orders), views: Number(r.views), order_per_1k: r.order_per_1k, outlets_gt_top: Number(r.outlets_gt_top) }));
        const myNotes = notes.filter((x) => x.lead_id === b.lead_id);
        const note = (k: string) => myNotes.find((x) => x.section_key === k)?.body;
        const ins1 = note("ins1") ? bodyToLines(note("ins1")!) : monthlyInsights(lite, mo.map((r) => Number(r.b0)), edges[3]);
        const ins2 = note("ins2") ? bodyToLines(note("ins2")!) : [];
        const bucketRows = [0, 1, 2, 3, 4, 5].map((i) => ({ label: BL[i], vals: mo.map((r) => Number(r[`b${i}` as keyof Perf] as number)) }));
        const myOutlets = outlets.filter((o) => o.lead_id === b.lead_id);
        return (
          <div key={b.lead_id} style={{ marginTop: 12 }}>
            {brands.length > 1 && <h3>{b.brand_name}</h3>}
            <div className="stats">
              <div className="stat">
                <div className="muted">GMV {mo.length > 1 ? "periode" : monthLabelLong(last.period)}</div>
                <b>{rpJt(tot.gmv)}</b>
              </div>
              <div className="stat">
                <div className="muted">Order</div>
                <b>{n(tot.orders)}</b>
              </div>
              <div className="stat">
                <div className="muted">Rata-rata nilai order</div>
                <b>{rpRb(tot.orders ? tot.gmv / tot.orders : 0)}</b>
              </div>
              <div className="stat">
                <div className="muted">Redemption rate</div>
                <b>{pct(tot.gmv ? tot.red / tot.gmv : 0)}</b>
              </div>
              <div className="stat">
                <div className="muted">Order / 1.000 views ({monthLabel(last.period)})</div>
                <b>{f2(last.order_per_1k)}</b>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Bulan</th>
                    <th className="right">GMV</th>
                    <th className="right">Order</th>
                    <th className="right">Views</th>
                    <th className="right">Redemption</th>
                    <th className="right">Outlet bertransaksi</th>
                    <th className="right">GMV MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {mo.map((r, i) => (
                    <tr key={r.period}>
                      <td>{monthLabelLong(r.period)}</td>
                      <td className="right">{rpJt(r.gmv)}</td>
                      <td className="right">{n(Number(r.orders))}</td>
                      <td className="right">{f2(Number(r.views) / 1e6)} jt</td>
                      <td className="right">{pct(r.red_rate)}</td>
                      <td className="right">
                        {r.outlets_active}/{r.outlets_seen}
                      </td>
                      <td className="right">{i ? delta(mom(mo[i - 1].gmv, r.gmv)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(ins1.length > 0 || ins2.length > 0) && (
              <div className="subcard" style={{ marginTop: 8 }}>
                <b>Ringkasan</b>
                <ul style={{ margin: "4px 0 0 18px" }}>
                  {[...ins1, ...ins2].map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginTop: 8 }}>
              <div>
                <h3>Outlet teratas</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Outlet</th>
                      <th className="right">GMV</th>
                      <th className="right">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myOutlets.map((o) => (
                      <tr key={o.location_id}>
                        <td>
                          {o.outlet ?? o.location_id}
                          {o.city && <div className="muted">{o.city}</div>}
                        </td>
                        <td className="right">{rpJt(Number(o.gmv))}</td>
                        <td className="right">{n(Number(o.orders))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h3>Kategori order per outlet</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Order/bulan</th>
                      {mo.map((r) => (
                        <th key={r.period} className="right">
                          {monthLabel(r.period)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bucketRows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        {row.vals.map((v, i) => (
                          <td key={i} className="right">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Sumber: data TikTok GO (post valid). GMV {monthLabel(first.period)}–{monthLabel(last.period)} = nilai penjualan voucher lewat konten kreator;
              redemption rate = nilai voucher yang sudah ditukar ÷ GMV. Bulan yang belum lengkap tidak ditampilkan.
            </p>
          </div>
        );
      })}
    </div>
  );
}
