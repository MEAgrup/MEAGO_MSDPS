// Format angka laporan merchant — cermin helper render_report.py (gaya Indonesia:
// titik ribuan, koma desimal). Pure.

const nf = (d: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
const NF0 = nf(0), NF1 = nf(1), NF2 = nf(2);

export const n = (v: number) => NF0.format(v);
export const f1 = (v: number) => NF1.format(v);
export const f2 = (v: number) => NF2.format(v);
export const rp = (v: number) => "Rp" + NF0.format(v);
export const rpJt = (v: number) => `Rp${f1(v / 1e6)} jt`;
export const rpRb = (v: number) => `Rp${f1(v / 1e3)} rb`;
export const jt = (v: number) => `${f2(v / 1e6)} jt`;
export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d).replace(".", ",")}%`;
export const mom = (a: number, b: number) => (a ? (b - a) / a : 0);
export const delta = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1).replace(".", ",")}%`;
