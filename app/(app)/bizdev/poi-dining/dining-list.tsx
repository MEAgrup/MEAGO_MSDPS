"use client";

import { useMemo, useState } from "react";
import { PoiCard, type PoiTransaction } from "../poi/poi-card";
import { DiningBerbayarCard, type DiningBerbayarCycle } from "./dining-berbayar-card";
import {
  POI_DINING_FREEBARTER_STEPS,
  POI_DINING_BERBAYAR_STEPS,
  POI_DINING_BERBAYAR_TOTAL_STEPS,
  DINING_FREEBARTER_PRE_VISIT_END_STEP,
  DINING_FREEBARTER_POST_VISIT_END_STEP,
  effectiveOpsDatetime,
  visitDatetime,
  sopProgressStatus,
  diningBerbayarStatus,
  stepCompletedAt,
  computePoiSla,
  formatSlaDuration,
  formatJakartaDatetime,
  jakartaYMD,
  shiftYMD,
  type PoiSopStepDef,
} from "@/lib/mcn/poi-sop";
import { exportRowsToExcel } from "@/lib/xlsx-export";
import { tanggal } from "@/lib/format";

export type DiningCard =
  | { kind: "freebarter"; tx: PoiTransaction }
  | { kind: "berbayar"; cycle: DiningBerbayarCycle };

const PAGE_SIZE = 9;

type ScheduleFilter = "all" | "tomorrowVisit" | "tomorrowOps" | "notDone";
type BentukFilter = "all" | "Berbayar" | "Free/Barter";

const SCHEDULE_FILTERS: { key: ScheduleFilter; label: string }[] = [
  { key: "all", label: "Semua Jadwal" },
  { key: "tomorrowVisit", label: "Besok Visit" },
  { key: "tomorrowOps", label: "Besok Ops" },
  { key: "notDone", label: "Belum Selesai" },
];

// Field yang sama-sama dipunyai kedua varian kartu, dipakai search & filter.
function commonFields(card: DiningCard) {
  return card.kind === "freebarter"
    ? {
        brand_name: card.tx.brand_name,
        code: card.tx.code,
        pic_name: card.tx.pic_name,
        bd_name: card.tx.bd_name,
        ops_name: card.tx.ops_name,
        bentuk: "Free/Barter" as const,
      }
    : {
        brand_name: card.cycle.brand_name,
        code: card.cycle.code,
        pic_name: card.cycle.pic_name,
        bd_name: card.cycle.bd_name,
        ops_name: card.cycle.ops_name,
        bentuk: "Berbayar" as const,
      };
}

