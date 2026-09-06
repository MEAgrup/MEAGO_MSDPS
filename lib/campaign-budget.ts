// Fase G.1 — helper murni untuk budget campaign (brand_deals.campaign_enabled=true).
//
// HARUS selaras dengan trigger `campaign_budget_guard()` (migrasi 0342): alokasi
// = base_fee × creator_quota, over budget kalau alokasi > creator_budget. DB
// tetap otoritas final (hard block staff, Lead+ override wajib alasan) — fungsi
// di sini hanya untuk pesan UI yang ramah sebelum submit.

export const FUNDING_SOURCES = ["internal", "brand"] as const;
export type FundingSource = (typeof FUNDING_SOURCES)[number];

export const CAMPAIGN_TRACKS = ["video", "live"] as const;
export type CampaignTrack = (typeof CAMPAIGN_TRACKS)[number];

export const CAMPAIGN_MODES = ["collaboration_package", "others"] as const;
export type CampaignMode = (typeof CAMPAIGN_MODES)[number];

export const MIN_GMV_METRICS = ["gmv", "video_gmv"] as const;
export type MinGmvMetric = (typeof MIN_GMV_METRICS)[number];

export function isFundingSource(value: string): value is FundingSource {
  return (FUNDING_SOURCES as readonly string[]).includes(value);
}
export function isCampaignTrack(value: string): value is CampaignTrack {
  return (CAMPAIGN_TRACKS as readonly string[]).includes(value);
}
export function isCampaignMode(value: string): value is CampaignMode {
  return (CAMPAIGN_MODES as readonly string[]).includes(value);
}

export const FUNDING_SOURCE_LABEL: Record<FundingSource, string> = {
  internal: "Budget Internal (Campaign Specialist)",
  brand: "Budget Brand (BizDev)",
};

export const CAMPAIGN_TRACK_LABEL: Record<CampaignTrack, string> = {
  video: "Video",
  live: "Live",
};

// computeAllocatedAmount — samakan dengan kolom generated brand_deals.allocated_amount.
export function computeAllocatedAmount(baseFee: number | null, creatorQuota: number | null): number | null {
  if (baseFee === null || creatorQuota === null) return null;
  if (!Number.isFinite(baseFee) || !Number.isFinite(creatorQuota)) return null;
  return baseFee * creatorQuota;
}

// isOverBudget — samakan dengan campaign_budget_guard(): allocated > creator_budget.
export function isOverBudget(allocatedAmount: number | null, creatorBudget: number | null): boolean {
  if (allocatedAmount === null || creatorBudget === null) return false;
  return allocatedAmount > creatorBudget;
}

// canOverrideOverBudget — hanya Lead ke atas (actor_tokens() di DB memakai
// rank/is_od/is_director yang sama, ini cermin untuk gating tombol di UI).
export function canOverrideOverBudget(me: { rank: string | null; is_od: boolean; is_director: boolean } | null): boolean {
  if (!me) return false;
  return me.rank === "lead" || me.is_od || me.is_director;
}

export type BudgetCheck =
  | { ok: true; allocatedAmount: number | null }
  | { ok: false; error: string; allocatedAmount: number | null };

// validateBudgetFields — cermin campaign_budget_guard() untuk pesan error
// ramah sebelum submit. DB tetap otoritas final; jangan andalkan ini sendirian.
export function validateBudgetFields(input: {
  baseFee: number | null;
  creatorQuota: number | null;
  creatorBudget: number | null;
  overBudget: boolean;
  overBudgetReason: string;
  me: { rank: string | null; is_od: boolean; is_director: boolean } | null;
}): BudgetCheck {
  const allocatedAmount = computeAllocatedAmount(input.baseFee, input.creatorQuota);
  if (!isOverBudget(allocatedAmount, input.creatorBudget)) {
    return { ok: true, allocatedAmount };
  }
  if (!input.overBudget) {
    return {
      ok: false,
      error: "[alokasi budget (base fee × kuota kreator) melebihi creator_budget — tandai Over Budget dengan alasan untuk lanjut]",
      allocatedAmount,
    };
  }
  if (!input.overBudgetReason.trim()) {
    return { ok: false, error: "[alasan Over Budget wajib diisi]", allocatedAmount };
  }
  if (!canOverrideOverBudget(input.me)) {
    return { ok: false, error: "[hanya Lead ke atas yang dapat mengaktifkan campaign Over Budget]", allocatedAmount };
  }
  return { ok: true, allocatedAmount };
}
