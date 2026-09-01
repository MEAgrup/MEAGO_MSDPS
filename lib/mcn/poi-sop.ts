// Tab "POI Accommodation & TTD" (BizDev Workspace) — taksonomi step SOP visit
// kreator + kalkulasi SLA. HARUS sama persis dengan check constraint DB
// (poi_sop_steps.step_no 1..15, poi_sop_progress.report_status) di migrasi 0336.
//
// Kategori POI yang masuk tab ini adalah subset kategori_poi brand_deals:
// 'Accomodation' (POI Accommodation) & 'TTD'. 'Dining' TIDAK ditampilkan di sini.

export const POI_TAB_CATEGORIES = ["Accomodation", "TTD"] as const;
export type PoiTabCategory = (typeof POI_TAB_CATEGORIES)[number];

export const POI_CATEGORY_LABELS: Record<PoiTabCategory, string> = {
  Accomodation: "POI Accommodation",
  TTD: "TTD",
};

export function isPoiTabCategory(value: string | null): value is PoiTabCategory {
  return !!value && (POI_TAB_CATEGORIES as readonly string[]).includes(value);
}

export type PoiSopStepDef = { step: number; task: string; slaDays: number };

// Step → Task → SLA per spesifikasi tim Ops.
export const POI_SOP_STEPS: PoiSopStepDef[] = [
  { step: 1, task: "Membuat form listing kreator", slaDays: 1 },
  { step: 2, task: "Membuat info visit hotel sesuai standar", slaDays: 1 },
  { step: 3, task: "Infokan ke grup kreator", slaDays: 1 },
  { step: 4, task: "Cek & kurasi kreator koordinasi dengan BD", slaDays: 1 },
  {
    step: 5,
    task:
      "Jika masih kurang jumlah kreator akan di lempar ke grup batch & koordinasi dengan tim CM untuk kreator-kreator baru yang belum join grup kota",
    slaDays: 1,
  },
  { step: 6, task: "Mengumumkan ke grup kreator terpilih", slaDays: 1 },
  { step: 7, task: "Membuat grup khusus sementara untuk koordinasi", slaDays: 1 },
  {
    step: 8,
    task: "Memasukan kreator ke dalam grup & cek sudah masuk semua atau belum (maks H-2 sebelum visit)",
    slaDays: 1,
  },
  { step: 9, task: "Infokan perihal brief, SOW, & link pengumpulan VT di grup sementara", slaDays: 1 },
  { step: 10, task: "Reminder ke grup kreator untuk visit D day", slaDays: 1 },
  {
    step: 11,
    task: "Reminder pengumpulan VT H+1, H+3, H+5 (durasi pengumpulan VT maksimal H+7 dari visit)",
    slaDays: 7,
  },
  { step: 12, task: "Membuat & mengirimkan report pengumpulan VT ke BD", slaDays: 1 },
  {
    step: 13,
    task: "Membuat Monthly Report untuk hotel & performa, koordinasi dengan data analis atau by AI ke depannya",
    slaDays: 2,
  },
  {
    step: 14,
    task: "Menarik data dari Lark request ke tim Data Tiktok setiap tanggal 3/4 awal bulan & update data laporan semua POI tiap bulan",
    slaDays: 5,
  },
  { step: 15, task: "Membuat report data terupdate poin 13 sesuai req BD", slaDays: 2 },
];

export const POI_SOP_TOTAL_STEPS = POI_SOP_STEPS.length;
export const PRE_VISIT_END_STEP = 10;
export const POST_VISIT_END_STEP = 13;
export const REPORT_WARNING_STEP = 12;

export const REPORT_STATUS_OPTIONS = ["Approved", "Waiting Confirmation", "Request", "Revisi"] as const;
export type ReportStatus = (typeof REPORT_STATUS_OPTIONS)[number];

export type PoiSopStepRow = { step_no: number; completed_at: string | null };

// Indonesia (WIB) = UTC+7 tetap, tanpa DST — offset literal aman dipakai kapan
// pun tanpa bergantung pada timezone server (kontainer sering berjalan di UTC).
const JAKARTA_OFFSET = "+07:00";

