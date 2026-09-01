"use client";

// Grafik SVG ringan tanpa dependency (konsisten dengan sisa app yang plain
// React) — dipakai oleh Dashboard CRM. Palet kategorikal & aturan mark
// mengikuti panduan data-viz internal: hue tetap per entitas (tidak pernah
// di-cycle ulang), legend selalu ada untuk >=2 seri, label langsung dipakai
// selektif, dan setiap mark punya tooltip hover.

import { useState } from "react";

// ---- Palet kategorikal tervalidasi (urutan tetap, jangan diacak) -----------
export const CHART_COLORS = {
  blue: "#2a78d6",
  orange: "#eb6834",
  aqua: "#1baf7a",
  yellow: "#eda100",
  magenta: "#e87ba4",
  green: "#008300",
  violet: "#4a3aa7",
  red: "#e34948",
  gray: "#94a3b8",
} as const;

const INK_MUTED = "#64748b";
const GRIDLINE = "#e2e8f0";
const AXIS = "#cbd5e1";

type TooltipState = { x: number; y: number; content: React.ReactNode } | null;

function ChartTooltip({ tip }: { tip: TooltipState }) {
  if (!tip) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: tip.x,
        top: tip.y,
        transform: "translate(-50%, calc(-100% - 10px))",
        background: "#0f172a",
        color: "#fff",
        padding: "6px 10px",
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.4,
        pointerEvents: "none",
        whiteSpace: "nowrap",
        zIndex: 5,
        boxShadow: "0 6px 18px rgba(0,0,0,.25)",
      }}
    >
      {tip.content}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 10, fontSize: 12 }}>
      {items.map((it) => (
        <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, display: "inline-block" }} />
          <span style={{ color: "#334155" }}>{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export function EmptyChart({ label }: { label?: string }) {
  return (
    <div className="muted" style={{ padding: "32px 0", textAlign: "center", fontSize: 13 }}>
      {label ?? "Belum ada data untuk periode/filter ini."}
    </div>
  );
}

// =============================================================================
// BarChart — horizontal (ranking, satu seri, label kategori panjang) atau
// vertical grouped (beberapa seri berdampingan per kategori).
// =============================================================================
export function BarChart({
  categories,
  series,
  orientation = "vertical",
  formatValue = (n: number) => String(n),
  height = 280,
  barColorsForSingleSeries,
}: {
  categories: string[];
  series: { name: string; color: string; values: number[] }[];
  orientation?: "horizontal" | "vertical";
  formatValue?: (n: number) => string;
  height?: number;
  barColorsForSingleSeries?: string[];
}) {
  const [tip, setTip] = useState<TooltipState>(null);
  const maxVal = Math.max(1, ...series.flatMap((s) => s.values));
  const showLegend = series.length > 1;

  if (categories.length === 0 || series.every((s) => s.values.every((v) => v === 0))) {
    return <EmptyChart />;
  }

  if (orientation === "horizontal") {
    const s = series[0];
    const rowH = 28;
    const gap = 10;
    const chartH = categories.length * (rowH + gap);
    return (
      <div>
        <div style={{ overflowX: "auto" }}>
          <svg width="100%" viewBox={`0 0 640 ${chartH}`} style={{ minWidth: 420, display: "block" }} role="img">
            {categories.map((cat, i) => {
              const val = s.values[i] ?? 0;
              const w = (val / maxVal) * 430;
              const y = i * (rowH + gap);
              const color = barColorsForSingleSeries?.[i] ?? s.color;
              return (
                <g key={cat}>
                  <text x={0} y={y + rowH / 2 + 4} fontSize={12} fill="#334155">
                    {cat.length > 26 ? cat.slice(0, 25) + "…" : cat}
                  </text>
                  <rect x={190} y={y} width={430} height={rowH} rx={4} fill={GRIDLINE} opacity={0.4} />
                  <rect
                    x={190}
                    y={y}
                    width={Math.max(2, w)}
                    height={rowH}
                    rx={4}
                    fill={color}
                    onMouseEnter={(e) => {
                      const r = (e.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
                      setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content: `${cat}: ${formatValue(val)}` });
                    }}
                    onMouseMove={(e) => {
                      const r = (e.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
                      setTip({ x: e.clientX - r.left, y: e.clientY - r.top, content: `${cat}: ${formatValue(val)}` });
                    }}
                    onMouseLeave={() => setTip(null)}
                    style={{ cursor: "pointer" }}
                  />
                  <text x={190 + Math.max(2, w) + 8} y={y + rowH / 2 + 4} fontSize={12} fill="#0f172a" fontWeight={600}>
                    {formatValue(val)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div style={{ position: "relative" }}>
          <ChartTooltip tip={tip} />
        </div>
      </div>
    );
  }

  // vertical (grouped)
  const plotW = Math.max(360, categories.length * (series.length > 1 ? 70 : 46));
  const plotH = height - 40;
  const groupW = plotW / categories.length;
  const barW = Math.min(28, (groupW - 12) / series.length);

  return (
    <div>
      <div style={{ overflowX: "auto", position: "relative" }}>
        <svg width={plotW + 20} height={height} role="img">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={10}
              x2={plotW + 10}
              y1={10 + plotH * (1 - f)}
              y2={10 + plotH * (1 - f)}
              stroke={GRIDLINE}
              strokeWidth={1}
            />
          ))}
          <line x1={10} x2={10} y1={10} y2={10 + plotH} stroke={AXIS} strokeWidth={1} />
          <line x1={10} x2={plotW + 10} y1={10 + plotH} y2={10 + plotH} stroke={AXIS} strokeWidth={1} />
          {categories.map((cat, ci) => {
            const groupX = 10 + ci * groupW;
            return (
              <g key={cat}>
                {series.map((s, si) => {
                  const val = s.values[ci] ?? 0;
                  const h = maxVal > 0 ? (val / maxVal) * plotH : 0;
                  const x = groupX + (groupW - series.length * barW) / 2 + si * barW;
                  const y = 10 + plotH - h;
                  const color = barColorsForSingleSeries?.[ci] ?? s.color;
                  return (
                    <rect
                      key={s.name}
                      x={x + 1}
                      y={y}
                      width={Math.max(0, barW - 2)}
                      height={h}
                      rx={3}
                      fill={color}
                      onMouseEnter={(e) => {
                        const r = (e.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
                        setTip({
                          x: e.clientX - r.left,
                          y: e.clientY - r.top,
                          content: `${cat} · ${s.name}: ${formatValue(val)}`,
                        });
                      }}
                      onMouseMove={(e) => {
                        const r = (e.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
                        setTip({
                          x: e.clientX - r.left,
                          y: e.clientY - r.top,
                          content: `${cat} · ${s.name}: ${formatValue(val)}`,
                        });
                      }}
                      onMouseLeave={() => setTip(null)}
                      style={{ cursor: "pointer" }}
                    />
                  );
                })}
                <text x={groupX + groupW / 2} y={height - 16} fontSize={11} fill={INK_MUTED} textAnchor="middle">
                  {cat.length > 10 ? cat.slice(0, 9) + "…" : cat}
                </text>
              </g>
            );
          })}
          <ChartTooltip tip={tip} />
        </svg>
      </div>
      {showLegend && <Legend items={series.map((s) => ({ label: s.name, color: s.color }))} />}
    </div>
  );
}

// =============================================================================
// PieChart — donut dengan legend & tooltip. Persentase ditampilkan pada slice
// yang cukup besar (>=6%) supaya tidak bertumpuk.
// =============================================================================
export function PieChart({
  data,
  formatValue = (n: number) => String(n),
  size = 220,
}: {
  data: { label: string; value: number; color: string }[];
  formatValue?: (n: number) => string;
  size?: number;
}) {
  const [tip, setTip] = useState<TooltipState>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) return <EmptyChart />;

  const r = size / 2;
  const inner = r * 0.58;
  let angle = -Math.PI / 2;

  const arcs = data
    .filter((d) => d.value > 0)
    .map((d) => {
      const frac = d.value / total;
      const start = angle;
      const end = angle + frac * Math.PI * 2;
      angle = end;
      const midAngle = (start + end) / 2;
      const largeArc = end - start > Math.PI ? 1 : 0;
      const p = (a: number, radius: number) => [r + radius * Math.cos(a), r + radius * Math.sin(a)];
      const [x1, y1] = p(start, r);
      const [x2, y2] = p(end, r);
      const [ix1, iy1] = p(end, inner);
      const [ix2, iy2] = p(start, inner);
      const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${inner} ${inner} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
      const pct = Math.round(frac * 100);
      const [lx, ly] = p(midAngle, (r + inner) / 2);
      return { ...d, path, pct, lx, ly };
    });

  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ position: "relative" }}>
        <svg width={size} height={size} role="img">
          {arcs.map((a) => (
            <path
              key={a.label}
              d={a.path}
              fill={a.color}
              stroke="#fff"
              strokeWidth={2}
              onMouseEnter={(e) => {
                const rect = (e.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
                setTip({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  content: `${a.label}: ${formatValue(a.value)} (${a.pct}%)`,
                });
              }}
              onMouseMove={(e) => {
                const rect = (e.target as SVGElement).ownerSVGElement!.getBoundingClientRect();
                setTip({
                  x: e.clientX - rect.left,
                  y: e.clientY - rect.top,
                  content: `${a.label}: ${formatValue(a.value)} (${a.pct}%)`,
                });
              }}
              onMouseLeave={() => setTip(null)}
              style={{ cursor: "pointer" }}
            />
          ))}
          {arcs
            .filter((a) => a.pct >= 6)
            .map((a) => (
              <text
                key={`lbl-${a.label}`}
                x={a.lx}
                y={a.ly}
                fontSize={11}
                fontWeight={700}
                fill="#fff"
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {a.pct}%
              </text>
            ))}
          <text x={r} y={r - 4} fontSize={11} fill={INK_MUTED} textAnchor="middle">
            Total
          </text>
          <text x={r} y={r + 14} fontSize={16} fill="#0f172a" fontWeight={700} textAnchor="middle">
            {formatValue(total)}
          </text>
        </svg>
        <ChartTooltip tip={tip} />
      </div>
      <Legend items={data.map((d) => ({ label: `${d.label} (${formatValue(d.value)})`, color: d.color }))} />
    </div>
  );
}

// =============================================================================
// LineChart — satu seri timeseries, area tipis + garis 2px, hover crosshair.
// =============================================================================
export function LineChart({
  points,
  formatValue = (n: number) => String(n),
  color = CHART_COLORS.blue,
  height = 240,
}: {
  points: { label: string; value: number }[];
  formatValue?: (n: number) => string;
  color?: string;
  height?: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (points.length === 0 || points.every((p) => p.value === 0)) return <EmptyChart />;

  const w = Math.max(480, points.length * 26);
  const padL = 34;
  const padB = 24;
  const plotW = w - padL - 10;
  const plotH = height - padB - 10;
  const maxVal = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padL + i * stepX,
    y: 10 + plotH - (p.value / maxVal) * plotH,
    ...p,
  }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${10 + plotH} L ${coords[0].x} ${10 + plotH} Z`;

  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        width={w}
        height={height}
        role="img"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          let nearest = 0;
          let best = Infinity;
          coords.forEach((c, i) => {
            const d = Math.abs(c.x - x);
            if (d < best) {
              best = d;
              nearest = i;
            }
          });
          setHoverIdx(nearest);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={padL} x2={w - 10} y1={10 + plotH * (1 - f)} y2={10 + plotH * (1 - f)} stroke={GRIDLINE} strokeWidth={1} />
        ))}
        <text x={0} y={14} fontSize={10} fill={INK_MUTED}>
          {formatValue(maxVal)}
        </text>
        <text x={0} y={10 + plotH} fontSize={10} fill={INK_MUTED}>
          0
        </text>
        <path d={areaPath} fill={color} opacity={0.12} />
        <path d={linePath} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {coords.map((c, i) => (
          <circle key={c.label} cx={c.x} cy={c.y} r={hoverIdx === i ? 4 : 2.5} fill={color} />
        ))}
        {coords
          .filter((_, i) => i % Math.ceil(coords.length / 8 || 1) === 0)
          .map((c) => (
            <text key={`x-${c.label}`} x={c.x} y={height - 6} fontSize={10} fill={INK_MUTED} textAnchor="middle">
              {c.label}
            </text>
          ))}
        {hoverIdx !== null && (
          <line x1={coords[hoverIdx].x} x2={coords[hoverIdx].x} y1={10} y2={10 + plotH} stroke={AXIS} strokeWidth={1} strokeDasharray="3,3" />
        )}
      </svg>
      {hoverIdx !== null && (
        <div
          style={{
            fontSize: 12,
            color: "#334155",
            marginTop: 4,
          }}
        >
          <b>{coords[hoverIdx].label}</b>: {formatValue(coords[hoverIdx].value)}
        </div>
      )}
    </div>
  );
}
