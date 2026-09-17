// Template + parser client-side untuk "Import Bulking" (tab Merchant Deals).
// SheetJS (`xlsx`) sudah dependency project (lihat lib/xlsx-export.ts) —
// dipakai di sini untuk (a) membuat file template .xlsx berisi kolom yang
// wajib diisi + contoh baris + sheet "Panduan Pengisian", dan (b) membaca file
// .xlsx/.csv yang diupload user jadi baris siap dikirim ke server action
// importMasterDealBulk.

import * as XLSX from "xlsx";
import type { ImportDealRow } from "@/lib/actions/deals";

// Header kolom sheet "Data" — urutan ini juga dipakai saat membaca file yang
// diupload (lihat parseDealImportFile), supaya template & parser tidak pernah
// menyimpang satu sama lain.
export const IMPORT_TEMPLATE_HEADERS = [
  "Unique_ID",
  "Bentuk_Kerjasama",
  "Nominal",
  "Benefit_Diberikan",
  "Visit_Mulai",
  "Visit_Berakhir",
  "Jumlah_Kreator",
  "Jumlah_Konten",
  "Link_Brief",
] as const;

const EXAMPLE_ROWS: (string | number)[][] = [
  [
    "DEAL-EXT-0001",
    "Berbayar",
    1500000,
    "Free Meals + Diskon 20%",
    "2026-07-01 10:00",
    "2026-07-01 14:00",
    3,
    5,
    "https://drive.google.com/contoh-brief",
  ],
  ["DEAL-EXT-0002", "Free/Barter", "", "Free Stay 1 malam", "2026-07-05", "2026-07-06", 2, "", ""],
];

const GUIDE_ROWS: (string | number)[][] = [
  ["Panduan Pengisian Template Import Bulking — Merchant Deals"],
  [""],
  [
    "Cara pakai: isi kolom di sheet \"Data\" (baris 1 = header, JANGAN diubah/dihapus), satu baris = satu transaksi. " +
      "Setelah selesai, upload file ini lewat tombol \"Import Bulking\" di tab Merchant Deals.",
  ],
  [""],
  [
    "PENTING: baris hasil import BELUM LENGKAP (kategori POI, BD, PIC, dll belum terisi) — status akan tampil " +
      "\"Belum Lengkap\" di tabel. Setiap baris WAJIB dilengkapi satu per satu lewat tombol \"Lengkapi Data\" sebelum " +
      "masuk ke tracker operasional (POI Accommodation/TTD/Dining).",
  ],
  [""],
  ["Kolom", "Wajib?", "Format / Nilai yang diterima", "Contoh", "Kesalahan umum"],
  [
    "Unique_ID",
    "Wajib",
    "Teks bebas, HARUS unik (tidak boleh sama dengan Unique_ID lain yang sudah pernah diimpor/dicatat)",
    "DEAL-EXT-0001",
    "Dikosongkan, atau dipakai ulang dari baris/import sebelumnya (baris akan dilewati & ditandai duplikat)",
  ],
  [
    "Bentuk_Kerjasama",
    "Wajib",
    "Hanya \"Berbayar\" atau \"Free/Barter\" (boleh tulis \"Free\" atau \"Barter\" saja)",
    "Berbayar",
    "Salah ketik (mis. \"Bayar\", \"Barter Free\") — baris akan dilewati",
  ],
  [
    "Nominal",
    "Wajib jika Berbayar",
    "Angka saja, tanpa \"Rp\" (boleh pakai titik/koma ribuan, mis. 1.500.000). Kosongkan/abaikan untuk Free/Barter.",
    "1500000",
    "Diisi teks (\"1,5 juta\") atau kosong padahal Bentuk Kerjasama = Berbayar",
  ],
  ["Benefit_Diberikan", "Opsional", "Teks bebas — benefit/kompensasi yang diberikan ke merchant/POI", "Free Meals + Diskon 20%", "—"],
  [
    "Visit_Mulai",
    "Opsional",
    "Format YYYY-MM-DD, jam opsional (YYYY-MM-DD HH:mm). Kolom Excel diformat sebagai teks/tanggal sama-sama diterima.",
    "2026-07-01 10:00",
    "Format tanggal lokal (31/12/2026) — tidak akan terbaca, baris tetap masuk tapi tanggal kosong",
  ],
  ["Visit_Berakhir", "Opsional", "Sama seperti Visit_Mulai", "2026-07-01 14:00", "Sama seperti Visit_Mulai"],
  [
    "Jumlah_Kreator",
    "Wajib",
    "Angka bulat > 0 — jumlah kreator yang dibutuhkan",
    "3",
    "Diisi 0, desimal, atau teks — baris akan dilewati",
  ],
  ["Jumlah_Konten", "Opsional", "Angka bulat ≥ 0 — jumlah konten yang ditargetkan", "5", "—"],
  ["Link_Brief", "Opsional", "URL brief/SOW (Google Drive, dsb)", "https://drive.google.com/...", "—"],
  [""],
  ["Batas: maksimal 500 baris per file/import — pecah jadi beberapa file kalau datanya lebih banyak."],
];