// Geser "YYYY-MM-DD" sebanyak `delta` hari via kalkulasi UTC murni (tak
// bergantung timezone server) — dipakai utk saran H-10 dari Tanggal Visit.
function shiftYMD(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Saran "Tanggal Ops": H-10 dari Tanggal Visit, jam 00:00 WIB. Dipakai sebagai
// default tampilan/form selama ops_datetime belum di-set manual.
export function suggestedOpsDatetime(visitStartDate: string | null): Date | null {
  if (!visitStartDate) return null;
  return new Date(`${shiftYMD(visitStartDate, -10)}T00:00:00${JAKARTA_OFFSET}`);
}

// ops_datetime tersimpan (override, timestamptz — sudah instant absolut) bila
// ada; jika belum, pakai saran H-10.
export function effectiveOpsDatetime(opsDatetime: string | null, visitStartDate: string | null): Date | null {
  if (opsDatetime) return new Date(opsDatetime);
  return suggestedOpsDatetime(visitStartDate);
}

export function visitDatetime(visitStartDate: string | null, visitStartTime: string | null): Date | null {
  if (!visitStartDate) return null;
  return new Date(`${visitStartDate}T${(visitStartTime ?? "00:00:00").slice(0, 8)}${JAKARTA_OFFSET}`);
}

// Format instant absolut jadi string utk value <input type="datetime-local">
// (selalu tampil sebagai jam WIB, apa pun timezone server/browser).
export function toJakartaDatetimeLocalInput(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// Format instant absolut jadi label tampilan singkat ("22 Agu 2026, 14:30 WIB").
export function formatJakartaDatetime(d: Date | null): string {
  if (!d) return "—";
  const label = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${label} WIB`;
}

// Step terakhir yang sudah selesai (0 = belum ada) & step yang sedang berjalan
// (step pertama yang belum selesai; null bila seluruh 15 step sudah selesai).
export function sopProgressStatus(steps: PoiSopStepRow[]): {
  lastCompletedStep: number;
  currentStep: PoiSopStepDef | null;
  allDone: boolean;
} {
  const byStep = new Map(steps.map((s) => [s.step_no, s.completed_at]));
  let lastCompletedStep = 0;
  for (const s of POI_SOP_STEPS) {
    if (byStep.get(s.step)) lastCompletedStep = s.step;
    else break;
  }
  const allDone = lastCompletedStep >= POI_SOP_TOTAL_STEPS;
  const currentStep = allDone ? null : POI_SOP_STEPS.find((s) => s.step === lastCompletedStep + 1) ?? null;
  return { lastCompletedStep, currentStep, allDone };
}

export function stepCompletedAt(steps: PoiSopStepRow[], stepNo: number): string | null {
  return steps.find((s) => s.step_no === stepNo)?.completed_at ?? null;
}

// Durasi manusiawi ("12 hari 3 jam"), dibulatkan ke jam terdekat. null bila salah
// satu ujung tidak diketahui.
export function formatSlaDuration(from: Date | null, to: Date | null): string {
  if (!from || !to) return "—";
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return "0 jam";
  const totalHours = Math.round(ms / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0) return `${hours} jam`;
  if (hours === 0) return `${days} hari`;
  return `${days} hari ${hours} jam`;
}

export type PoiSlaSummary = { total: string; preVisit: string; postVisit: string };

// SLA Total     : Tanggal Ops → selesai step 13 (atau `now` bila belum selesai).
// Pre-Visit SLA : Tanggal Ops → selesai step 10 (atau `now` bila belum selesai).
// Post-Visit SLA: Tanggal Visit → selesai step 13 (atau `now` bila belum selesai).
export function computePoiSla(args: {
  opsDatetime: Date | null;
  visitDatetime: Date | null;
  step10CompletedAt: string | null;
  step13CompletedAt: string | null;
  now: Date;
}): PoiSlaSummary {
  const { opsDatetime, visitDatetime, step10CompletedAt, step13CompletedAt, now } = args;
  const step10End = step10CompletedAt ? new Date(step10CompletedAt) : now;
  const step13End = step13CompletedAt ? new Date(step13CompletedAt) : now;
  return {
    total: formatSlaDuration(opsDatetime, step13End),
    preVisit: formatSlaDuration(opsDatetime, step10End),
    postVisit: formatSlaDuration(visitDatetime, step13End),
  };
}
