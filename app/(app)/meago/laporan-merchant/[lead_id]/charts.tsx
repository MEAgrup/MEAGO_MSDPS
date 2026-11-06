// Chart SVG inline tanpa dependensi/CDN — port svg_vbar/svg_hbar/svg_stacked dari
// render_report.py. Warna lewat CSS var (var(--s1) dst.) supaya ikut mode gelap.
import type { ReactNode } from "react";

function ticks(vmax: number, k = 4): number[] {
  if (vmax <= 0) return [0, 1];
  const raw = vmax / k;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.min(...[1, 2, 2.5, 5, 10].filter((s) => s * mag >= raw)) * mag;
  const n = Math.ceil(vmax / step);
  return Array.from({ length: n + 1 }, (_, i) => step * i);
}

const svgStyle = { font: "11px system-ui, sans-serif", display: "block" } as const;
const colorAt = (c: string | string[], i: number) => (Array.isArray(c) ? c[i % c.length] : c);

export function VBar({
  labels,
  values,
  colors,
  fmt,
  w = 440,
  h = 210,
}: {
  labels: string[];
  values: number[];
  colors: string | string[];
  fmt: (v: number, axis: boolean) => string;
  w?: number;
  h?: number;
}) {
  const [pl, pr, pt, pb] = [44, 12, 18, 28];
  const pw = w - pl - pr, ph = h - pt - pb;
  const T = ticks(Math.max(0, ...values));
  const top = T[T.length - 1] || 1;
  const sy = (v: number) => pt + ph - (v / top) * ph;
  const slot = pw / Math.max(1, values.length);
  const bw = Math.min(48, slot * 0.6);
  const out: ReactNode[] = [];
  T.forEach((t, i) => {
    const y = sy(t);
    out.push(<line key={`g${i}`} x1={pl} y1={y} x2={w - pr} y2={y} stroke="var(--grid)" strokeWidth={1} />);
    out.push(<text key={`t${i}`} x={pl - 6} y={y + 4} textAnchor="end" fill="var(--muted)">{fmt(t, true)}</text>);
  });
  values.forEach((v, i) => {
    const x = pl + slot * i + (slot - bw) / 2;
    const y = sy(v);
    const hh = pt + ph - y;
    const col = colorAt(colors, i);
    const title = <title>{`${labels[i]}: ${fmt(v, false)}`}</title>;
    out.push(
      hh > 4 ? (
        <path key={`b${i}`} d={`M${x},${pt + ph} v${-(hh - 4)} a4,4 0 0 1 4,-4 h${bw - 8} a4,4 0 0 1 4,4 v${hh - 4} z`} fill={col}>{title}</path>
      ) : (
        <rect key={`b${i}`} x={x} y={y} width={bw} height={Math.max(hh, 0)} fill={col}>{title}</rect>
      ),
    );
    out.push(<text key={`v${i}`} x={x + bw / 2} y={y - 5} textAnchor="middle" fill="var(--ink)" fontWeight={700}>{fmt(v, false)}</text>);
    out.push(<text key={`l${i}`} x={x + bw / 2} y={h - 8} textAnchor="middle" fill="var(--ink2)">{labels[i]}</text>);
  });
  out.push(<line key="axis" x1={pl} y1={pt + ph} x2={w - pr} y2={pt + ph} stroke="var(--grid)" />);
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" style={svgStyle}>{out}</svg>;
}

export function HBar({
  labels,
  values,
  colors,
  fmt,
  w = 460,
  row = 26,
  labelW = 150,
}: {
  labels: string[];
  values: number[];
  colors: string | string[];
  fmt: (v: number) => string;
  w?: number;
  row?: number;
  labelW?: number;
}) {
  const h = values.length * row + 10;
  const pw = w - labelW - 110;
  const top = Math.max(0, ...values) || 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" style={svgStyle}>
      {values.map((v, i) => {
        const y = 5 + i * row;
        const bw = (v / top) * pw;
        const b = Math.max(bw - 4, 0);
        return (
          <g key={i}>
            <text x={labelW - 8} y={y + row / 2 + 4} textAnchor="end" fill="var(--ink2)">{Array.from(labels[i]).slice(0, 24).join("")}</text>
            <path d={`M${labelW},${y + 4} h${b} a4,4 0 0 1 4,4 v${row - 16} a4,4 0 0 1 -4,4 h${-b} z`} fill={colorAt(colors, i)}>
              <title>{`${labels[i]}: ${fmt(v)}`}</title>
            </path>
            <text x={labelW + bw + 6} y={y + row / 2 + 4} fill="var(--ink)" fontWeight={700}>{fmt(v)}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Stacked({
  labels,
  series,
  seriesLabels,
  colors,
  w = 440,
  h = 230,
}: {
  labels: string[];
  series: number[][];
  seriesLabels: string[];
  colors: string[];
  w?: number;
  h?: number;
}) {
  const [pl, pr, pt, pb] = [40, 12, 10, 28];
  const pw = w - pl - pr, ph = h - pt - pb;
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x[i] ?? 0), 0));
  const T = ticks(Math.max(0, ...totals));
  const top = T[T.length - 1] || 1;
  const slot = pw / Math.max(1, labels.length);
  const bw = Math.min(90, slot * 0.55);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" style={svgStyle}>
      {T.map((t, i) => {
        const y = pt + ph - (t / top) * ph;
        return (
          <g key={`t${i}`}>
            <line x1={pl} y1={y} x2={w - pr} y2={y} stroke="var(--grid)" />
            <text x={pl - 6} y={y + 4} textAnchor="end" fill="var(--muted)">{Math.round(t)}</text>
          </g>
        );
      })}
      {labels.map((lab, i) => {
        const x = pl + slot * i + (slot - bw) / 2;
        let acc = 0;
        return (
          <g key={lab}>
            {series.map((s, j) => {
              const v = s[i] ?? 0;
              if (v <= 0) return null;
              const y0 = pt + ph - ((acc + v) / top) * ph;
              const hh = (v / top) * ph - 2;
              acc += v;
              return (
                <g key={j}>
                  <rect x={x} y={y0} width={bw} height={Math.max(hh, 0)} fill={colors[j]}>
                    <title>{`${lab} · ${seriesLabels[j]}: ${v} outlet`}</title>
                  </rect>
                  {hh >= 14 && (
                    <text x={x + bw / 2} y={y0 + hh / 2 + 4} textAnchor="middle" fill={j < 2 ? "#0b0b0b" : "#fff"} fontWeight={700}>{v}</text>
                  )}
                </g>
              );
            })}
            <text x={x + bw / 2} y={h - 8} textAnchor="middle" fill="var(--ink2)">{lab}</text>
          </g>
        );
      })}
    </svg>
  );
}
