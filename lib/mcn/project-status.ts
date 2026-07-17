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
