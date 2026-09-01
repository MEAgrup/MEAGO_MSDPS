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

// slaDays null = tidak ada SLA harian tetap (pakai slaLabel bila ada, mis. SLA
// rentang "7-30 hari sesuai dealing" atau step opsional Dining Berbayar 1-5).
export type PoiSopStepDef = { step: number; task: string; slaDays: number | null; slaLabel?: string };

export function formatStepSla(step: PoiSopStepDef): string {
  if (step.slaLabel) return step.slaLabel;
  if (step.slaDays == null) return "—";
  return `${step.slaDays} hari`;
}

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

// ---- Tab "POI Dining" (BizDev Workspace) ------------------------------------
// kategori_poi = 'Dining'. Dua alur berbeda menurut bentuk_kerjasama:
//  - 'Free/Barter' (17 step, berurutan) — flow SAMA seperti Accommodation & TTD
//    di atas, dipakai ulang tabel poi_sop_progress/poi_sop_steps (migrasi 0337
//    memperluas constraint step_no dari 1..15 jadi 1..17).
//  - 'Berbayar' (5 step opsional MOU/Invoice + 22 step total per SIKLUS
//    BULANAN) — tabel terpisah poi_dining_cycles/poi_dining_steps (migrasi
//    0337): lihat DiningStepRow & diningBerbayarStatus di bawah.
// Kedua flow berbagi 17 task inti yang sama persis (cuma beda nomor mulai),
// jadi didefinisikan sekali di DINING_CORE_STEP_DEFS lalu dipakai ulang.
const DINING_CORE_STEP_DEFS: { task: string; slaDays: number | null; slaLabel?: string }[] = [
  { task: "Membuat form listing kreator", slaDays: 1 },
  { task: "Membuat info dining sesuai standar", slaDays: 1 },
  { task: "Infokan ke grup kreator", slaDays: 1 },
  { task: "Membuat Creator Package sesuai dealing BD", slaDays: 2 },
  { task: "Cek & kurasi kreator koordinasi dengan BD", slaDays: 1 },
  {
    task:
      "Jika masih kurang jumlah kreator akan di lempar ke grup batch & koordinasi dengan tim CM untuk kreator-kreator baru yang belum join grup kota",
    slaDays: 1,
  },
  { task: "Mengumumkan ke grup kreator terpilih", slaDays: 1 },
  { task: "Membuat grup khusus sementara untuk koordinasi", slaDays: 1 },
  { task: "Memasukan kreator ke dalam grup & cek sudah masuk semua atau belum", slaDays: 1 },
  { task: "Infokan perihal brief, SOW, & link pengumpulan VT di grup sementara", slaDays: 1 },
  {
    task:
      "Memastikan VT sesuai brief merchant & koordinasi dengan BD & pihak brand terkait redeem produk & jika ada kendala di lapangan",
    slaDays: 1,
  },
  {
    task: "Reminder pengumpulan VT H+1, H+3, H+5 dst (sesuai timeline dealing dengan Brand) & check Creator Package",
    slaDays: null,
    slaLabel: "7–30 hari (sesuai dealing)",
  },
  { task: "Koordinasi secara berkala dengan PIC Merchant terkait project berjalan", slaDays: 1 },
  { task: "Membuat & mengirimkan report pengumpulan VT ke BD", slaDays: 1 },
  {
    task: "Membuat Monthly Report untuk hotel & performa, koordinasi dengan data analis atau by AI ke depannya",
    slaDays: 2,
  },
  {
    task:
      "Menarik data dari Lark request ke tim Data Tiktok setiap tanggal 3/4 awal bulan & update data laporan semua POI tiap bulan",
    slaDays: 5,
  },
  { task: "Membuat report data terupdate poin 13 sesuai req BD", slaDays: 2 },
];

// Dining 'Free/Barter': 17 step berurutan, sama seperti flow Accommodation & TTD.
export const POI_DINING_FREEBARTER_STEPS: PoiSopStepDef[] = DINING_CORE_STEP_DEFS.map((d, i) => ({
  step: i + 1,
  ...d,
}));
export const POI_DINING_FREEBARTER_TOTAL_STEPS = POI_DINING_FREEBARTER_STEPS.length;
export const DINING_FREEBARTER_PRE_VISIT_END_STEP = 11;
export const DINING_FREEBARTER_POST_VISIT_END_STEP = 15;

// Dining 'Berbayar': step 1-5 (MOU/Invoice/Payment) opsional & tidak berurutan
// + 17 step inti yang sama (nomor 6-22, berurutan, per siklus bulanan).
const DINING_BERBAYAR_MOU_TASKS = [
  "Membuat MOU",
  "Request Invoice ke Finance",
  "Kirim MOU ke klien",
  "Kirim Invoice ke klien",
  "Kirim bukti payment ke grup",
];
export const POI_DINING_BERBAYAR_STEPS: PoiSopStepDef[] = [
  ...DINING_BERBAYAR_MOU_TASKS.map((task) => ({ task, slaDays: null as number | null })),
  ...DINING_CORE_STEP_DEFS,
].map((d, i) => ({ step: i + 1, ...d }));
export const POI_DINING_BERBAYAR_TOTAL_STEPS = POI_DINING_BERBAYAR_STEPS.length; // 22
export const DINING_BERBAYAR_OPTIONAL_STEPS_END = 5; // step 1..5: opsional, boleh di-skip (approval Director)
export const DINING_BERBAYAR_FIRST_SEQUENTIAL_STEP = 6; // Tanggal Ops muncul setelah step ini selesai

