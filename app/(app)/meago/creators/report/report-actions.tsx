"use client";

// Tombol aksi Report Bulanan: Cetak / simpan PDF (dialog print browser) & Excel
// (SheetJS lewat lib/xlsx-export — pola sama tombol Export Excel di Leads/Deals).
import { exportRowsToExcel } from "@/lib/xlsx-export";

export function ReportActions({ filename, rows }: { filename: string; rows: Record<string, unknown>[] }) {
  return (
    <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <button type="button" className="sm" onClick={() => window.print()}>
        Cetak / Simpan PDF
      </button>
      <button
        type="button"
        className="sm ghost2"
        onClick={() => exportRowsToExcel(filename, "Report Bulanan", rows)}
        disabled={rows.length === 0}
      >
        Unduh Excel
      </button>
    </div>
  );
}
