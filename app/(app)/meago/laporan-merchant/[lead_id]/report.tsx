// Render Laporan Performa Merchant — layout = sample "Analisa Sushi Yay Agu–Sep
// 2026" (render_report.py): 8 seksi, SVG inline, mode terang/gelap. Server
// component; bagian interaktif (edit insight, logo, tema, cetak) di report-client.
import { VBar, HBar, Stacked } from "./charts";
import { EditableInsight, ReportToolbar, ParamsForm } from "./report-client";
import { DURATION_BUCKETS, VIEW_BUCKETS, monthLabelLong, type ReportMetrics, type ReportParams } from "@/lib/merchant-report/metrics";
import { INSIGHT_TITLES, type Insights, type InsightKey } from "@/lib/merchant-report/insights";
import { n, f1, f2, pct, rpJt, rpRb, jt, mom, delta } from "@/lib/merchant-report/format";

export type ReportProps = {
  brand: string;
  leadCode: string | null;
  logoUrl: string | null;
  metrics: ReportMetrics;
  params: ReportParams;
  auto: Insights;
  notes: Partial<Record<InsightKey, string>>;
  missing: string[];
  generatedAt: string;
};

export function periodText(periods: string[]): string {
  const a = periods[0], b = periods[periods.length - 1];
  if (a === b) return monthLabelLong(a);
  return a.slice(0, 4) === b.slice(0, 4) ? `${monthLabelLong(a).split(" ")[0]}–${monthLabelLong(b)}` : `${monthLabelLong(a)}–${monthLabelLong(b)}`;
}

const UpDown = ({ v, text }: { v: number; text?: string }) => <span className={v >= 0 ? "up" : "down"}>{text ?? delta(v)}</span>;

