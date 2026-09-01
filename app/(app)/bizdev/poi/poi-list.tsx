"use client";

import { useMemo, useState } from "react";
import { PoiCard, type PoiTransaction } from "./poi-card";
import {
  POI_TAB_CATEGORIES,
  POI_CATEGORY_LABELS,
  effectiveOpsDatetime,
  sopProgressStatus,
  jakartaYMD,
  shiftYMD,
  type PoiTabCategory,
} from "@/lib/mcn/poi-sop";

const PAGE_SIZE = 9;

type ScheduleFilter = "all" | "tomorrowVisit" | "tomorrowOps" | "notDone";

const SCHEDULE_FILTERS: { key: ScheduleFilter; label: string }[] = [
  { key: "all", label: "Semua Jadwal" },
  { key: "tomorrowVisit", label: "Besok Visit" },
  { key: "tomorrowOps", label: "Besok Ops" },
  { key: "notDone", label: "Belum Selesai" },
];

// PoiList — search wildcard (POI/ID/PIC/BD), filter kategori & Nama Ops,
// filter jadwal via klik (Semua/Besok Visit/Besok Ops/Belum Selesai), dan
// paginasi 9 card/halaman utk tab POI Accommodation & TTD.
export function PoiList({ transactions, opsNames }: { transactions: PoiTransaction[]; opsNames: readonly string[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PoiTabCategory | "all">("all");
  const [opsFilter, setOpsFilter] = useState<string>("all");
  const [schedule, setSchedule] = useState<ScheduleFilter>("all");
  const [page, setPage] = useState(1);

  const tomorrowYMD = useMemo(() => shiftYMD(jakartaYMD(new Date()), 1), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter((t) => {
      if (category !== "all" && t.kategori_poi !== category) return false;
      if (opsFilter !== "all" && (t.ops_name ?? "") !== opsFilter) return false;

      if (schedule === "tomorrowVisit" && t.visit_start_date !== tomorrowYMD) return false;
      if (schedule === "tomorrowOps") {
        const opsEffective = effectiveOpsDatetime(t.ops_datetime, t.visit_start_date);
        if (!opsEffective || jakartaYMD(opsEffective) !== tomorrowYMD) return false;
      }
      if (schedule === "notDone" && sopProgressStatus(t.steps).allDone) return false;

      if (q) {
        const hay = `${t.brand_name} ${t.code ?? ""} ${t.pic_name ?? ""} ${t.bd_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [transactions, query, category, opsFilter, schedule, tomorrowYMD]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const paginated = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  function resetToPage1<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  return (
    <div className="card">
      <h2>Transaksi ({filtered.length})</h2>

      <div className="filters-row">
        <div>
          <label>Cari POI, ID, PIC, atau BD</label>
          <input
            value={query}
            onChange={(e) => resetToPage1(setQuery)(e.target.value)}
            placeholder="search..."
          />
        </div>
        <div>
          <label>Kategori</label>
          <select value={category} onChange={(e) => resetToPage1(setCategory)(e.target.value as PoiTabCategory | "all")}>
            <option value="all">Semua Kategori</option>
            {POI_TAB_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {POI_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Nama Ops</label>
          <select value={opsFilter} onChange={(e) => resetToPage1(setOpsFilter)(e.target.value)}>
            <option value="all">Semua Nama Ops</option>
            {opsNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value="">— belum dipilih —</option>
          </select>
        </div>
      </div>

      <div className="actions-row" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        {SCHEDULE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={schedule === f.key ? "sm" : "sm ghost2"}
            onClick={() => resetToPage1(setSchedule)(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="muted">Tidak ada transaksi yang cocok dengan filter.</p>
      ) : (
        <div className="poi-grid">
          {paginated.map((t) => (
            <PoiCard key={t.deal_id} tx={t} opsNames={opsNames} />
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="pagination">
          <div className="muted">
            Halaman {clampedPage} dari {pageCount}
          </div>
          <div className="actions-row">
            <button
              type="button"
              className="sm ghost2"
              disabled={clampedPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹ Sebelumnya
            </button>
            <button
              type="button"
              className="sm ghost2"
              disabled={clampedPage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Selanjutnya ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
