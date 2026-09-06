// Fase G.1 — helper murni untuk campaign_stage (brand_deals, state machine
// TERPISAH dari status/pipeline_stage — lihat enforce_campaign_stage_transition()
// di migrasi 0342). HARUS selaras dengan baris status_transitions entity
// 'campaign_stage' yang di-seed migrasi yang sama.

export const CAMPAIGN_STAGES = ["draft", "active", "on_hold", "completed", "cancelled"] as const;
export type CampaignStage = (typeof CAMPAIGN_STAGES)[number];

export function isCampaignStage(value: string): value is CampaignStage {
  return (CAMPAIGN_STAGES as readonly string[]).includes(value);
}

export const CAMPAIGN_STAGE_LABEL: Record<CampaignStage, string> = {
  draft: "Draft",
  active: "Aktif",
  on_hold: "Ditahan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

// Cermin baris status_transitions entity='campaign_stage' (migrasi 0342) —
// dipakai untuk membatasi opsi di dropdown UI. DB tetap otoritas final.
const ALLOWED_NEXT: Record<CampaignStage, CampaignStage[]> = {
  draft: ["active", "cancelled"],
  active: ["on_hold", "completed", "cancelled"],
  on_hold: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};

// Transisi yang butuh wewenang Lead ke atas (allowed_tokens di status_transitions).
const REQUIRES_LEAD_PLUS = new Set<`${CampaignStage}->${CampaignStage}`>([
  "draft->cancelled",
  "active->cancelled",
  "on_hold->cancelled",
]);

export function nextStagesFor(stage: CampaignStage): CampaignStage[] {
  return ALLOWED_NEXT[stage] ?? [];
}

export function stageTransitionRequiresLeadPlus(from: CampaignStage, to: CampaignStage): boolean {
  return REQUIRES_LEAD_PLUS.has(`${from}->${to}`);
}

// Field yang harus lengkap sebelum draft -> active (cermin gerbang kelengkapan
// di enforce_campaign_stage_transition()).
export function missingFieldsForActivation(deal: {
  funding_source: string | null;
  campaign_track: string | null;
  operational_team: string | null;
  base_fee: number | null;
  creator_quota: number | null;
  creator_budget: number | null;
  target_location_id: string | null;
}): string[] {
  const missing: string[] = [];
  if (!deal.funding_source) missing.push("Funding source");
  if (!deal.campaign_track) missing.push("Track (video/live)");
  if (!deal.operational_team) missing.push("Tim operasional");
  if (deal.base_fee === null) missing.push("Base fee");
  if (deal.creator_quota === null) missing.push("Kuota kreator");
  if (deal.creator_budget === null) missing.push("Creator budget");
  if (!deal.target_location_id) missing.push("Target location (TikTok Location ID)");
  return missing;
}
