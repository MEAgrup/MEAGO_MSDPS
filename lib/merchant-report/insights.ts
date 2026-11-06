// Teks insight OTOMATIS laporan merchant (aturan dari render_report.py). Ini teks
// DEFAULT — tim BD/CM bisa mengeditnya per merchant + periode; versi edit disimpan
// di merchant_report_notes (migrasi 0378) dan menang atas teks di sini.
// Format: TEKS POLOS, satu elemen array = satu poin/baris. Pure.

import type { ReportMetrics, ReportParams, Monthly } from "./metrics";
import { rpJt, rpRb, pct, f2, mom, n } from "./format";

export type InsightKey = "ins1" | "ins2" | "ins3" | "ins4" | "ins5" | "ins6" | "ins7" | "ins8";
export type Insights = Record<InsightKey, string[]>;

export const INSIGHT_TITLES: Record<InsightKey, string> = {
  ins1: "Apa yang sudah bekerja",
  ins2: "Apa yang perlu diperkuat",
  ins3: "Tindakan digital",
  ins4: "Layer outlet",
  ins5: "Audit prioritas",
  ins6: "KPI outlet",
  ins7: "Retensi & diversifikasi creator",
  ins8: "Arah konten",
};
export const INSIGHT_KEYS = Object.keys(INSIGHT_TITLES) as InsightKey[];

const naikTurun = (v: number) => (v >= 0 ? "naik" : "turun");
const change = (a: number, b: number, la: string, lb: string) =>
  a === b ? `tetap ${a} (${la} dan ${lb})` : `${b < a ? "turun" : "naik"} dari ${a} (${la}) menjadi ${b} (${lb})`;

/** Ringkasan bulanan saja — dipakai juga portal merchant (yang hanya punya angka bulanan). */
export type MonthlyLite = Pick<Monthly, "label" | "gmv" | "orders" | "views" | "order_per_1k" | "outlets_gt_top">;

export function monthlyInsights(mo: MonthlyLite[], zeroOrder: number[], topEdge: number): string[] {
  const out: string[] = [];
  if (mo.length === 0) return out;
  const first = mo[0], last = mo[mo.length - 1];
  if (mo.length === 1) {
    out.push(`${last.label} menghasilkan GMV ${rpJt(last.gmv)} dari ${n(last.orders)} order.`);
    out.push(`Konversi ${f2(last.order_per_1k)} order per 1.000 views.`);
    return out;
  }
  const g = mom(first.gmv, last.gmv);
  out.push(`${last.label} menghasilkan GMV ${rpJt(last.gmv)}, ${naikTurun(g)} ${pct(Math.abs(g))} dibanding ${first.label}.`);
  const dv = mom(first.views, last.views), dor = mom(first.orders, last.orders);
  out.push(
    last.order_per_1k > first.order_per_1k
      ? `Konversi membaik: ${f2(last.order_per_1k)} order per 1.000 views (dari ${f2(first.order_per_1k)}). Views ${naikTurun(dv)} ${pct(Math.abs(dv))} dan order ${naikTurun(dor)} ${pct(Math.abs(dor))}.`
      : `Konversi melemah: ${f2(last.order_per_1k)} order per 1.000 views (dari ${f2(first.order_per_1k)}).`,
  );
  const z0 = zeroOrder[0] ?? 0, z1 = zeroOrder[zeroOrder.length - 1] ?? 0;
  out.push(
    `Outlet tanpa order ${change(z0, z1, first.label, last.label)}; ` +
      `outlet >${topEdge} order ${change(first.outlets_gt_top, last.outlets_gt_top, first.label, last.label)}.`,
  );
  return out;
}