export type PoiSopStepRow = { step_no: number; completed_at: string | null };

// Indonesia (WIB) = UTC+7 tetap, tanpa DST — offset literal aman dipakai kapan
// pun tanpa bergantung pada timezone server (kontainer sering berjalan di UTC).
const JAKARTA_OFFSET = "+07:00";

// Geser "YYYY-MM-DD" sebanyak `delta` hari via kalkulasi UTC murni (tak
// bergantung timezone server) — dipakai utk saran H-10 dari Tanggal Visit.
export function shiftYMD(ymd: string, delta: number): string {
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

// Bagian tanggal (YYYY-MM-DD) dari instant absolut, dalam kalender WIB —
// dipakai utk filter jadwal ("Besok Visit"/"Besok Ops") tanpa bergantung
// timezone browser/server.
export function jakartaYMD(d: Date): string {
  return toJakartaDatetimeLocalInput(d).slice(0, 10);
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
// (step pertama yang belum selesai; null bila seluruh step sudah selesai).
// stepDefs default ke flow Accommodation & TTD (15 step); Dining Free/Barter
// memanggil dengan POI_DINING_FREEBARTER_STEPS (17 step).
export function sopProgressStatus(
  steps: PoiSopStepRow[],
  stepDefs: PoiSopStepDef[] = POI_SOP_STEPS
): {
  lastCompletedStep: number;
  currentStep: PoiSopStepDef | null;
  allDone: boolean;
} {
  const byStep = new Map(steps.map((s) => [s.step_no, s.completed_at]));
  let lastCompletedStep = 0;
  for (const s of stepDefs) {
    if (byStep.get(s.step)) lastCompletedStep = s.step;
    else break;
  }
  const allDone = lastCompletedStep >= stepDefs.length;
  const currentStep = allDone ? null : stepDefs.find((s) => s.step === lastCompletedStep + 1) ?? null;
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

// SLA Total     : Tanggal Ops → selesai "post-visit end step" (atau `now`).
// Pre-Visit SLA : Tanggal Ops → selesai "pre-visit end step" (atau `now`).
// Post-Visit SLA: Tanggal Visit → selesai "post-visit end step" (atau `now`).
// Default step milestone Accommodation & TTD (10/13); Dining Free/Barter
// memanggil dengan DINING_FREEBARTER_PRE/POST_VISIT_END_STEP (11/15) via
// stepCompletedAt di call site.
export function computePoiSla(args: {
  opsDatetime: Date | null;
  visitDatetime: Date | null;
  preVisitEndCompletedAt: string | null;
  postVisitEndCompletedAt: string | null;
  now: Date;
}): PoiSlaSummary {
  const { opsDatetime, visitDatetime, preVisitEndCompletedAt, postVisitEndCompletedAt, now } = args;
  const preVisitEnd = preVisitEndCompletedAt ? new Date(preVisitEndCompletedAt) : now;
  const postVisitEnd = postVisitEndCompletedAt ? new Date(postVisitEndCompletedAt) : now;
  return {
    total: formatSlaDuration(opsDatetime, postVisitEnd),
    preVisit: formatSlaDuration(opsDatetime, preVisitEnd),
    postVisit: formatSlaDuration(visitDatetime, postVisitEnd),
  };
}

// ---- Dining 'Berbayar': status siklus (step 1-5 opsional/skip + 6-22 berurutan) ----
export type DiningStepRow = { step_no: number; completed_at: string | null; skipped_at: string | null };

export function diningBerbayarStatus(steps: DiningStepRow[]): {
  optionalResolvedCount: number; // dari 5 step MOU/Invoice (1-5), berapa yang selesai/di-skip
  optionalDone: boolean; // seluruh step 1-5 sudah resolved (selesai atau di-skip)
  lastCompletedSequentialStep: number; // step 6..22 terakhir yang selesai (5 = belum mulai)
  currentStep: PoiSopStepDef | null; // step 6..22 berikutnya yang harus dikerjakan (null bila semua selesai)
  allDone: boolean;
} {
  const byStep = new Map(steps.map((s) => [s.step_no, s]));
  const optionalResolvedCount = [1, 2, 3, 4, 5].filter((n) => {
    const s = byStep.get(n);
    return !!s && (s.completed_at || s.skipped_at);
  }).length;
  const optionalDone = optionalResolvedCount >= DINING_BERBAYAR_OPTIONAL_STEPS_END;

  let lastCompletedSequentialStep = DINING_BERBAYAR_OPTIONAL_STEPS_END;
  if (optionalDone) {
    for (let n = DINING_BERBAYAR_FIRST_SEQUENTIAL_STEP; n <= POI_DINING_BERBAYAR_TOTAL_STEPS; n++) {
      if (byStep.get(n)?.completed_at) lastCompletedSequentialStep = n;
      else break;
    }
  }
  const allDone = optionalDone && lastCompletedSequentialStep >= POI_DINING_BERBAYAR_TOTAL_STEPS;
  const currentStep = allDone
    ? null
    : optionalDone
      ? POI_DINING_BERBAYAR_STEPS.find((s) => s.step === lastCompletedSequentialStep + 1) ?? null
      : null;
  return { optionalResolvedCount, optionalDone, lastCompletedSequentialStep, currentStep, allDone };
}
