"use client";

import { useMemo, useState } from "react";
import { hariDesimal, num, rupiah, tanggal } from "@/lib/format";
import { APPROACH_VIA, CRM_STATUSES, type CrmStatus } from "@/lib/leads/intake";
import { BarChart, CHART_COLORS, LineChart, PieChart } from "@/components/charts";
import { exportRowsToExcel } from "@/lib/xlsx-export";

export type DashLead = {
  id: string;
  code: string | null;
  brand_name: string | null;
  lead_name: string;
  bd_employee_id: string | null;
  brand_category: string | null;
  wilayah: string | null;
  source: string | null;
  crm_status: string;
  approach_via: string | null;
  benefit_dealing: string | null;
  nominal_bayar: number;
  created_at: string;
};

export type DashDeal = {
  id: string;
  brand_name: string;
  lead_id: string | null;
  bd_id: string | null;
  kategori_poi: string | null;
  bentuk_kerjasama: string | null;
  nominal_harga: number;
  created_at: string;
};

export type DashHistory = {
  lead_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
};

type BdOption = { id: string; full_name: string };

const STATUS_COLOR: Record<string, string> = {
  Leads: CHART_COLORS.gray,
  Approaching: CHART_COLORS.blue,
  "Follow Up": CHART_COLORS.yellow,
  Dealing: CHART_COLORS.green,
  Rejected: CHART_COLORS.red,
  Renewal: CHART_COLORS.violet,
};

const CATEGORY_COLOR: Record<string, string> = {
  Accomodation: CHART_COLORS.blue,
  Dining: CHART_COLORS.orange,
  TTD: CHART_COLORS.aqua,
};

