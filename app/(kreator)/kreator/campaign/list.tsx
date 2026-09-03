"use client";

import { useActionState } from "react";
import { rupiah, tanggal } from "@/lib/format";
import { CAMPAIGN_TRACK_LABEL, type CampaignTrack } from "@/lib/campaign-budget";
import {
  registerCampaignParticipation,
  withdrawCampaignParticipation,
  type ActionResult,
} from "@/lib/actions/campaign-participants";

export type PortalCampaignRow = {
  id: string;
  code: string | null;
  brand_name: string;
  campaign_track: string | null;
  campaign_mode: string | null;
  base_fee: number | null;
  creator_quota: number | null;
  target_location_id: string | null;
  post_window_start: string | null;
  post_window_end: string | null;
  submission_deadline: string | null;
  brief: string | null;
  has_free_meal: boolean;
  target_gmv: number | null;
  target_views: number | null;
  created_at: string;
  approved_count: number;
  my_participant_id: string | null;
  my_status: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  registered: "Menunggu Kurasi",
  approved: "Disetujui",
  rejected: "Ditolak",
  withdrawn: "Dibatalkan",
};

const STATUS_BADGE: Record<string, string> = {
  registered: "amber",
  approved: "green",
  rejected: "red",
  withdrawn: "gray",
};

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

function RegisterButton({ dealId }: { dealId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(registerCampaignParticipation, null);
  return (
    <form action={action}>
      <input type="hidden" name="deal_id" value={dealId} />
      <Msg state={state} />
      <button type="submit" disabled={pending} className="sm">
        {pending ? "Mendaftar…" : "Daftar"}
      </button>
    </form>
  );
}

function WithdrawButton({ participantId }: { participantId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(withdrawCampaignParticipation, null);
  return (
    <form action={action}>
      <input type="hidden" name="participant_id" value={participantId} />
      <Msg state={state} />
      <button type="submit" disabled={pending} className="sm ghost2">
        {pending ? "Membatalkan…" : "Batalkan"}
      </button>
    </form>
  );
}

export function CampaignList({ campaigns }: { campaigns: PortalCampaignRow[] }) {
  if (campaigns.length === 0) return <p className="hint">Belum ada campaign yang cocok untuk kamu saat ini.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {campaigns.map((c) => {
        const quotaFull = c.creator_quota !== null && c.approved_count >= c.creator_quota;
        return (
          <div key={c.id} className="card" style={{ margin: 0 }}>
            <div className="table-toolbar">
              <h2>
                {c.brand_name}
                {c.code ? <span className="hint"> · {c.code}</span> : null}
              </h2>
              {c.my_status ? (
                <span className={`badge ${STATUS_BADGE[c.my_status] ?? "gray"}`}>
                  {STATUS_LABEL[c.my_status] ?? c.my_status}
                </span>
              ) : quotaFull ? (
                <span className="badge red">Kuota Penuh</span>
              ) : null}
            </div>

            <p>
              {c.campaign_track ? CAMPAIGN_TRACK_LABEL[c.campaign_track as CampaignTrack] : "—"} · Base fee:{" "}
              {rupiah(c.base_fee)} · Kuota: {c.approved_count}/{c.creator_quota ?? "—"}
              {c.has_free_meal ? " · Free Meal" : ""}
            </p>
            {c.target_location_id && (
              <p className="hint">Target Location ID: {c.target_location_id}</p>
            )}
            <p className="hint">
              Window Post: {c.post_window_start ? tanggal(c.post_window_start) : "—"} –{" "}
              {c.post_window_end ? tanggal(c.post_window_end) : "—"}
              {c.submission_deadline ? ` · Deadline bukti: ${tanggal(c.submission_deadline)}` : ""}
            </p>
            {c.brief && <p style={{ whiteSpace: "pre-wrap" }}>{c.brief}</p>}

            {c.my_participant_id && (c.my_status === "registered" || c.my_status === "approved") ? (
              <WithdrawButton participantId={c.my_participant_id} />
            ) : !c.my_status ? (
              <RegisterButton dealId={c.id} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
