"use client";

import { useState } from "react";
import { rupiah, num } from "@/lib/format";

export type WeekMetrics = {
  week: number; // 1..5
  gmv_total: number | null;
  orders: number | null;
  aov: number | null;
  redemption_amount: number | null;
  redeemed_orders: number | null;
  new_posts: number | null;
  posts_with_sales: number | null;
  live_streams: number | null;
  valid_live_streams: number | null;
};

export type Averages = {
  gmv_total: number | null;
  orders: number | null;
  aov: number | null;
  redemption_amount: number | null;
  redeemed_orders: number | null;
  new_posts: number | null;
  posts_with_sales: number | null;
  live_streams: number | null;
  valid_live_streams: number | null;
};

// Metrik yang BOLEH tampil di portal kreator (tanpa commission_share/refund/internal).
const RUPIAH_KEYS = ["gmv_total", "aov", "redemption_amount"] as const;

function MetricCard({ label, value, isRupiah }: { label: string; value: number | null; isRupiah: boolean }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "12px 14px",
        minWidth: 150,
        flex: "1 1 150px",
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>
        {isRupiah ? rupiah(value) : num(value)}
      </div>
    </div>
  );
}

function MetricGrid({ m }: { m: WeekMetrics | Averages }) {
  const items: { label: string; key: keyof Averages }[] = [
    { label: "GMV / Sales value", key: "gmv_total" },
    { label: "Orders", key: "orders" },
    { label: "AOV", key: "aov" },
    { label: "Redemption amount", key: "redemption_amount" },
    { label: "Redeemed orders", key: "redeemed_orders" },
    { label: "New posts", key: "new_posts" },
    { label: "Posts with sales", key: "posts_with_sales" },
    { label: "Live streams", key: "live_streams" },
    { label: "Valid live streams", key: "valid_live_streams" },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      {items.map((it) => (
        <MetricCard
          key={it.key}
          label={it.label}
          value={(m as Averages)[it.key]}
          isRupiah={(RUPIAH_KEYS as readonly string[]).includes(it.key)}
        />
      ))}
    </div>
  );
}

export function PerformaView({
  weeks,
  averages,
  monthLabel,
}: {
  weeks: WeekMetrics[];
  averages: Averages;
  monthLabel: string;
}) {
  const withData = new Set(weeks.map((w) => w.week));
  // Default: minggu terisi terakhir; bila tak ada, W1.
  const initial = weeks.length > 0 ? weeks[weeks.length - 1].week : 1;
  const [sel, setSel] = useState<number>(initial);
  const selected = weeks.find((w) => w.week === sel) ?? null;

  return (
    <>
      <div className="card">
        <h2>Performa Mingguan — {monthLabel}</h2>
        <p className="section-sub">Pilih minggu (W1–W5) bulan berjalan.</p>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {[1, 2, 3, 4, 5].map((w) => {
            const has = withData.has(w);
            const active = w === sel;
            return (
              <button
                key={w}
                type="button"
                className={active ? "" : "btn-ghost"}
                disabled={!has}
                onClick={() => setSel(w)}
                style={{ opacity: has ? 1 : 0.4 }}
              >
                W{w}
              </button>
            );
          })}
        </div>
        {selected ? (
          <MetricGrid m={selected} />
        ) : (
          <p className="muted">Belum ada data untuk minggu ini.</p>
        )}
      </div>

      <div className="card">
        <h2>Ringkasan Rata-rata 3 Bulan Terakhir</h2>
        <p className="section-sub">Rata-rata bulanan (bulan berjalan + 2 sebelumnya).</p>
        <MetricGrid m={averages} />
      </div>
    </>
  );
}
