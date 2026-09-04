"use client";

import { useActionState } from "react";
import { rupiah, tanggal } from "@/lib/format";
import { CAMPAIGN_TRACK_LABEL, type CampaignTrack } from "@/lib/campaign-budget";
import {
  registerCampaignParticipation,
  withdrawCampaignParticipation,
  type ActionResult,
} from "@/lib/actions/campaign-participants";
import {
  submitVideoProof,
  deleteVideoSubmission,
  submitLiveProof,
  deleteLiveSubmission,
  type ActionResult as SubmissionActionResult,
} from "@/lib/actions/campaign-submissions";

export type VideoSubmissionRow = {
  id: string;
  participant_id: string;
  post_url: string;
  post_id: string | null;
  is_duplicate: boolean;
  submitted_at: string;
};

export type LiveSubmissionRow = {
  id: string;
  participant_id: string;
  live_date: string;
  duration_minutes: number;
  proof_url: string | null;
  submitted_at: string;
};

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

function SubmitVideoForm({ dealId }: { dealId: string }) {
  const [state, action, pending] = useActionState<SubmissionActionResult | null, FormData>(submitVideoProof, null);
  return (
    <form action={action} style={{ marginTop: 8 }}>
      <input type="hidden" name="deal_id" value={dealId} />
      <label>Link Video TikTok</label>
      <input name="post_url" placeholder="https://www.tiktok.com/@.../video/..." required />
      <label>Screenshot Bukti (opsional)</label>
      <input name="proof_file" type="file" accept="image/*" />
      <Msg state={state} />
      <button type="submit" disabled={pending} className="sm">
        {pending ? "Mengirim…" : "Submit Bukti Video"}
      </button>
    </form>
  );
}

function SubmitLiveForm({ dealId }: { dealId: string }) {
  const [state, action, pending] = useActionState<SubmissionActionResult | null, FormData>(submitLiveProof, null);
  return (
    <form action={action} style={{ marginTop: 8 }}>
      <input type="hidden" name="deal_id" value={dealId} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label>Tanggal Live</label>
          <input name="live_date" type="date" required />
        </div>
        <div>
          <label>Durasi (menit)</label>
          <input name="duration_minutes" inputMode="numeric" required />
        </div>
      </div>
      <label>Link Bukti (opsional)</label>
      <input name="proof_url" placeholder="link replay/screenshot" />
      <label>Screenshot Bukti (opsional)</label>
      <input name="proof_file" type="file" accept="image/*" />
      <Msg state={state} />
      <button type="submit" disabled={pending} className="sm">
        {pending ? "Mengirim…" : "Submit Bukti Live"}
      </button>
    </form>
  );
}

function VideoSubmissionRowItem({ s }: { s: VideoSubmissionRow }) {
  const [state, action, pending] = useActionState<SubmissionActionResult | null, FormData>(deleteVideoSubmission, null);
  return (
    <li>
      <a href={s.post_url} target="_blank" rel="noreferrer">
        {s.post_url}
      </a>
      {s.is_duplicate && (
        <span className="badge red" style={{ marginLeft: 6 }}>
          Duplikat
        </span>
      )}
      <span className="hint"> · {tanggal(s.submitted_at)}</span>
      <form action={action} style={{ display: "inline", marginLeft: 8 }}>
        <input type="hidden" name="submission_id" value={s.id} />
        <button type="submit" disabled={pending} className="sm ghost2">
          Hapus
        </button>
      </form>
      {state && !state.ok && <div className="err">{state.message}</div>}
    </li>
  );
}

function LiveSubmissionRowItem({ s }: { s: LiveSubmissionRow }) {
  const [state, action, pending] = useActionState<SubmissionActionResult | null, FormData>(deleteLiveSubmission, null);
  return (
    <li>
      {tanggal(s.live_date)} · {s.duration_minutes} menit
      {s.proof_url && (
        <>
          {" · "}
          <a href={s.proof_url} target="_blank" rel="noreferrer">
            bukti
          </a>
        </>
      )}
      <form action={action} style={{ display: "inline", marginLeft: 8 }}>
        <input type="hidden" name="submission_id" value={s.id} />
        <button type="submit" disabled={pending} className="sm ghost2">
          Hapus
        </button>
      </form>
      {state && !state.ok && <div className="err">{state.message}</div>}
    </li>
  );
}

export function CampaignList({
  campaigns,
  videoSubmissions,
  liveSubmissions,
}: {
  campaigns: PortalCampaignRow[];
  videoSubmissions: VideoSubmissionRow[];
  liveSubmissions: LiveSubmissionRow[];
}) {
  if (campaigns.length === 0) return <p className="hint">Belum ada campaign yang cocok untuk kamu saat ini.</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {campaigns.map((c) => {
        const quotaFull = c.creator_quota !== null && c.approved_count >= c.creator_quota;
        const myVideos = c.my_participant_id
          ? videoSubmissions.filter((s) => s.participant_id === c.my_participant_id)
          : [];
        const myLives = c.my_participant_id
          ? liveSubmissions.filter((s) => s.participant_id === c.my_participant_id)
          : [];
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

            {c.my_status === "approved" && (
              <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <h3 style={{ fontSize: 14, marginBottom: 6 }}>Bukti Deliverable</h3>
                {(c.campaign_track === "video" || !c.campaign_track) && (
                  <>
                    {myVideos.length > 0 && (
                      <ul style={{ paddingLeft: 18, marginBottom: 4 }}>
                        {myVideos.map((s) => (
                          <VideoSubmissionRowItem key={s.id} s={s} />
                        ))}
                      </ul>
                    )}
                    <SubmitVideoForm dealId={c.id} />
                  </>
                )}
                {c.campaign_track === "live" && (
                  <>
                    {myLives.length > 0 && (
                      <ul style={{ paddingLeft: 18, marginBottom: 4 }}>
                        {myLives.map((s) => (
                          <LiveSubmissionRowItem key={s.id} s={s} />
                        ))}
                      </ul>
                    )}
                    <SubmitLiveForm dealId={c.id} />
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
