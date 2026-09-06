"use client";

import Link from "next/link";
import { rupiah } from "@/lib/format";
import { CAMPAIGN_STAGE_LABEL, type CampaignStage } from "@/lib/campaign-stage";
import { FUNDING_SOURCE_LABEL, CAMPAIGN_TRACK_LABEL, type FundingSource, type CampaignTrack } from "@/lib/campaign-budget";

export type CampaignRow = {
  id: string;
  code: string | null;
  brand_name: string;
  funding_source: string | null;
  campaign_track: string | null;
  campaign_mode: string | null;
  operational_team: string | null;
  operational_owner_id: string | null;
  campaign_stage: string;
  base_fee: number | null;
  creator_quota: number | null;
  creator_budget: number | null;
  ads_budget_planned: number | null;
  allocated_amount: number | null;
  over_budget: boolean;
  target_location_id: string | null;
  created_at: string;
};

const STAGE_BADGE: Record<CampaignStage, string> = {
  draft: "gray",
  active: "green",
  on_hold: "amber",
  completed: "blue",
  cancelled: "red",
};

export function CampaignsTable({ campaigns, nameById }: { campaigns: CampaignRow[]; nameById: Record<string, string> }) {
  if (campaigns.length === 0) return <p className="hint">Belum ada campaign.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>Kode</th>
          <th>Brand / Campaign</th>
          <th>Funding</th>
          <th>Track</th>
          <th>Tim Ops</th>
          <th>Alokasi</th>
          <th>Creator Budget</th>
          <th>Stage</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {campaigns.map((c) => {
          const stage = (c.campaign_stage in STAGE_BADGE ? c.campaign_stage : "draft") as CampaignStage;
          return (
            <tr key={c.id}>
              <td>{c.code ?? "—"}</td>
              <td>{c.brand_name}</td>
              <td>{c.funding_source ? FUNDING_SOURCE_LABEL[c.funding_source as FundingSource] : "—"}</td>
              <td>{c.campaign_track ? CAMPAIGN_TRACK_LABEL[c.campaign_track as CampaignTrack] : "—"}</td>
              <td>
                {c.operational_team ?? "—"}
                {c.operational_owner_id && nameById[c.operational_owner_id] ? ` · ${nameById[c.operational_owner_id]}` : ""}
              </td>
              <td>
                {rupiah(c.allocated_amount)}
                {c.over_budget && (
                  <span className="badge red" style={{ marginLeft: 6 }}>
                    Over Budget
                  </span>
                )}
              </td>
              <td>{rupiah(c.creator_budget)}</td>
              <td>
                <span className={`badge ${STAGE_BADGE[stage]}`}>{CAMPAIGN_STAGE_LABEL[stage]}</span>
              </td>
              <td>
                <Link href={`/meago/campaigns/${c.id}`} className="btn-ghost sm">
                  Detail
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
