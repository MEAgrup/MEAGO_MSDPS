// Katalog metrik OKR yang BISA dihitung otomatis oleh sistem (v_okr_attainment
// & generate_performance_scores). Director/OD hanya boleh menetapkan target untuk
// metrik di katalog ini — metrik lain tak akan dievaluasi oleh engine.
//
// Nilai default di sini adalah fallback yang tertanam di fungsi okr_target_value()
// (dipakai HANYA bila belum ada target aktif). Angka nyata ditetapkan Director
// per section lewat halaman "Target OKR".

export type OkrRole = "Ecommerce" | "Ads" | "KOL" | "AM";

export type OkrMetricDef = {
  role: OkrRole;
  metric: string;
  label: string; // nama ramah (Indonesia)
  unit: string; // satuan tampilan
  comparator: "gte" | "lte"; // gte: makin tinggi makin baik
  defaultValue: number; // fallback engine bila belum diset
  hint: string; // penjelasan cara sistem menghitung
};

// Nama section untuk header (AM = divisi Account).
export const SECTION_LABEL: Record<OkrRole, string> = {
  Ecommerce: "E-commerce",
  Ads: "Ads",
  KOL: "KOL",
  AM: "Account (AM)",
};

export const OKR_METRICS: OkrMetricDef[] = [
  {
    role: "Ecommerce",
    metric: "sku_approved_per_week",
    label: "SKU disetujui / minggu",
    unit: "SKU/mgg",
    comparator: "gte",
    defaultValue: 20,
    hint: "Jumlah SKU yang mencapai [Approved] per staff per minggu.",
  },
  {
    role: "Ads",
    metric: "ads_outputs_per_week",
    label: "Output Ads / minggu",
    unit: "output/mgg",
    comparator: "gte",
    defaultValue: 5,
    hint: "Campaign go-live + Weekly Performance Entry per staff per minggu.",
  },
  {
    role: "Ads",
    metric: "roas",
    label: "ROAS rata-rata",
    unit: "×",
    comparator: "gte",
    defaultValue: 4,
    hint: "Rata-rata ROAS dari Weekly Performance Entries kuartal berjalan.",
  },
  {
    role: "KOL",
    metric: "videos_delivered_per_week",
    label: "Video delivered / minggu",
    unit: "video/mgg",
    comparator: "gte",
    defaultValue: 3,
    hint: "Booking [Delivered] tipe Video per staff per minggu.",
  },
  {
    role: "KOL",
    metric: "live_hours_per_week",
    label: "Jam live / minggu",
    unit: "jam/mgg",
    comparator: "gte",
    defaultValue: 10,
    hint: "Total jam Live Session [Delivered] per staff per minggu.",
  },
  {
    role: "AM",
    metric: "merchant_health_avg",
    label: "Rata-rata Merchant Health",
    unit: "skor",
    comparator: "gte",
    defaultValue: 75,
    hint: "Rata-rata composite health merchant di portfolio AM.",
  },
];

export const OKR_ROLE_ORDER: OkrRole[] = ["Ecommerce", "Ads", "KOL", "AM"];

// Set kunci valid "role|metric" untuk validasi server-side.
export const OKR_METRIC_KEYS = new Set(OKR_METRICS.map((m) => `${m.role}|${m.metric}`));

export function metricsForRole(role: OkrRole): OkrMetricDef[] {
  return OKR_METRICS.filter((m) => m.role === role);
}

// ---- Helper kuartal (WIB) --------------------------------------------------
export const PERIOD_RE = /^\d{4}-Q[1-4]$/;

export function currentQuarter(): string {
  const wib = new Date(Date.now() + 7 * 3600 * 1000);
  const q = Math.floor(wib.getUTCMonth() / 3) + 1;
  return `${wib.getUTCFullYear()}-Q${q}`;
}

export function shiftQuarter(period: string, delta: number): string {
  const [y, q] = period.split("-Q").map(Number);
  const idx = y * 4 + (q - 1) + delta;
  const ny = Math.floor(idx / 4);
  const nq = (idx % 4) + 1;
  return `${ny}-Q${nq}`;
}