// DiningList — tab POI Dining: search wildcard (POI/ID/PIC/BD), filter Bentuk
// Kerja Sama & Nama Ops, filter jadwal via klik, paginasi 9 card/halaman.
// Menyatukan dua alur SOP berbeda (Free/Barter linear vs Berbayar per-siklus
// bulanan) dalam satu grid supaya UX-nya sama dengan tab POI Accommodation & TTD.
export function DiningList({
  cards,
  opsNames,
  canApproveSkip,
  freebarterStepDefs = POI_DINING_FREEBARTER_STEPS,
  berbayarStepDefs = POI_DINING_BERBAYAR_STEPS,
}: {
  cards: DiningCard[];
  opsNames: readonly string[];
  canApproveSkip: boolean;
  freebarterStepDefs?: PoiSopStepDef[];
  berbayarStepDefs?: PoiSopStepDef[];
}) {
  const [query, setQuery] = useState("");
  const [bentuk, setBentuk] = useState<BentukFilter>("all");
  const [opsFilter, setOpsFilter] = useState<string>("all");
  const [schedule, setSchedule] = useState<ScheduleFilter>("all");
  const [page, setPage] = useState(1);

  const tomorrowYMD = useMemo(() => shiftYMD(jakartaYMD(new Date()), 1), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((card) => {
      const f = commonFields(card);
      if (bentuk !== "all" && f.bentuk !== bentuk) return false;
      if (opsFilter !== "all" && (f.ops_name ?? "") !== opsFilter) return false;

      if (schedule === "tomorrowVisit") {
        if (card.kind !== "freebarter" || card.tx.visit_start_date !== tomorrowYMD) return false;
      }
      if (schedule === "tomorrowOps") {
        const opsEffective =
          card.kind === "freebarter"
            ? effectiveOpsDatetime(card.tx.ops_datetime, card.tx.visit_start_date)
            : card.cycle.ops_datetime
              ? new Date(card.cycle.ops_datetime)
              : null;
        if (!opsEffective || jakartaYMD(opsEffective) !== tomorrowYMD) return false;
      }
      if (schedule === "notDone") {
        const allDone =
          card.kind === "freebarter"
            ? sopProgressStatus(card.tx.steps, POI_DINING_FREEBARTER_STEPS).allDone
            : diningBerbayarStatus(card.cycle.steps).allDone;
        if (allDone) return false;
      }

      if (q) {
        const hay = `${f.brand_name} ${f.code ?? ""} ${f.pic_name ?? ""} ${f.bd_name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, query, bentuk, opsFilter, schedule, tomorrowYMD]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount);
  const paginated = filtered.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  function resetToPage1<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  // Satu sheet untuk dua alur SOP yang berbeda (Free/Barter linear vs Berbayar
  // per-siklus bulanan): kolomnya disamakan, yang tidak berlaku dikosongkan —
  // supaya hasil export bisa langsung di-pivot per POI tanpa menggabung file.
  function exportExcel() {
    const now = new Date();
    const rows = filtered.map((card) => {
      if (card.kind === "freebarter") {
        const t = card.tx;
        const opsEffective = effectiveOpsDatetime(t.ops_datetime, t.visit_start_date);
        const { lastCompletedStep, currentStep, allDone } = sopProgressStatus(t.steps, freebarterStepDefs);
        const sla = computePoiSla({
          opsDatetime: opsEffective,
          visitDatetime: visitDatetime(t.visit_start_date, t.visit_start_time),
          preVisitEndCompletedAt: stepCompletedAt(t.steps, DINING_FREEBARTER_PRE_VISIT_END_STEP),
          postVisitEndCompletedAt: stepCompletedAt(t.steps, DINING_FREEBARTER_POST_VISIT_END_STEP),
          now,
        });
        return {
          "ID Merchant": t.code ?? "",
          "POI / Merchant": t.brand_name,
          "Bentuk Kerja Sama": "Free/Barter",
          Siklus: "",
          "Periode Siklus": "",
          BD: t.bd_name,
          "Nama Ops": t.ops_name ?? "",
          PIC: t.pic_name ?? "",
          "Tanggal Visit": t.visit_start_date ?? "",
          "Jam Visit": (t.visit_start_time ?? "").slice(0, 5),
          "Tanggal Ops": formatJakartaDatetime(opsEffective),
          "Step Selesai": allDone ? freebarterStepDefs.length : lastCompletedStep,
          "Total Step": freebarterStepDefs.length,
          "Step Berjalan": allDone ? "Selesai" : `Step ${currentStep?.step} — ${currentStep?.task}`,
          "SLA Total": sla.total,
          "Pre-Visit SLA": sla.preVisit,
          "Post-Visit SLA": sla.postVisit,
          "Actual VT": t.actual_vt ?? "",
          "Total GMV": t.total_gmv ?? "",
          "Status Report": t.report_status ?? "",
          "Link Report": t.report_link ?? "",
          Notes: t.notes ?? "",
        };
      }

      const c = card.cycle;
      const { lastCompletedSequentialStep, currentStep, allDone } = diningBerbayarStatus(c.steps);
      const opsAt = c.ops_datetime ? new Date(c.ops_datetime) : null;
      const lastStepCompletedAt = stepCompletedAt(c.steps, POI_DINING_BERBAYAR_TOTAL_STEPS);
      return {
        "ID Merchant": c.code ?? "",
        "POI / Merchant": c.brand_name,
        "Bentuk Kerja Sama": "Berbayar",
        Siklus: c.cycle_no,
        "Periode Siklus": `${tanggal(c.period_start)} – ${tanggal(c.period_end)}`,
        BD: c.bd_name,
        "Nama Ops": c.ops_name ?? "",
        PIC: c.pic_name ?? "",
        "Tanggal Visit": "",
        "Jam Visit": "",
        "Tanggal Ops": formatJakartaDatetime(opsAt),
        "Step Selesai": allDone ? POI_DINING_BERBAYAR_TOTAL_STEPS : lastCompletedSequentialStep,
        "Total Step": POI_DINING_BERBAYAR_TOTAL_STEPS,
        "Step Berjalan": allDone ? "Selesai" : `Step ${currentStep?.step} — ${currentStep?.task}`,
        "SLA Total": formatSlaDuration(opsAt, lastStepCompletedAt ? new Date(lastStepCompletedAt) : now),
        "Pre-Visit SLA": "",
        "Post-Visit SLA": "",
        "Actual VT": c.actual_vt ?? "",
        "Total GMV": c.total_gmv ?? "",
        "Status Report": c.report_status ?? "",
        "Link Report": c.report_link ?? "",
        Notes: c.notes ?? "",
      };
    });
    exportRowsToExcel("poi-dining", "POI Dining", rows);
  }

  return (
    <div className="card">
      <div className="table-toolbar">
        <h2>Transaksi ({filtered.length})</h2>
        <button type="button" className="sm ghost2" onClick={exportExcel} disabled={filtered.length === 0}>
          Export Excel
        </button>
      </div>

      <div className="filters-row">
        <div>
          <label>Cari POI, ID, PIC, atau BD</label>
          <input value={query} onChange={(e) => resetToPage1(setQuery)(e.target.value)} placeholder="search..." />
        </div>
        <div>
          <label>Bentuk Kerja Sama</label>
          <select value={bentuk} onChange={(e) => resetToPage1(setBentuk)(e.target.value as BentukFilter)}>
            <option value="all">Semua Bentuk</option>
            <option value="Berbayar">Berbayar</option>
            <option value="Free/Barter">Free/Barter</option>
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
          {paginated.map((card) =>
            card.kind === "freebarter" ? (
              <PoiCard
                key={`fb-${card.tx.deal_id}`}
                tx={card.tx}
                opsNames={opsNames}
                stepDefs={freebarterStepDefs}
                preVisitEndStep={DINING_FREEBARTER_PRE_VISIT_END_STEP}
                postVisitEndStep={DINING_FREEBARTER_POST_VISIT_END_STEP}
                reportWarningStep={DINING_FREEBARTER_POST_VISIT_END_STEP - 1}
                badgeLabel="Free/Barter"
              />
            ) : (
              <DiningBerbayarCard
                key={`b-${card.cycle.cycle_id}`}
                cycle={card.cycle}
                opsNames={opsNames}
                canApproveSkip={canApproveSkip}
                stepDefs={berbayarStepDefs}
              />
            )
          )}
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
