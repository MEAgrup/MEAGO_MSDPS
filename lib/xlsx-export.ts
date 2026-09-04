// Export tabel client-side ke .xlsx pakai SheetJS (`xlsx`, sudah dependency
// package.json — sebelumnya hanya dipakai server-side utk parsing upload,
// lihat lib/mcn/file-read.ts). Dipakai oleh tombol "Export Excel" di tab
// Leads & Prospek dan Merchant Deals.
import * as XLSX from "xlsx";

export function exportRowsToExcel(filename: string, sheetName: string, rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
