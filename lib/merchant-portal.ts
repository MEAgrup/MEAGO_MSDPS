// Label ramah (Bahasa Indonesia) untuk Merchant Portal — data mentahnya dari RPC
// merchant_portal_* (migrasi 0374), yang hanya mengembalikan kolom whitelist.

const CAMPAIGN_STAGE_LABEL: Record<string, string> = {
  draft: "Persiapan",
  active: "Berjalan",
  on_hold: "Ditunda",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const DEAL_STATUS_LABEL: Record<string, string> = {
  running: "Berjalan",
  hold: "Ditunda",
  done: "Selesai",
};

const STAGE_BADGE: Record<string, string> = {
  Persiapan: "slate",
  Berjalan: "green",
  Ditunda: "amber",
  Selesai: "blue",
  Dibatalkan: "red",
};

export function campaignStageLabel(campaignStage: string | null, status: string | null): string {
  if (campaignStage && CAMPAIGN_STAGE_LABEL[campaignStage]) return CAMPAIGN_STAGE_LABEL[campaignStage];
  if (status && DEAL_STATUS_LABEL[status]) return DEAL_STATUS_LABEL[status];
  return "—";
}

export function stageBadge(label: string): string {
  return STAGE_BADGE[label] ?? "gray";
}

const REPORT_STATUS_LABEL: Record<string, string> = {
  Approved: "Siap",
  "Waiting Confirmation": "Menunggu konfirmasi",
  Request: "Sedang disiapkan",
  Revisi: "Sedang direvisi",
};

export function reportStatusLabel(s: string | null): string {
  return s ? REPORT_STATUS_LABEL[s] ?? s : "Belum tersedia";
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// 'YYYYMM' → 'Okt 2026'
export function periodLabel(p: string): string {
  const y = p.slice(0, 4);
  const m = Number(p.slice(4, 6));
  return m >= 1 && m <= 12 ? `${BULAN[m - 1]} ${y}` : p;
}

// Periode 'YYYYMM' bulan berjalan + n bulan sebelumnya (zona Asia/Jakarta).
export function recentPeriods(n: number): string[] {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1;
  const out: string[] = [];
  for (let i = 0; i <= n; i++) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export type GmvMonth = { period: string; gmv: number | null; sumber: string; label: string };
export type PortalCampaign = {
  deal_id: string;
  deal_code: string | null;
  lead_id: string;
  brand_name: string | null;
  campaign_name: string | null;
  kategori: string | null;
  status: string | null;
  campaign_stage: string | null;
  pipeline_stage: string | null;
  visit_start_date: string | null;
  visit_end_date: string | null;
  kreator_needed: number | null;
  kreator_realized: number | null;
  videos_needed: number | null;
  video_realized: number | null;
  post_window_start: string | null;
  post_window_end: string | null;
  kontrak_mulai: string | null;
  kontrak_akhir: string | null;
};
export type PortalCycle = {
  cycle_id: string;
  deal_id: string;
  campaign_name: string | null;
  cycle_no: number;
  period_start: string | null;
  period_end: string | null;
  total_gmv: number | null;
  actual_vt: number | null;
  actual_kreator: number | null;
  report_status: string | null;
  report_link: string | null;
};
