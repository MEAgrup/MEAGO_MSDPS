// Tab "POI Accommodation & TTD" (BizDev Workspace) — taksonomi step SOP visit
// kreator + kalkulasi SLA. Step/task sendiri TIDAK lagi hardcoded di sini sejak
// migrasi 0364 — satu-satunya sumber kebenaran adalah tabel poi_sop_step_defs
// (dulu poi_sla_settings, migrasi 0343), yang bisa ditambah/edit/nonaktifkan
// dari tab "Setting Bizdev & Admin Ops" (Director). Page server component
// (app/(app)/bizdev/poi/page.tsx dkk) query tabel itu lalu memetakannya lewat
// toStepDefs() di bawah menjadi PoiSopStepDef[] yang dikonsumsi komponen.
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

// ---- Tab "Setting Bizdev & Admin Ops" — step SOP + SLA diatur Director -----
// (poi_sop_step_defs, migrasi 0343 + 0364). Director dapat menambah step baru
// (selalu di akhir urutan flow), mengedit task/SLA/opsional, dan menonaktifkan
// (soft-delete) step lama lewat tab Setting — lihat lib/actions/poi-settings.ts.
export const POI_SLA_FLOWS = ["poi_accommodation_ttd", "poi_dining_freebarter", "poi_dining_berbayar"] as const;
export type PoiSlaFlow = (typeof POI_SLA_FLOWS)[number];

export const POI_SLA_FLOW_LABELS: Record<PoiSlaFlow, string> = {
  poi_accommodation_ttd: "POI Accommodation & TTD",
  poi_dining_freebarter: "POI Dining — Free/Barter",
  poi_dining_berbayar: "POI Dining — Berbayar",
};

// Baris apa adanya dari tabel poi_sop_step_defs (satu-satunya sumber
// kebenaran step per flow sejak migrasi 0364).
export type PoiSopStepDefRow = {
  id: string;
  flow: PoiSlaFlow;
  step_no: number;
  task: string;
  sla_days: number | null;
  sla_label: string | null;
  is_optional: boolean;
  active: boolean;
};

// slaDays null = tidak ada SLA harian tetap (pakai slaLabel bila ada, mis. SLA
// rentang "7-30 hari sesuai dealing" atau step opsional Dining Berbayar).
export type PoiSopStepDef = {
  step: number;
  task: string;
  slaDays: number | null;
  slaLabel?: string;
  isOptional?: boolean;
};

// toStepDefs — pemetaan baris DB (poi_sop_step_defs, terfilter active saat
// query) ke PoiSopStepDef[] yang dikonsumsi komponen tampilan. Diurutkan by
// step_no supaya urutan tampilan selalu benar walau query tidak ORDER BY.
export function toStepDefs(rows: { step_no: number; task: string; sla_days: number | null; sla_label: string | null; is_optional?: boolean }[]): PoiSopStepDef[] {
  return [...rows]
    .sort((a, b) => a.step_no - b.step_no)
    .map((r) => ({
      step: r.step_no,
      task: r.task,
      slaDays: r.sla_days,
      slaLabel: r.sla_label ?? undefined,
      isOptional: r.is_optional ?? false,
    }));
}

export function formatStepSla(step: PoiSopStepDef): string {
  if (step.slaLabel) return step.slaLabel;
  if (step.slaDays == null) return "—";
  return `${step.slaDays} hari`;
}

// Milestone posisi step (dipakai hitung SLA Pre-Visit/Post-Visit) — TETAP
// berbasis 15/17 step awal (Accommodation&TTD / Dining Free-Barter), karena
// step baru yang ditambah Director selalu di AKHIR urutan (lihat migrasi
// 0364) sehingga posisi milestone lama tidak pernah bergeser.
export const PRE_VISIT_END_STEP = 10;
export const POST_VISIT_END_STEP = 13;
export const REPORT_WARNING_STEP = 12;