const SKEMA_COLOR: Record<string, string> = {
  Berbayar: CHART_COLORS.blue,
  "Free/Barter": CHART_COLORS.orange,
};

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function inRange(iso: string, start: string, end: string): boolean {
  const d = dateOnly(iso);
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

function shortDate(d: string): string {
  const parts = d.split("-");
  return `${parts[2]}/${parts[1]}`;
}

function topN<T>(entries: [string, T][], n: number, sortVal: (v: T) => number): [string, T][] {
  return [...entries].sort((a, b) => sortVal(b[1]) - sortVal(a[1])).slice(0, n);
}

// CrmDashboard — filter periode/BD/status di client (data mentah diambil sekali
// di server, konsisten dengan pola Pool Lead & Daftar Deal). Bagian "leads"
// difilter berdasar leads.created_at; bagian "deals" berdasar brand_deals.created_at;
// timeseries approaching berdasar tanggal transisi status itu sendiri.
export function CrmDashboard({
  leads,
  deals,
  history,
  bdOptions,
  bdNameById,
}: {
  leads: DashLead[];
  deals: DashDeal[];
  history: DashHistory[];
  bdOptions: BdOption[];
  bdNameById: Record<string, string>;
}) {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [bdFilter, setBdFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<CrmStatus | "">("");

  const filteredLeads = useMemo(
    () =>
      leads.filter(
        (l) =>
          inRange(l.created_at, startDate, endDate) &&
          (!bdFilter || l.bd_employee_id === bdFilter) &&
          (!statusFilter || l.crm_status === statusFilter)
      ),
    [leads, startDate, endDate, bdFilter, statusFilter]
  );

  const filteredDeals = useMemo(
    () => deals.filter((d) => inRange(d.created_at, startDate, endDate) && (!bdFilter || d.bd_id === bdFilter)),
    [deals, startDate, endDate, bdFilter]
  );

  const bdByLeadId = useMemo(
    () => new Map(leads.map((l): [string, string | null] => [l.id, l.bd_employee_id])),
    [leads]
  );
  const wilayahByLeadId = useMemo(
    () => new Map(leads.map((l): [string, string | null] => [l.id, l.wilayah])),
    [leads]
  );

  // ---- Scorecards -----------------------------------------------------------
  const countByStatus = (s: string) => filteredLeads.filter((l) => l.crm_status === s).length;
  const totalLeads = filteredLeads.length;
  const totalDealsRevenue = filteredDeals.reduce((sum, d) => sum + (d.nominal_harga ?? 0), 0);

  const { avgLeadToApproach, avgApproachToDeal } = useMemo(() => {
    const leadIdSet = new Set(filteredLeads.map((l) => l.id));
    const leadCreatedAt = new Map(filteredLeads.map((l): [string, string] => [l.id, l.created_at]));
    const approachAtByLead = new Map<string, string>();
    const dealAtByLead = new Map<string, string>();
    for (const h of history) {
      if (!leadIdSet.has(h.lead_id)) continue;
      if (h.to_status === "Approaching" && !approachAtByLead.has(h.lead_id)) {
        approachAtByLead.set(h.lead_id, h.changed_at);
      }
      if (h.to_status === "Dealing" && !dealAtByLead.has(h.lead_id)) {
        dealAtByLead.set(h.lead_id, h.changed_at);
      }
    }
    const leadToApproachDiffs: number[] = [];
    approachAtByLead.forEach((at, leadId) => {
      const createdAt = leadCreatedAt.get(leadId);
      if (!createdAt) return;
      const diffDays = (new Date(at).getTime() - new Date(createdAt).getTime()) / 86400000;
      if (diffDays >= 0) leadToApproachDiffs.push(diffDays);
    });
    const approachToDealDiffs: number[] = [];
    dealAtByLead.forEach((dealAt, leadId) => {
      const approachAt = approachAtByLead.get(leadId);
      if (!approachAt) return;
      const diffDays = (new Date(dealAt).getTime() - new Date(approachAt).getTime()) / 86400000;
      if (diffDays >= 0) approachToDealDiffs.push(diffDays);
    });
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    return { avgLeadToApproach: avg(leadToApproachDiffs), avgApproachToDeal: avg(approachToDealDiffs) };
  }, [history, filteredLeads]);

  // ---- Chart datasets ---------------------------------------------------------

  // 4) Distribusi status leads
  const statusPie = CRM_STATUSES.map((s) => ({ label: s, value: countByStatus(s), color: STATUS_COLOR[s] }));

  // 5) Top 10 wilayah berdasarkan total leads
  const wilayahLeadsMap = new Map<string, number>();
  for (const l of filteredLeads) {
    const w = l.wilayah || "Tidak diisi";
    wilayahLeadsMap.set(w, (wilayahLeadsMap.get(w) ?? 0) + 1);
  }
  const top10WilayahLeads = topN([...wilayahLeadsMap.entries()], 10, (v) => v);

  // 6) Total leads / approaching / dealing per BD
  const byBd = new Map<string, { total: number; approaching: number; dealing: number }>();
  for (const l of filteredLeads) {
    const key = l.bd_employee_id ?? "—";
    const cur = byBd.get(key) ?? { total: 0, approaching: 0, dealing: 0 };
    cur.total += 1;
    if (l.crm_status === "Approaching") cur.approaching += 1;
    if (l.crm_status === "Dealing") cur.dealing += 1;
    byBd.set(key, cur);
  }
  const byBdSorted = [...byBd.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 15);
  const bdCategories = byBdSorted.map(([id]) => (id !== "—" ? bdNameById[id] ?? "—" : "—"));

  // 7) Total deals berdasarkan kategori brand
  const categoryMap = new Map<string, number>();
  for (const d of filteredDeals) {
    const cat = d.kategori_poi || "Lainnya";
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1);
  }
  const categoryEntries = [...categoryMap.entries()].sort((a, b) => b[1] - a[1]);

  // 8) Top 10 wilayah berdasarkan jumlah deals
  const wilayahDealsMap = new Map<string, number>();
  for (const d of filteredDeals) {
    const w = (d.lead_id && wilayahByLeadId.get(d.lead_id)) || "Tidak diketahui";
    wilayahDealsMap.set(w, (wilayahDealsMap.get(w) ?? 0) + 1);
  }
  const top10WilayahDeals = topN([...wilayahDealsMap.entries()], 10, (v) => v);

  // 9) Rasio dealing barter (gratis) vs berbayar
  const berbayarCount = filteredDeals.filter((d) => d.bentuk_kerjasama === "Berbayar").length;
  const freeBarterCount = filteredDeals.filter((d) => d.bentuk_kerjasama === "Free/Barter").length;
  const skemaPie = [
    { label: "Berbayar", value: berbayarCount, color: SKEMA_COLOR.Berbayar },
    { label: "Free/Barter", value: freeBarterCount, color: SKEMA_COLOR["Free/Barter"] },
  ];

  // 10) Total approaching berdasarkan hari
  const approachingPerDay = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of history) {
      if (h.to_status !== "Approaching") continue;
      if (bdFilter && bdByLeadId.get(h.lead_id) !== bdFilter) continue;
      if (!inRange(h.changed_at, startDate, endDate)) continue;
      const day = dateOnly(h.changed_at);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, count]) => ({ label: shortDate(day), value: count }));
  }, [history, bdByLeadId, bdFilter, startDate, endDate]);

  // 11) Distribusi media approach
  const mediaMap = new Map<string, number>();
  for (const l of filteredLeads) {
    if (l.approach_via) mediaMap.set(l.approach_via, (mediaMap.get(l.approach_via) ?? 0) + 1);
  }
  const mediaEntries = [...APPROACH_VIA]
    .map((m) => [m, mediaMap.get(m) ?? 0] as [string, number])
    .sort((a, b) => b[1] - a[1]);

  // 12) Perbandingan Dealing vs Renewal
  const dealingCount = countByStatus("Dealing");
  const renewalCount = countByStatus("Renewal");

  // 13) Top 10 benefit dealing
  const benefitMap = new Map<string, number>();
  for (const l of filteredLeads) {
    if ((l.crm_status === "Dealing" || l.crm_status === "Renewal") && l.benefit_dealing) {
      benefitMap.set(l.benefit_dealing, (benefitMap.get(l.benefit_dealing) ?? 0) + 1);
    }
  }
  const top10Benefit = topN([...benefitMap.entries()], 10, (v) => v);

  return (
    <>
      <div className="card">
        <h2>Filter</h2>
        <div className="filters-row" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
          <div>
            <label>Tanggal Awal</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label>Tanggal Akhir</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label>Nama BD</label>
            <select value={bdFilter} onChange={(e) => setBdFilter(e.target.value)}>
              <option value="">— semua —</option>
              {bdOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Status Leads</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as CrmStatus | "")}>
              <option value="">— semua —</option>
              {CRM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Leads</div>
          <div className="v">{num(totalLeads)}</div>
        </div>
        <div className="stat">
          <div className="k">Approaching</div>
          <div className="v">{num(countByStatus("Approaching"))}</div>
        </div>
        <div className="stat">
          <div className="k">Follow Up</div>
          <div className="v">{num(countByStatus("Follow Up"))}</div>
        </div>
        <div className="stat">
          <div className="k">Dealing</div>
          <div className="v">{num(dealingCount)}</div>
        </div>
        <div className="stat">
          <div className="k">Rejected</div>
          <div className="v">{num(countByStatus("Rejected"))}</div>
        </div>
        <div className="stat">
          <div className="k">Renewal</div>
          <div className="v">{num(renewalCount)}</div>
        </div>
        <div className="stat">
          <div className="k">Avg Approach ke Deals</div>
          <div className="v small">{hariDesimal(avgApproachToDeal)}</div>
        </div>
        <div className="stat">
          <div className="k">Avg Lead ke Approach</div>
          <div className="v small">{hariDesimal(avgLeadToApproach)}</div>
        </div>
        <div className="stat">
          <div className="k">Total Deals (Revenue)</div>
          <div className="v small">{rupiah(totalDealsRevenue)}</div>
        </div>
      </div>

      <div className="card">
        <div className="table-toolbar">
          <h2>Detail Leads ({filteredLeads.length})</h2>
          <button
            type="button"
            className="sm ghost2"
            disabled={filteredLeads.length === 0}
            onClick={() =>
              exportRowsToExcel(
                "dashboard-crm-leads",
                "Leads",
                filteredLeads.map((l) => ({
                  "Nama BD": (l.bd_employee_id && bdNameById[l.bd_employee_id]) ?? "",
                  "Tanggal Scouting": l.created_at?.slice(0, 10) ?? "",
                  Status: l.crm_status,
                  "Brand / Merchant / POI": l.brand_name ?? l.lead_name,
                  "Kategori Brand": l.brand_category ?? "",
                  Source: l.source ?? "",
                  Wilayah: l.wilayah ?? "",
                  Nominal: l.nominal_bayar,
                }))
              )
            }
          >
            Export Excel
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Nama BD</th>
                <th>Tanggal Scouting</th>
                <th>Status</th>
                <th>Brand / Merchant / POI</th>
                <th>Kategori Brand</th>
                <th>Source</th>
                <th>Wilayah</th>
                <th>Nominal</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((l) => (
                <tr key={l.id}>
                  <td>{(l.bd_employee_id && bdNameById[l.bd_employee_id]) ?? "—"}</td>
                  <td className="muted">{tanggal(dateOnly(l.created_at))}</td>
                  <td>{l.crm_status}</td>
                  <td>{l.brand_name ?? l.lead_name}</td>
                  <td className="muted">{l.brand_category ?? "—"}</td>
                  <td className="muted">{l.source ?? "—"}</td>
                  <td className="muted">{l.wilayah ?? "—"}</td>
                  <td>{rupiah(l.nominal_bayar)}</td>
                </tr>
              ))}
              {filteredLeads.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Tidak ada lead yang cocok dengan filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="chart-grid">
        <div className="card">
          <h2>Distribusi Status Leads</h2>
          <PieChart data={statusPie} />
        </div>

        <div className="card">
          <h2>Rasio Dealing: Barter (Gratis) vs Berbayar</h2>
          <PieChart data={skemaPie} />
        </div>

        <div className="card">
          <h2>Top 10 Wilayah — Total Leads</h2>
          <BarChart
            orientation="horizontal"
            categories={top10WilayahLeads.map(([k]) => k)}
            series={[{ name: "Leads", color: CHART_COLORS.blue, values: top10WilayahLeads.map(([, v]) => v) }]}
          />
        </div>

        <div className="card">
          <h2>Top 10 Wilayah — Jumlah Deals</h2>
          <BarChart
            orientation="horizontal"
            categories={top10WilayahDeals.map(([k]) => k)}
            series={[{ name: "Deals", color: CHART_COLORS.aqua, values: top10WilayahDeals.map(([, v]) => v) }]}
          />
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Total Leads, Approaching, Dealing per BD</h2>
          <BarChart
            categories={bdCategories}
            series={[
              { name: "Total Leads", color: CHART_COLORS.blue, values: byBdSorted.map(([, v]) => v.total) },
              { name: "Approaching", color: CHART_COLORS.orange, values: byBdSorted.map(([, v]) => v.approaching) },
              { name: "Dealing", color: CHART_COLORS.aqua, values: byBdSorted.map(([, v]) => v.dealing) },
            ]}
          />
        </div>

        <div className="card">
          <h2>Total Deals per Kategori Brand</h2>
          <BarChart
            orientation="horizontal"
            categories={categoryEntries.map(([k]) => k)}
            series={[{ name: "Deals", color: CHART_COLORS.blue, values: categoryEntries.map(([, v]) => v) }]}
            barColorsForSingleSeries={categoryEntries.map(([k]) => CATEGORY_COLOR[k] ?? CHART_COLORS.gray)}
          />
        </div>

        <div className="card">
          <h2>Perbandingan Dealing vs Renewal</h2>
          <BarChart
            categories={["Dealing", "Renewal"]}
            series={[{ name: "Leads", color: CHART_COLORS.green, values: [dealingCount, renewalCount] }]}
            barColorsForSingleSeries={[STATUS_COLOR.Dealing, STATUS_COLOR.Renewal]}
          />
        </div>

        <div className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>Total Approaching per Hari</h2>
          <LineChart points={approachingPerDay} color={CHART_COLORS.blue} />
        </div>

        <div className="card">
          <h2>Distribusi Media Approach</h2>
          <BarChart
            orientation="horizontal"
            categories={mediaEntries.map(([k]) => k)}
            series={[{ name: "Leads", color: CHART_COLORS.blue, values: mediaEntries.map(([, v]) => v) }]}
          />
        </div>

        <div className="card">
          <h2>Top 10 Benefit Dealing</h2>
          <BarChart
            orientation="horizontal"
            categories={top10Benefit.map(([k]) => k)}
            series={[{ name: "Dealing", color: CHART_COLORS.aqua, values: top10Benefit.map(([, v]) => v) }]}
          />
        </div>
      </div>
    </>
  );
}