export function downloadDealImportTemplate() {
  const wb = XLSX.utils.book_new();

  const dataWs = XLSX.utils.aoa_to_sheet([[...IMPORT_TEMPLATE_HEADERS], ...EXAMPLE_ROWS]);
  dataWs["!cols"] = IMPORT_TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(16, h.length + 2) }));
  XLSX.utils.book_append_sheet(wb, dataWs, "Data");

  const guideWs = XLSX.utils.aoa_to_sheet(GUIDE_ROWS);
  guideWs["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 50 }, { wch: 24 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, guideWs, "Panduan");

  XLSX.writeFile(wb, "template-import-merchant-deals.xlsx");
}

// parseDealImportFile — baca file .xlsx/.xls/.csv yang diupload user, ambil
// sheet pertama, baris pertama dianggap header (dicocokkan longgar: huruf
// kecil, spasi/underscore diabaikan), sisanya jadi baris ImportDealRow siap
// dikirim ke server action. Tidak melakukan validasi nilai di sini — itu
// tugas importMasterDealBulk (server), supaya satu-satunya tempat aturan
// validasi hidup adalah server action.
export async function parseDealImportFile(file: File): Promise<ImportDealRow[]> {
  const buf = await file.arrayBuffer();
  // cellDates: true — kolom Excel berformat tanggal (mis. Visit_Mulai diisi
  // lewat date picker, bukan diketik sebagai teks) datang sebagai Date, bukan
  // serial number Excel; ditangani di cell() di bawah.
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];

  const aoa = XLSX.utils.sheet_to_json<(string | number | Date)[]>(sheet, { header: 1, blankrows: false });
  if (aoa.length === 0) return [];

  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/[\s_]+/g, "");
  const headerRow = aoa[0].map(norm);
  const colIndex = (name: string) => headerRow.indexOf(norm(name));

  const idx = {
    unique_id: colIndex("Unique_ID"),
    bentuk_kerjasama: colIndex("Bentuk_Kerjasama"),
    nominal: colIndex("Nominal"),
    benefit: colIndex("Benefit_Diberikan"),
    visit_mulai: colIndex("Visit_Mulai"),
    visit_berakhir: colIndex("Visit_Berakhir"),
    jumlah_kreator: colIndex("Jumlah_Kreator"),
    jumlah_konten: colIndex("Jumlah_Konten"),
    link_brief: colIndex("Link_Brief"),
  };

  // Sel tanggal Excel (cellDates: true) datang sebagai Date — SheetJS
  // membentuknya via Date.UTC dari nilai literal di spreadsheet, jadi dibaca
  // balik pakai getter UTC (bukan getter lokal) supaya tanggal/jam tidak
  // bergeser mengikuti timezone browser/server.
  function dateCellToText(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const y = d.getUTCFullYear();
    const mo = pad(d.getUTCMonth() + 1);
    const da = pad(d.getUTCDate());
    const h = pad(d.getUTCHours());
    const mi = pad(d.getUTCMinutes());
    return `${y}-${mo}-${da} ${h}:${mi}`;
  }

  const cell = (row: (string | number | Date)[], i: number): string => {
    if (i < 0 || row[i] == null || row[i] === "") return "";
    const v = row[i];
    if (v instanceof Date) return dateCellToText(v);
    return String(v).trim();
  };

  return aoa
    .slice(1)
    .filter((row) => row.some((c) => String(c ?? "").trim() !== ""))
    .map((row) => ({
      unique_id: cell(row, idx.unique_id),
      bentuk_kerjasama: cell(row, idx.bentuk_kerjasama),
      nominal: cell(row, idx.nominal),
      benefit: cell(row, idx.benefit),
      visit_mulai: cell(row, idx.visit_mulai),
      visit_berakhir: cell(row, idx.visit_berakhir),
      jumlah_kreator: cell(row, idx.jumlah_kreator),
      jumlah_konten: cell(row, idx.jumlah_konten),
      link_brief: cell(row, idx.link_brief),
    }));
}