export function autoInsights(m: ReportMetrics, p: ReportParams): Insights {
  const mo = m.monthly;
  const first = mo[0], last = mo[mo.length - 1];
  const L = m.labels;
  const periodLabel = `${L[0]}–${L[L.length - 1]} ${m.periods[m.periods.length - 1].slice(0, 4)}`;
  const top = p.bucket_edges[3];
  const cs = m.creator_share;

  const ins1 = monthlyInsights(mo, mo.map((x) => x.buckets[m.bucket_labels[0]] ?? 0), top);

  const ins2 = [
    `Dua kreator teratas menyumbang ${pct(cs.top2, 0)} GMV ${periodLabel}` +
      (cs.top2 >= p.kpi.top2_max ? " — risiko konsentrasi; perlu bench kreator cadangan." : "."),
    `Dari ${n(cs.n)} kreator yang punya post valid, hanya ${n(cs.n_gmv)} yang menghasilkan GMV.`,
  ];
  if (last.aov < p.kpi.aov_min) {
    ins2.push(`AOV ${rpRb(last.aov)} masih di bawah target ${rpRb(p.kpi.aov_min)} — dorong paket bernilai lebih tinggi.`);
  }

  const ins3 = [
    `Jaga order/1.000 views ≥ ${f2(p.kpi.conv_min)}: bila turun di bawah 0,35 selama 2 minggu, uji ulang hook harga dan voucher.`,
    "CTA konsisten di caption: klik tag lokasi → pilih voucher → bayar → tukar di outlet (lihat bukti di bagian Best Practice).",
    "Kenaikan volume post belum otomatis menaikkan GMV per post — prioritaskan kualitas format yang terbukti.",
  ];

  const lo = m.layer_outlet;
  const tgo = lo[1].gmv + lo[2].gmv + lo[3].gmv;
  const sh = (v: number) => pct(tgo ? v / tgo : 0, 0);
  const ins4 = [
    `Layer 1 · ${lo[1].n} outlet · ${rpJt(lo[1].gmv)} (${sh(lo[1].gmv)} GMV) → jaga cadence creator, uji bundling, LIVE rutin.`,
    `Layer 2 · ${lo[2].n} outlet · ${rpJt(lo[2].gmv)} (${sh(lo[2].gmv)}) → 2–3 post berkualitas/minggu, tiru hook Layer 1.`,
    `Layer 3 · ${lo[3].n} outlet · ${rpJt(lo[3].gmv)} (${sh(lo[3].gmv)}) → konten multi-outlet per kota, cek POI & voucher.`,
  ];

  const lowRed = m.outlets.slice(0, 20).filter((o) => o.gmv > 5e6 && o.red_rate < p.low_red);
  const ins5 = [
    lowRed.length
      ? lowRed.map((o) => `${o.name} redemption ${pct(o.red_rate, 0)} (GMV ${rpJt(o.gmv)})`).join("; ") + "."
      : `Tidak ada outlet ber-GMV >Rp5 jt dengan redemption <${pct(p.low_red, 0)}.`,
    "Verifikasi status voucher dan masa berlaku sebelum menyimpulkan penyebab.",
  ];

  const ins6 = [`≥25 outlet mencapai >${top} order pada bulan puncak; outlet 0 order ≤2 dan tiap anomali punya PIC.`];
  const ins7 = [
    "Retensi: hubungi personal creator Layer 1 yang melambat; jangan biarkan dua creator utama turun pada periode yang sama.",
    `Diversifikasi: targetkan share top-2 <${pct(p.kpi.top2_max, 0)} dengan memperkuat bench, bukan mengurangi creator utama.`,
  ];
  const ins8 = [
    "Utamakan kualitas format dan distribusi creator berkinerja — bukan sekadar memperbanyak post atau membeli paket kolaborasi tanpa bukti GMV.",
  ];
  void first;
  return { ins1, ins2, ins3, ins4, ins5, ins6, ins7, ins8 };
}

/** Teks tersimpan (body polos) -> baris. */
export function bodyToLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*[-•*]\s+/, "").trimEnd())
    .filter((s) => s.trim() !== "");
}
