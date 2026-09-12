// Katalog metrik OKR divisi NON-OPERASIONAL MSDPS.
//
// PENSIUN 2026-09-12. Katalog lama berisi 6 metrik untuk Ecommerce/Ads/KOL/AM —
// keempat divisi itu tidak lagi bekerja di MSDPS: eksekusi layanan pindah ke CDPS
// lewat Bridge Fase 1, dan M6-M15 dinisankan (components/retired.tsx). Mesin yang
// dulu menghitung attainment-nya (generate_performance_scores + v_okr_attainment,
// M14) ikut berhenti — cron-nya dilepas di migrasi 0361. Target lamanya TIDAK
// dihapus: baris okr_targets beserta audit log-nya tetap utuh sebagai riwayat,
// hanya berhenti dirender karena metriknya tidak ada lagi di katalog ini.
//
// ⚠️ KEMBAR SQL: daftar di bawah HARUS cermin CTE `catalog` di dalam
// supabase/migrations/0361_pensiun_account_service.sql (division, metric,
// defaultValue, comparator). Kalau salah satu berubah tanpa yang lain, halaman
// /okr dan view attainment akan menampilkan angka default yang berbeda untuk
// metrik yang sama. Duplikasi TS<->SQL ini pola rumah yang sudah ada (katalog
// lama vs literal di generate_performance_scores 0209) — bukan pola baru, tapi
// tetap harus dipindahkan berbarengan.
//
// Target yang ditetapkan Director disimpan di `okr_targets_meago` (BUKAN
// `okr_targets`, yang dibekukan bersama M14 — lihat alasan enum perf_role di
// header migrasi 0361). Attainment dibaca dari view `v_okr_attainment_meago`.

export type OkrRole =
  | "BizDev"
  | "CreatorManagement"
  | "Acquisition"
  | "Marketing"
  | "Finance";

export type OkrMetricDef = {
  role: OkrRole; // = kolom `division` di okr_targets_meago
  metric: string;
  label: string; // nama ramah (Indonesia)
  unit: string; // satuan tampilan
  comparator: "gte" | "lte"; // gte: makin tinggi makin baik
  defaultValue: number; // fallback bila Director belum menetapkan
  hint: string; // penjelasan cara sistem menghitung
};

// Nama section untuk header — memakai istilah yang dipakai nav sidebar.
export const SECTION_LABEL: Record<OkrRole, string> = {
  BizDev: "BizDev & Admin Ops",
  CreatorManagement: "Creator Management",
  Acquisition: "Akuisisi Kreator",
  Marketing: "Marketing",
  Finance: "Keuangan",
};

export const OKR_METRICS: OkrMetricDef[] = [
  {
    role: "BizDev",
    metric: "deals_berbayar_per_quarter",
    label: "Deal Berbayar baru / kuartal",
    unit: "deal/kuartal",
    comparator: "gte",
    defaultValue: 12,
    hint: "Deal dengan bentuk kerjasama Berbayar yang terdaftar di kuartal ini (baris Import Master Deal yang belum dilengkapi kategori POI tidak dihitung).",
  },
  {
    role: "BizDev",
    metric: "deals_bridged_per_quarter",
    label: "Deal diteruskan ke CDPS / kuartal",
    unit: "order/kuartal",
    comparator: "gte",
    defaultValue: 10,
    hint: "Order yang benar-benar terkirim ke inbox CDPS (cdps_outbox berstatus sent, sudah punya ORD-). Ini keluaran nyata BizDev sejak eksekusi pindah ke CDPS.",
  },
  {
    role: "CreatorManagement",
    metric: "affiliate_gmv_per_quarter",
    label: "GMV affiliate kreator / kuartal",
    unit: "Rp",
    comparator: "gte",
    defaultValue: 500_000_000,
    hint: "Total affiliate GMV kreator dari upload mingguan kuartal ini. Upload ulang minggu yang sama dihitung sekali (baris terbaru yang menang).",
  },
  {
    role: "Acquisition",
    metric: "creators_bound_per_quarter",
    label: "Kreator baru binding / kuartal",
    unit: "kreator/kuartal",
    comparator: "gte",
    defaultValue: 30,
    hint: "Jumlah akuisisi dengan tanggal binding di kuartal ini.",
  },
  {
    role: "Marketing",
    metric: "roas",
    label: "ROAS (ditimbang)",
    unit: "×",
    comparator: "gte",
    defaultValue: 4,
    hint: "Total attributed revenue dibagi total budget kampanye yang mulai di kuartal ini — ditimbang, bukan rata-rata rasio per kampanye.",
  },
  {
    role: "Marketing",
    metric: "cost_per_lead",
    label: "Cost per Lead (ditimbang)",
    unit: "Rp/lead",
    comparator: "lte",
    defaultValue: 75_000,
    hint: "Total budget dibagi total lead kampanye yang mulai di kuartal ini. Makin rendah makin baik.",
  },
  {
    role: "Finance",
    metric: "verified_value_per_quarter",
    label: "Nilai terverifikasi / kuartal",
    unit: "Rp",
    comparator: "gte",
    defaultValue: 300_000_000,
    hint: "Uang yang benar-benar diverifikasi Finance di kuartal ini, direkonstruksi dari selisih amount_verified pada audit log transaksi.",
  },
];

export const OKR_ROLE_ORDER: OkrRole[] = [
  "BizDev",
  "CreatorManagement",
  "Acquisition",
  "Marketing",
  "Finance",
];

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
