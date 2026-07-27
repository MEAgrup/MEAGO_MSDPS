import { diffDaysYMD } from "./weeks";

// Badge status Special Project untuk list lintas workspace (CM/Acquisition/BizDev).
// "Persiapan" = tanggal mulai belum tiba dan project belum selesai/batal — turunan
// tanggal, BUKAN status baru di DB (state machine tetap draft/active/done/cancelled).
// Pure & testable; `today` (YYYY-MM-DD) dioper dari caller.
export function projectBadge(
  status: string,
  startDate: string,
  today: string
): { cls: string; label: string } {
  if (status === "done") return { cls: "gray", label: "Selesai" };
  if (status === "cancelled") return { cls: "red", label: "Dibatalkan" };
  if (startDate > today) return { cls: "amber", label: "Persiapan" };
  if (status === "active") return { cls: "green", label: "Berjalan" };
  return { cls: "slate", label: "Draft" };
}

// Tanggal hari ini (YYYY-MM-DD) zona Asia/Jakarta — batas "Persiapan" mengikuti
// hari kalender operasional MEAGO, bukan UTC server.
export function todayJakartaYMD(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

// Ambang "hampir berakhir" untuk kontrak/binding kreator: < 30 hari ke depan.
// Dipakai badge & summary dashboard Follow Up Perpanjangan agar konsisten.
export const RENEWAL_SOON_DAYS = 30;

// Badge status perpanjangan dari binding_end_date (YYYY-MM-DD) relatif `today`.
// null bila tak ada tanggal berakhir. daysLeft = selisih hari (today→end):
//   < 0            → sudah lewat (merah)
//   0..29          → hampir berakhir (amber), label "N hari lagi"
//   >= 30          → aman (gray)
// Pure & testable; both `endDate` dan `today` berformat YMD zona Jakarta.
export function renewalBadge(
  endDate: string | null,
  today: string
): { cls: string; label: string; daysLeft: number } | null {
  if (!endDate) return null;
  const daysLeft = diffDaysYMD(today, endDate);
  if (daysLeft < 0) return { cls: "red", label: "sudah lewat", daysLeft };
  if (daysLeft < RENEWAL_SOON_DAYS)
    return { cls: "amber", label: daysLeft === 0 ? "berakhir hari ini" : `${daysLeft} hari lagi`, daysLeft };
  return { cls: "gray", label: "aman", daysLeft };
}