export const REPORT_STATUS_OPTIONS = ["Approved", "Waiting Confirmation", "Request", "Revisi"] as const;
export type ReportStatus = (typeof REPORT_STATUS_OPTIONS)[number];

// ---- Tab "POI Dining" (BizDev Workspace) ------------------------------------
// kategori_poi = 'Dining'. Dua alur berbeda menurut bentuk_kerjasama:
//  - 'Free/Barter' (berurutan) — flow SAMA seperti Accommodation & TTD di
//    atas, dipakai ulang tabel poi_sop_progress/poi_sop_steps.
//  - 'Berbayar' (step opsional MOU/Invoice di awal + step berurutan) per
//    SIKLUS BULANAN — tabel terpisah poi_dining_cycles/poi_dining_steps
//    (migrasi 0337): lihat DiningStepRow & diningBerbayarStatus di bawah.
export const DINING_FREEBARTER_PRE_VISIT_END_STEP = 11;
export const DINING_FREEBARTER_POST_VISIT_END_STEP = 15;

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
// stepDefs wajib dikirim call site (hasil query poi_sop_step_defs, lihat
// toStepDefs) — flow Accommodation & TTD dan Dining Free/Barter beda isi.
export function sopProgressStatus(
  steps: PoiSopStepRow[],
  stepDefs: PoiSopStepDef[]
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

// ---- Dining 'Berbayar': status siklus (step opsional/skip di awal + berurutan) ----
export type DiningStepRow = { step_no: number; completed_at: string | null; skipped_at: string | null };

// stepDefs wajib dikirim call site (hasil query poi_sop_step_defs flow
// 'poi_dining_berbayar', lihat toStepDefs) — step opsional & total step kini
// dinamis (isOptional per step, bukan lagi posisi "1-5" hardcoded).
export function diningBerbayarStatus(
  steps: DiningStepRow[],
  stepDefs: PoiSopStepDef[]
): {
  optionalResolvedCount: number; // dari step opsional (MOU/Invoice dkk), berapa yang selesai/di-skip
  optionalTotal: number; // total step opsional pada flow ini
  optionalDone: boolean; // seluruh step opsional sudah resolved (selesai atau di-skip)
  firstSequentialStep: number | null; // step berurutan pertama (gerbang "Tanggal Ops"); null bila tidak ada
  lastCompletedSequentialStep: number; // step berurutan terakhir yang selesai (0 = belum mulai)
  currentStep: PoiSopStepDef | null; // step berurutan berikutnya yang harus dikerjakan (null bila semua selesai)
  allDone: boolean;
} {
  const byStep = new Map(steps.map((s) => [s.step_no, s]));
  const optionalSteps = stepDefs.filter((s) => s.isOptional);
  const sequentialSteps = stepDefs.filter((s) => !s.isOptional).sort((a, b) => a.step - b.step);
  const firstSequentialStep = sequentialSteps[0]?.step ?? null;

  const optionalResolvedCount = optionalSteps.filter((s) => {
    const row = byStep.get(s.step);
    return !!row && (row.completed_at || row.skipped_at);
  }).length;
  const optionalDone = optionalResolvedCount >= optionalSteps.length;

  let lastCompletedSequentialStep = 0;
  if (optionalDone) {
    for (const s of sequentialSteps) {
      if (byStep.get(s.step)?.completed_at) lastCompletedSequentialStep = s.step;
      else break;
    }
  }
  const allDone =
    optionalDone && sequentialSteps.length > 0 && lastCompletedSequentialStep >= sequentialSteps[sequentialSteps.length - 1].step;
  const currentStep = allDone
    ? null
    : optionalDone
      ? sequentialSteps.find((s) => s.step > lastCompletedSequentialStep) ?? null
      : null;
  return {
    optionalResolvedCount,
    optionalTotal: optionalSteps.length,
    optionalDone,
    firstSequentialStep,
    lastCompletedSequentialStep,
    currentStep,
    allDone,
  };
}