export function MerchantReport(p: ReportProps) {
  const { metrics: M, params: P, auto, notes, brand } = p;
  const mo = M.monthly;
  const L = M.labels;
  const first = mo[0], last = mo[mo.length - 1];
  const tot = M.total;
  const period = periodText(M.periods);
  const BL = M.bucket_labels;
  const bucketText: Record<string, string> = Object.fromEntries(BL.map((b, i) => [b, i === 0 ? "0 order" : b.replace("-", "–")]));
  const g = mom(first.gmv, last.gmv);
  const cs = M.creator_share;
  const cl = M.creator_layers;
  const act = M.creator_activity;
  const lo = M.layer_outlet;
  const B = M.best;
  const top8 = M.outlets.slice(0, 8);
  const cities = M.cities.filter((c) => c.city !== "(tanpa kota)").slice(0, 8);
  const durRate = DURATION_BUCKETS.map((k) => B.duration[k]?.sell_rate ?? 0);
  const bestDur = DURATION_BUCKETS.reduce((a, k) => ((B.duration[k]?.sell_rate ?? 0) > (B.duration[a]?.sell_rate ?? 0) ? k : a), DURATION_BUCKETS[0]);
  const vwRate = VIEW_BUCKETS.map((k) => B.views[k]?.sell_rate ?? 0);
  const shareRest = 1 - cs.top10, share310 = cs.top10 - cs.top2;
  const topEdge = P.bucket_edges[3];
  const scenPeriods = M.scenario_periods.map((x) => monthLabelLong(x).split(" ")[0]);
  const scenTitle = M.scenario_periods.length ? periodText([M.scenario_periods[0], M.scenario_periods[M.scenario_periods.length - 1]]) : "";
  const jtAxis = (v: number, ax: boolean) => (ax ? `${v}`.replace(".", ",") : `Rp${f1(v)} jt`);
  const ed = (k: InsightKey) => notes[k] ?? null;
  const editedCount = Object.keys(notes).length;
  const b0 = BL[0];

  return (
    <div className="page">
      <ReportToolbar hasLogo={!!p.logoUrl} editedCount={editedCount} />

      <header>
        <div className="brandrow">
          {p.logoUrl ? (
            <div className="logo img">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.logoUrl} alt={`Logo ${brand}`} />
            </div>
          ) : null}
          <div>
            <div className="kicker">Performance &amp; Digital Growth Report · MSDPS</div>
            <h1>
              ANALISA <span>{brand.toUpperCase()}</span>
            </h1>
            <p className="sub">
              <b>TikTok Dining · {period}</b>
              <br />
              Ringkasan performa, digital insight, outlet &amp; creator, best practice konten, dan skenario. Dihitung otomatis dari export
              &quot;Content Analysis › Video List&quot; (post valid saja).
            </p>
          </div>
        </div>
        <MeagoMark />
      </header>

      <div className="kicker">Data snapshot / {period}</div>
      <div className="tiles">
        <Tile l="GMV kumulatif" v={rpJt(tot.gmv)} d={`${mo.length} bulan · post valid`} />
        <Tile l="Total order" v={n(tot.orders)} d={`rata-rata nilai order ${rpRb(tot.aov)}`} />
        <Tile l="Video views" v={jt(tot.views)} d="jangkauan konten kumulatif" />
        <Tile l="Redemption rate" v={pct(tot.red_rate)} d="nilai redemption ÷ GMV" />
      </div>
      <div className="grid2">
        <EditableInsight k="ins1" title={INSIGHT_TITLES.ins1} autoLines={auto.ins1} savedBody={ed("ins1")} />
        <EditableInsight k="ins2" title={INSIGHT_TITLES.ins2} autoLines={auto.ins2} savedBody={ed("ins2")} className="mr-callout g" />
      </div>
      {p.missing.length > 0 && (
        <p className="note">
          Bulan tanpa data di rentang ini tidak dihitung (tidak diisi perkiraan): {p.missing.map(monthLabelLong).join(", ")}.
        </p>
      )}

      {/* 01 */}
      <h2>
        <span className="n">01</span>Tren bulanan
      </h2>
      <p className="sub">GMV, order, dan views per bulan.</p>
      <div className="tiles">
        <Tile l={`GMV ${last.label}`} v={rpJt(last.gmv)} d={<><UpDown v={g} /> vs {first.label}</>} />
        <Tile l={`Order ${last.label}`} v={n(last.orders)} d={<><UpDown v={mom(first.orders, last.orders)} /> vs {first.label}</>} />
        <Tile
          l="Outlet bertransaksi"
          v={String(last.outlets_active)}
          d={`dari ${last.outlets_seen} outlet terlihat · ${first.label}: ${first.outlets_active}/${first.outlets_seen}`}
        />
        <Tile l="Creator ber-GMV" v={String(last.creators_gmv)} d={`dari ${last.creators_active} creator dengan post valid`} />
      </div>
      <div className="grid2">
        <div className="mr-card">
          <h3>GMV bulanan (Rp juta)</h3>
          <VBar labels={L} values={mo.map((m) => m.gmv / 1e6)} colors="var(--s1)" fmt={jtAxis} />
        </div>
        <div className="mr-card">
          <h3>Order bulanan</h3>
          <VBar labels={L} values={mo.map((m) => m.orders)} colors="var(--s3)" fmt={(v) => n(v)} />
        </div>
      </div>
      <div className="mr-card" style={{ marginTop: 12 }}>
        <h3>Data pendukung per bulan</h3>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Bulan</th>
                <th className="num">GMV (Rp jt)</th>
                <th className="num">Order</th>
                <th className="num">Views (jt)</th>
                <th className="num">Order/1k views</th>
                <th className="num">AOV (Rp rb)</th>
                <th className="num">Redemption</th>
                <th className="num">New post</th>
                <th className="num">Post aktif</th>
                <th className="num">Outlet trx/terlihat</th>
                <th className="num">Creator GMV/aktif</th>
                <th className="num">GMV MoM</th>
              </tr>
            </thead>
            <tbody>
              {mo.map((m, i) => (
                <tr key={m.period}>
                  <td>{monthLabelLong(m.period)}</td>
                  <td className="num">{f1(m.gmv / 1e6)}</td>
                  <td className="num">{n(m.orders)}</td>
                  <td className="num">{f2(m.views / 1e6)}</td>
                  <td className="num">{f2(m.order_per_1k)}</td>
                  <td className="num">{f1(m.aov / 1e3)}</td>
                  <td className="num">{pct(m.red_rate)}</td>
                  <td className="num">{n(m.new_posts)}</td>
                  <td className="num">{n(m.active_posts)}</td>
                  <td className="num">
                    {m.outlets_active}/{m.outlets_seen}
                  </td>
                  <td className="num">
                    {m.creators_gmv}/{m.creators_active}
                  </td>
                  <td className="num">{i ? delta(mom(mo[i - 1].gmv, m.gmv)) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 02 */}
      <h2>
        <span className="n">02</span>Digital insight: ubah jangkauan menjadi transaksi
      </h2>
      <div className="tiles">
        <Tile l={`Views ${last.label}`} v={jt(last.views)} d={<><UpDown v={mom(first.views, last.views)} /> vs {first.label}</>} />
        <Tile l="Order / 1.000 views" v={f2(last.order_per_1k)} d={`dari ${f2(first.order_per_1k)} di ${first.label}`} />
        <Tile l={`New post ${last.label}`} v={n(last.new_posts)} d={<><UpDown v={mom(first.new_posts, last.new_posts)} /> vs {first.label}</>} />
        <Tile l="GMV / post aktif" v={rpRb(last.gmv_per_post)} d={`dari ${rpRb(first.gmv_per_post)} di ${first.label}`} />
      </div>
      <EditableInsight k="ins3" title={INSIGHT_TITLES.ins3} autoLines={auto.ins3} savedBody={ed("ins3")} className="mr-callout y" />
      <p className="note">Order per 1.000 views adalah rasio agregat bulanan (Σorder ÷ Σviews/1.000), bukan click-through rate platform.</p>

      {/* 03 */}
      <h2>
        <span className="n">03</span>Kategori order: sebaran outlet
      </h2>
      <p className="sub">
        Sebaran outlet berdasarkan jumlah order per bulan. Penyebut = outlet yang muncul di export bulan itu (
        {mo.map((m) => `${m.outlets_seen} di ${m.label}`).join(", ")}).
      </p>
      <div className="tiles">
        <Tile l="Outlet 0 order" v={`${first.buckets[b0] ?? 0} → ${last.buckets[b0] ?? 0}`} d={`${first.label} → ${last.label}`} />
        <Tile l={`Outlet >${topEdge} order`} v={`${first.outlets_gt_top} → ${last.outlets_gt_top}`} d={`${first.label} → ${last.label}`} />
        <Tile
          l={`Outlet ≥${P.bucket_edges[2] + 1} order di ${last.label}`}
          v={String((last.buckets[BL[4]] ?? 0) + (last.buckets[BL[5]] ?? 0))}
          d={`${last.buckets[BL[4]] ?? 0} outlet ${bucketText[BL[4]]} + ${last.buckets[BL[5]] ?? 0} outlet ${bucketText[BL[5]]}`}
        />
      </div>
      <div className="grid2">
        <div className="mr-card">
          <h3>Sebaran kategori order per bulan</h3>
          <Stacked
            labels={L}
            series={BL.map((b) => mo.map((m) => m.buckets[b] ?? 0))}
            seriesLabels={BL.map((b) => bucketText[b])}
            colors={["var(--o1)", "var(--o2)", "var(--o3)", "var(--o4)", "var(--o5)", "var(--o6)"]}
          />
          <div className="legend">
            {BL.map((b, i) => (
              <span key={b}>
                <i style={{ background: `var(--o${i + 1})` }} />
                {bucketText[b]}
              </span>
            ))}
          </div>
        </div>
        <div className="mr-card">
          <h3>Perubahan kategori</h3>
          <table>
            <thead>
              <tr>
                <th>Kategori</th>
                {mo.map((m) => (
                  <th key={m.period} className="num">
                    {m.label}
                  </th>
                ))}
                <th className="num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {BL.map((b) => {
                const d = (last.buckets[b] ?? 0) - (first.buckets[b] ?? 0);
                return (
                  <tr key={b}>
                    <td>{bucketText[b]}</td>
                    {mo.map((m) => (
                      <td key={m.period} className="num">
                        {m.buckets[b] ?? 0}
                      </td>
                    ))}
                    <td className="num">
                      {d > 0 ? "+" : ""}
                      {d}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <EditableInsight k="ins6" title={INSIGHT_TITLES.ins6} autoLines={auto.ins6} savedBody={ed("ins6")} kind="para" className="mr-callout g" />
        </div>
      </div>

      {/* 04 */}
      <h2>
        <span className="n">04</span>Outlet &amp; kota: perbesar yang terbukti efektif
      </h2>
      <div className="grid2">
        <div className="mr-card">
          <h3>Top outlet berdasarkan GMV {period} (Rp juta)</h3>
          <HBar labels={top8.map((o) => o.name || o.id)} values={top8.map((o) => o.gmv / 1e6)} colors="var(--s1)" fmt={(v) => `Rp${f1(v)} jt`} />
        </div>
        <div className="mr-card">
          <h3>GMV rata-rata per outlet per kota (Rp juta)</h3>
          <HBar labels={cities.map((c) => c.city)} values={cities.map((c) => c.gmv_per_outlet / 1e6)} colors="var(--s2)" fmt={(v) => `Rp${f1(v)} jt`} />
        </div>
      </div>
      <div className="mr-card" style={{ marginTop: 12 }}>
        <h3>10 outlet teratas</h3>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Outlet</th>
                <th>Kota</th>
                <th className="num">GMV (Rp jt)</th>
                <th className="num">Order</th>
                <th className="num">Redemption</th>
                <th className="num">
                  Order {L[0]}→{L[L.length - 1]}
                </th>
                <th className="num">
                  New post {L[0]}→{L[L.length - 1]}
                </th>
                <th>Layer</th>
              </tr>
            </thead>
            <tbody>
              {M.outlets.slice(0, 10).map((o) => (
                <tr key={o.id}>
                  <td>{o.name || o.id}</td>
                  <td>{o.city}</td>
                  <td className="num">{f1(o.gmv / 1e6)}</td>
                  <td className="num">{n(o.orders)}</td>
                  <td className="num">{pct(o.red_rate)}</td>
                  <td className="num">
                    {n(o.orders_by_month[L[0]] ?? 0)} → {n(o.orders_by_month[L[L.length - 1]] ?? 0)}
                  </td>
                  <td className="num">
                    {n(o.newpost_by_month[L[0]] ?? 0)} → {n(o.newpost_by_month[L[L.length - 1]] ?? 0)}
                  </td>
                  <td>Layer {o.layer}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="mr-card">
          <h3>Kota</h3>
          <table>
            <thead>
              <tr>
                <th>Kota</th>
                <th className="num">Outlet</th>
                <th className="num">GMV (Rp jt)</th>
                <th className="num">GMV/outlet</th>
                <th className="num">
                  {L[0]}→{L[L.length - 1]}
                </th>
                <th className="num">Δ</th>
              </tr>
            </thead>
            <tbody>
              {cities.map((c) => {
                const a = c.by_month[L[0]] ?? 0, b = c.by_month[L[L.length - 1]] ?? 0;
                return (
                  <tr key={c.city}>
                    <td>{c.city}</td>
                    <td className="num">{c.n_outlets}</td>
                    <td className="num">{f1(c.gmv / 1e6)}</td>
                    <td className="num">{f1(c.gmv_per_outlet / 1e6)}</td>
                    <td className="num">
                      {f1(a / 1e6)} → {f1(b / 1e6)}
                    </td>
                    <td className="num">{a ? delta(mom(a, b)) : "baru"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <EditableInsight
            k="ins4"
            title={INSIGHT_TITLES.ins4}
            autoLines={auto.ins4}
            savedBody={ed("ins4")}
            extra={<span> (skor = {pct(P.score_w_gmv, 0)} GMV + {pct(P.score_w_red, 0)} redemption + {pct(P.score_w_ord, 0)} order, peringkat persentil)</span>}
          />
          <EditableInsight k="ins5" title={INSIGHT_TITLES.ins5} autoLines={auto.ins5} savedBody={ed("ins5")} kind="para" className="mr-callout y" />
        </div>
      </div>

      {/* 05 */}
      <h2>
        <span className="n">05</span>Creator ecosystem: bintang utama dan bench cadangan
      </h2>
      <div className="tiles">
        <Tile l="Share 2 creator teratas" v={pct(cs.top2, 0)} d={`GMV ${period}`} />
        <Tile l="Share top 10 creator" v={pct(cs.top10, 0)} d={cs.top10 >= 0.7 ? "risiko konsentrasi tinggi" : "sebaran kontribusi"} />
        <Tile l="Creator Layer 1" v={String(cl["Layer 1"].n)} d={`${pct(tot.gmv ? cl["Layer 1"].gmv / tot.gmv : 0, 0)} GMV · basis prioritas retensi`} />
        <Tile l="Belum bound/linked" v={String(cl["Tidak bound/linked"].n)} d={`punya post valid tapi tanpa status link di ${last.label}`} />
      </div>
      <div className="mr-card">
        <h3>Konsentrasi kontribusi GMV</h3>
        <div className="seg">
          <div style={{ flex: cs.top2, background: "var(--s1)" }}>{pct(cs.top2, 0)}</div>
          <div style={{ flex: share310, background: "var(--s4)", color: "#0b0b0b" }}>{pct(share310, 0)}</div>
          <div style={{ flex: shareRest, background: "var(--s2)" }}>{pct(shareRest, 0)}</div>
        </div>
        <div className="legend">
          <span>
            <i style={{ background: "var(--s1)" }} />
            Top 2 creator · {pct(cs.top2, 0)}
          </span>
          <span>
            <i style={{ background: "var(--s4)" }} />
            Creator posisi 3–10 · {pct(share310, 0)}
          </span>
          <span>
            <i style={{ background: "var(--s2)" }} />
            Creator lainnya · {pct(shareRest, 0)}
          </span>
        </div>
      </div>
      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="mr-card">
          <h3>Basis creator berdasarkan layer</h3>
          <table>
            <thead>
              <tr>
                <th>Kelompok</th>
                <th className="num">Jumlah</th>
                <th className="num">GMV (Rp jt)</th>
                <th>Gerakan</th>
              </tr>
            </thead>
            <tbody>
              <LayerRow label="Layer 1" v={cl["Layer 1"]} move="Amankan cadence, retensi, backup per kota" />
              <LayerRow label="Layer 2" v={cl["Layer 2"]} move="Coaching hook, CTA, template lokal" />
              <LayerRow label={`Layer 3 (views ≥${n(P.creator_l3_min_views)}, GMV 0)`} v={cl["Layer 3"]} move="Uji 3–5 post; evaluasi 30 hari" />
              <LayerRow label="Monitor (bound, views rendah / GMV kecil)" v={cl.Monitor} move="Pembinaan dasar" />
              <LayerRow label="Belum bound/linked" v={cl["Tidak bound/linked"]} move="Re-bind yang paling potensial" />
            </tbody>
          </table>
        </div>
        <div className="mr-card">
          <h3>Keaktifan creator bound (hari sejak post terakhir, as-of akhir {last.label})</h3>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th className="num">Creator</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Aktif (≤14 hari)</td>
                <td className="num">{act.Aktif}</td>
              </tr>
              <tr>
                <td>Melambat (15–30 hari)</td>
                <td className="num">{act.Melambat}</td>
              </tr>
              <tr>
                <td>Tidak posting &gt;30 hari</td>
                <td className="num">{act["Tidak posting >30 hari"]}</td>
              </tr>
            </tbody>
          </table>
          <EditableInsight k="ins7" title={INSIGHT_TITLES.ins7} autoLines={auto.ins7} savedBody={ed("ins7")} kind="para" />
        </div>
      </div>
      <div className="mr-card" style={{ marginTop: 12 }}>
        <h3>Profil 8 creator teratas</h3>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Creator</th>
                <th>Kota</th>
                <th>Lv.</th>
                <th className="num">GMV (Rp jt)</th>
                <th className="num">% GMV</th>
                <th className="num">GMV/post (Rp rb)</th>
                <th className="num">Post</th>
                <th>Status</th>
                <th>Aktivitas</th>
              </tr>
            </thead>
            <tbody>
              {M.creators_top.slice(0, 8).map((c) => (
                <tr key={c.username}>
                  <td>{c.username}</td>
                  <td>{c.city}</td>
                  <td>{c.level}</td>
                  <td className="num">{f1(c.gmv / 1e6)}</td>
                  <td className="num">{pct(tot.gmv ? c.gmv / tot.gmv : 0)}</td>
                  <td className="num">{n(c.gmv_per_post / 1e3)}</td>
                  <td className="num">{n(c.posts)}</td>
                  <td>{c.bound ? "Bound" : "Belum bound"}</td>
                  <td>{c.activity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 06 */}
      <h2>
        <span className="n">06</span>Best case practice: formula konten yang bisa direplikasi
      </h2>
      <p className="sub">
        Analisis post-level {period} ({n(B.n_rows)} baris post × outlet valid).
      </p>
      <div className="tiles">
        <Tile l="Top 5% post" v={pct(B.top5_share)} d={`kontribusi GMV (${n(B.n_top)} baris)`} />
        <Tile l="Median views top 5%" v={n(B.median_views_top)} d={`dibanding ${n(B.median_views_rest)} pada post lain`} />
        <Tile l="Durasi unggul" v={bestDur} d="peluang menjual tertinggi" />
      </div>
      <div className="grid2">
        <div className="mr-card">
          <h3>Durasi video vs peluang menjual (% post yang menghasilkan order)</h3>
          <HBar
            labels={DURATION_BUCKETS}
            values={durRate.map((r) => r * 100)}
            colors={DURATION_BUCKETS.map((k) => (k === bestDur ? "var(--s2)" : "var(--o2)"))}
            fmt={(v) => `${f1(v)}% menjual`}
            labelW={90}
          />
        </div>
        <div className="mr-card">
          <h3>Jangkauan post vs peluang menjual</h3>
          <HBar labels={VIEW_BUCKETS} values={vwRate.map((r) => r * 100)} colors="var(--s2)" fmt={(v) => `${f1(v)}% menjual`} labelW={110} />
        </div>
      </div>
      <div className="grid2" style={{ marginTop: 12 }}>
        <div className="mr-card">
          <h3>Fitur caption yang mengangkat penjualan</h3>
          <table>
            <thead>
              <tr>
                <th>Fitur (kata kunci di Post title)</th>
                <th className="num">Post</th>
                <th className="num">% menjual</th>
                <th className="num">Tanpa fitur</th>
                <th className="num">Lift GMV/post</th>
              </tr>
            </thead>
            <tbody>
              {B.features.map((f) => (
                <tr key={f.feature}>
                  <td>{f.feature}</td>
                  <td className="num">{n(f.n)}</td>
                  <td className="num">{pct(f.sell_rate)}</td>
                  <td className="num">{pct(f.sell_rate_without)}</td>
                  <td className="num">{f1(f.lift)}×</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">Deteksi heuristik dari judul post (caption penuh tidak ada di export).</p>
        </div>
        <div className="mr-card">
          <h3>GMV per post menurut Task type (Rp rb)</h3>
          <VBar
            labels={M.task_types.map((t) => t.name)}
            values={M.task_types.map((t) => t.gmv_per_post / 1e3)}
            colors="var(--s1)"
            fmt={(v, ax) => (ax ? `${v}`.replace(".", ",") : `Rp${f1(v)} rb`)}
          />
          <EditableInsight k="ins8" title={INSIGHT_TITLES.ins8} autoLines={auto.ins8} savedBody={ed("ins8")} kind="para" />
        </div>
      </div>
      <div className="mr-card" style={{ marginTop: 12 }}>
        <h3>Contoh post terbaik</h3>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Creator</th>
                <th>Outlet</th>
                <th>Judul</th>
                <th className="num">Views</th>
                <th className="num">GMV (Rp jt)</th>
                <th className="num">Durasi</th>
              </tr>
            </thead>
            <tbody>
              {B.top_posts.map((t, i) => (
                <tr key={i}>
                  <td>{t.creator}</td>
                  <td>{t.outlet}</td>
                  <td>{t.title}</td>
                  <td className="num">{n(t.views)}</td>
                  <td className="num">{f1(t.gmv / 1e6)}</td>
                  <td className="num">{t.duration ? Math.trunc(t.duration) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 07 */}
      <h2>
        <span className="n">07</span>Skenario {scenTitle} — asumsi, bukan prediksi
      </h2>
      <p className="sub">
        Baseline = GMV {last.label} ({rpJt(last.gmv)}). Pengali per skenario adalah <span className="mr-badge">parameter</span> yang diisi staf.
      </p>
      <div className="grid2">
        <div className="mr-card">
          <h3>GMV per skenario (Rp juta)</h3>
          <VBar
            labels={M.scenario.map((s) => s.name)}
            values={M.scenario.map((s) => s.values.reduce((a, b) => a + b, 0) / 1e6)}
            colors={["var(--o2)", "var(--s1)", "var(--s2)"]}
            fmt={jtAxis}
          />
        </div>
        <div className="mr-card">
          <table>
            <thead>
              <tr>
                <th>Skenario</th>
                {scenPeriods.map((x) => (
                  <th key={x} className="num">
                    {x}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {M.scenario.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  {s.values.map((v, i) => (
                    <td key={i} className="num">
                      {f1(v / 1e6)}
                    </td>
                  ))}
                  <td className="num">{f1(s.values.reduce((a, b) => a + b, 0) / 1e6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">
            {Object.entries(P.scenario)
              .map(([k, v]) => `${k} ${v.map((x) => `${String(x).replace(".", ",")}×`).join(" / ")}`)
              .join("; ")}{" "}
            dari baseline.
          </p>
        </div>
      </div>
      <ParamsForm scenario={P.scenario} kpi={P.kpi} />
      <div className="tiles">
        <Tile l="KPI AOV" v={`≥${rpRb(P.kpi.aov_min).replace(",0 rb", " rb")}`} d={`sekarang ${rpRb(last.aov)}`} />
        <Tile l="KPI redemption" v={`≥${pct(P.kpi.red_min, 0)}`} d={`sekarang ${pct(last.red_rate)}`} />
        <Tile l="KPI konversi" v={`≥${f2(P.kpi.conv_min)}`} d={`sekarang ${f2(last.order_per_1k)}`} />
        <Tile l="KPI share top-2" v={`<${pct(P.kpi.top2_max, 0)}`} d={`sekarang ${pct(cs.top2, 0)}`} />
      </div>
      <p className="note">
        Kalender momentum (11.11, 12.12, libur akhir tahun) dan roadmap mingguan + PIC adalah bagian editorial yang diisi staf, bukan dihitung dari data.
      </p>

      {/* 08 */}
      <h2>
        <span className="n">08</span>Catatan data &amp; cara membaca
      </h2>
      <div className="mr-card">
        <ul>
          <li>
            <b>Sumber</b>: export TikTok GO &quot;Content Analysis › Video List&quot; bulan {M.periods.map(monthLabelLong).join(", ")}, hanya baris
            berstatus <i>Valid posts</i>. Baris pecahan untuk post × outlet yang sama dijumlahkan.
          </li>
          <li>
            <b>Bulan yang dihitung</b>: hanya bulan yang datanya lengkap. Bulan berformat export lama (USD, tanpa status/judul/kota) atau dengan Post ID /
            Location ID rusak (dibulatkan Excel) tidak dimasukkan sampai di-export ulang.
            {p.missing.length > 0 && <> Tidak ada data untuk: {p.missing.map(monthLabelLong).join(", ")}.</>}
          </li>
          <li>
            <b>Definisi</b>: redemption rate = redemption amount ÷ sales value; AOV = GMV ÷ order; order/1.000 views = Σorder ÷ (Σviews/1.000); new post =
            post yang tanggal tayangnya di bulan tersebut; post aktif = post unik dengan baris valid; outlet bertransaksi = order &gt; 0.
          </li>
          <li>
            <b>Unit baris</b> = post × outlet; satu post yang di-tag ke beberapa outlet dihitung di tiap outlet.
          </li>
          <li>
            <b>Status bound</b> diambil dari kolom Creator link status pada bulan terakhir (snapshot), bukan riwayat.
          </li>
        </ul>
      </div>

      <footer>
        <span>
          {brand.toUpperCase()} · Internal business review{p.leadCode ? ` · ${p.leadCode}` : ""} · <b style={{ color: "var(--meago)" }}>MEAGO!</b>
        </span>
        <span>Dibuat {p.generatedAt} · MEAGO! (PT MEA Agensi Digital)</span>
      </footer>
    </div>
  );
}

function Tile({ l, v, d }: { l: string; v: string; d: React.ReactNode }) {
  return (
    <div className="tile">
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      <div className="d">{d}</div>
    </div>
  );
}

function LayerRow({ label, v, move }: { label: string; v: { n: number; gmv: number }; move: string }) {
  return (
    <tr>
      <td>{label}</td>
      <td className="num">{v.n}</td>
      <td className="num">{f1(v.gmv / 1e6)}</td>
      <td>{move}</td>
    </tr>
  );
}

export function MeagoMark() {
  return (
    <div className="meago" title="Disiapkan oleh MEAGO! — Official TikTok GO Partner">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="meago-logo" src="/brand/meago-logo.png" alt="MEAGO! Official TikTok GO Partner" width={150} height={119} />
      <div className="mr-hint">Official TikTok GO Partner</div>
      <div className="mr-hint">Disiapkan oleh tim BD MEAGO!</div>
    </div>
  );
}
