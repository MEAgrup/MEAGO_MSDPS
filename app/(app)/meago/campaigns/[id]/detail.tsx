"use client";

import { useActionState, useEffect, useState } from "react";
import { rupiah, num, tanggal } from "@/lib/format";
import {
  updateCampaignBudget,
  changeCampaignStage,
  addAdsSpend,
  type ActionResult,
} from "@/lib/actions/go-campaigns";
import { curateCampaignParticipant, type ActionResult as ParticipantActionResult } from "@/lib/actions/campaign-participants";
import {
  createCurationBatch,
  closeCurationBatch,
  type ActionResult as PayoutActionResult,
} from "@/lib/actions/campaign-payouts";
import { computeCampaignCompletion, sumCompletionAmount } from "@/lib/campaign-completion";
import {
  CAMPAIGN_STAGE_LABEL,
  isCampaignStage,
  nextStagesFor,
  stageTransitionRequiresLeadPlus,
  missingFieldsForActivation,
  type CampaignStage,
} from "@/lib/campaign-stage";
import { FUNDING_SOURCE_LABEL, CAMPAIGN_TRACK_LABEL, type FundingSource, type CampaignTrack } from "@/lib/campaign-budget";

export type CampaignDetailRow = {
  id: string;
  code: string | null;
  brand_name: string;
  funding_source: string | null;
  campaign_track: string | null;
  campaign_mode: string | null;
  operational_team: string | null;
  operational_owner_id: string | null;
  campaign_stage: string;
  stage_changed_at: string | null;
  base_fee: number | null;
  creator_quota: number | null;
  creator_budget: number | null;
  ads_budget_planned: number | null;
  allocated_amount: number | null;
  over_budget: boolean;
  over_budget_reason: string | null;
  target_location_id: string | null;
  target_gmv: number | null;
  target_views: number | null;
  post_window_start: string | null;
  post_window_end: string | null;
  submission_deadline: string | null;
  brief: string | null;
  has_free_meal: boolean;
  eligible_industries: string[] | null;
  eligible_cities: string[] | null;
  eligible_levels: string[] | null;
  eligible_creator_types: string[] | null;
  eligible_roster_status: string[] | null;
  eligible_status_kontrak: string[] | null;
  min_gmv: number | null;
  min_gmv_metric: string | null;
  min_gmv_period_days: number | null;
  created_at: string;
};

export type BudgetLogRow = {
  id: string;
  creator_budget: number | null;
  base_fee: number | null;
  creator_quota: number | null;
  allocated_amount: number | null;
  over_budget: boolean;
  over_budget_reason: string | null;
  actor: string | null;
  created_at: string;
};

export type ParticipantRow = {
  id: string;
  code: string | null;
  mcn_creator_id: string;
  status: string;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type CurationBatchRow = {
  id: string;
  code: string | null;
  deal_id: string;
  period_start: string;
  period_end: string;
  status: string;
  total_completed: number | null;
  total_amount: number | null;
  closed_at: string | null;
};

export type CampaignPayoutRow = {
  id: string;
  code: string | null;
  participant_id: string;
  mcn_creator_id: string;
  amount: number;
  status: string;
  requested_at: string;
  transfer_proof: string | null;
  cancellation_reason: string | null;
};

export type VideoSubmissionRow = {
  id: string;
  participant_id: string;
  post_url: string;
  post_id: string | null;
  is_duplicate: boolean;
  duplicate_of_id: string | null;
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

export type AdsSpendRow = {
  id: string;
  spend_date: string;
  amount: number;
  note: string | null;
  entered_by: string | null;
  created_at: string;
};

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

function Tag({ list }: { list: string[] | null }) {
  if (!list || list.length === 0) return <span className="hint">semua boleh</span>;
  return (
    <>
      {list.map((v) => (
        <span key={v} className="badge slate" style={{ marginRight: 4 }}>
          {v}
        </span>
      ))}
    </>
  );
}

function StageSwitcher({
  deal,
  canManage,
  me,
}: {
  deal: CampaignDetailRow;
  canManage: boolean;
  me: { rank: string | null; is_od: boolean; is_director: boolean } | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(changeCampaignStage, null);
  const stage = (isCampaignStage(deal.campaign_stage) ? deal.campaign_stage : "draft") as CampaignStage;
  const options = nextStagesFor(stage);
  const missing = missingFieldsForActivation(deal);

  if (!canManage || options.length === 0) return null;

  return (
    <form action={action} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      <input type="hidden" name="deal_id" value={deal.id} />
      <div>
        <label>Ubah Stage</label>
        <select name="campaign_stage" defaultValue="">
          <option value="">— pilih —</option>
          {options.map((s) => {
            const leadPlus = stageTransitionRequiresLeadPlus(stage, s);
            const isLeadPlus = !!me && (me.rank === "lead" || me.is_od || me.is_director);
            const disabled = leadPlus && !isLeadPlus;
            return (
              <option key={s} value={s} disabled={disabled}>
                {CAMPAIGN_STAGE_LABEL[s]}
                {leadPlus ? " (Lead+)" : ""}
                {s === "active" && missing.length > 0 ? " — data belum lengkap" : ""}
              </option>
            );
          })}
        </select>
      </div>
      <button type="submit" disabled={pending} className="sm">
        {pending ? "Menyimpan…" : "Ubah Stage"}
      </button>
      {stage === "draft" && missing.length > 0 && (
        <p className="hint" style={{ width: "100%" }}>
          Belum bisa Aktif — lengkapi dulu: {missing.join(", ")}.
        </p>
      )}
      <Msg state={state} />
    </form>
  );
}

function BudgetForm({ deal, canManage }: { deal: CampaignDetailRow; canManage: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateCampaignBudget, null);
  if (!canManage) return null;

  return (
    <form action={action}>
      <input type="hidden" name="deal_id" value={deal.id} />
      <Msg state={state} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <label>Base Fee / kreator (Rp)</label>
          <input name="base_fee" inputMode="numeric" defaultValue={deal.base_fee ?? ""} />
        </div>
        <div>
          <label>Kuota Kreator</label>
          <input name="creator_quota" inputMode="numeric" defaultValue={deal.creator_quota ?? ""} />
        </div>
        <div>
          <label>Creator Budget (Rp)</label>
          <input name="creator_budget" inputMode="numeric" defaultValue={deal.creator_budget ?? ""} />
        </div>
      </div>
      <label>Ads Budget Rencana (Rp)</label>
      <input name="ads_budget_planned" inputMode="numeric" defaultValue={deal.ads_budget_planned ?? ""} />
      <label>Alasan Over Budget (isi/ubah hanya kalau alokasi melebihi creator budget)</label>
      <input name="over_budget_reason" defaultValue={deal.over_budget_reason ?? ""} />
      <button type="submit" disabled={pending} className="sm">
        {pending ? "Menyimpan…" : "Simpan Budget"}
      </button>
    </form>
  );
}

function AdsSpendSection({ deal, adsSpend, canAdd }: { deal: CampaignDetailRow; adsSpend: AdsSpendRow[]; canAdd: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addAdsSpend, null);
  const total = adsSpend.reduce((sum, s) => sum + (s.amount ?? 0), 0);

  return (
    <div className="card">
      <h2>Ads Spend (Realisasi)</h2>
      <p className="hint">
        Rencana: {rupiah(deal.ads_budget_planned)} · Realisasi tercatat: {rupiah(total)}
        {deal.ads_budget_planned ? ` (${Math.round((total / deal.ads_budget_planned) * 100)}%)` : ""}
      </p>

      {canAdd && (
        <form action={action} className="inline-form" style={{ marginBottom: 14 }}>
          <input type="hidden" name="deal_id" value={deal.id} />
          <div>
            <label>Tanggal</label>
            <input name="spend_date" type="date" required />
          </div>
          <div>
            <label>Nominal (Rp)</label>
            <input name="amount" inputMode="numeric" required style={{ width: 140 }} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Catatan</label>
            <input name="note" placeholder="opsional" />
          </div>
          <button type="submit" disabled={pending} className="sm">
            {pending ? "Menyimpan…" : "+ Entri"}
          </button>
        </form>
      )}
      <Msg state={state} />

      {adsSpend.length === 0 ? (
        <p className="hint">Belum ada entri ads spend.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Nominal</th>
              <th>Catatan</th>
            </tr>
          </thead>
          <tbody>
            {adsSpend.map((s) => (
              <tr key={s.id}>
                <td>{tanggal(s.spend_date)}</td>
                <td>{rupiah(s.amount)}</td>
                <td>{s.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const PARTICIPANT_STATUS_LABEL: Record<string, string> = {
  registered: "Menunggu Kurasi",
  approved: "Disetujui",
  rejected: "Ditolak",
  withdrawn: "Dibatalkan",
};

const PARTICIPANT_STATUS_BADGE: Record<string, string> = {
  registered: "amber",
  approved: "green",
  rejected: "red",
  withdrawn: "gray",
};

function CurateRow({
  deal,
  participant,
  creator,
}: {
  deal: CampaignDetailRow;
  participant: ParticipantRow;
  creator: { name: string; username: string | null; code: string | null } | undefined;
}) {
  const [state, action, pending] = useActionState<ParticipantActionResult | null, FormData>(
    curateCampaignParticipant,
    null
  );
  const [rejectOpen, setRejectOpen] = useState(false);

  return (
    <tr>
      <td>
        {creator?.name ?? "—"}
        {creator?.username ? <span className="hint"> · @{creator.username}</span> : null}
      </td>
      <td>{participant.code ?? "—"}</td>
      <td>{tanggal(participant.created_at)}</td>
      <td>
        <span className={`badge ${PARTICIPANT_STATUS_BADGE[participant.status] ?? "gray"}`}>
          {PARTICIPANT_STATUS_LABEL[participant.status] ?? participant.status}
        </span>
        {participant.status === "rejected" && participant.rejection_reason && (
          <div className="hint">{participant.rejection_reason}</div>
        )}
      </td>
      <td>
        {participant.status === "registered" && (
          <>
            <form action={action} style={{ display: "inline" }}>
              <input type="hidden" name="participant_id" value={participant.id} />
              <input type="hidden" name="deal_id" value={deal.id} />
              <input type="hidden" name="decision" value="approved" />
              <button type="submit" disabled={pending} className="sm">
                {pending ? "…" : "Setujui"}
              </button>
            </form>{" "}
            <button type="button" className="sm ghost2" onClick={() => setRejectOpen((v) => !v)}>
              Tolak
            </button>
            {rejectOpen && (
              <form action={action} style={{ marginTop: 6, display: "flex", gap: 6 }}>
                <input type="hidden" name="participant_id" value={participant.id} />
                <input type="hidden" name="deal_id" value={deal.id} />
                <input type="hidden" name="decision" value="rejected" />
                <input name="rejection_reason" placeholder="Alasan penolakan" required style={{ marginBottom: 0 }} />
                <button type="submit" disabled={pending} className="sm dangerbtn">
                  {pending ? "…" : "Kirim"}
                </button>
              </form>
            )}
          </>
        )}
        {state && !state.ok && <div className="err" style={{ marginTop: 6 }}>{state.message}</div>}
      </td>
    </tr>
  );
}

function ParticipantsSection({
  deal,
  participants,
  creatorById,
  canCurate,
}: {
  deal: CampaignDetailRow;
  participants: ParticipantRow[];
  creatorById: Record<string, { name: string; username: string | null; code: string | null }>;
  canCurate: boolean;
}) {
  const approvedCount = participants.filter((p) => p.status === "approved").length;

  return (
    <div className="card">
      <h2>Pendaftar ({participants.length})</h2>
      <p className="hint">
        Disetujui: {approvedCount}/{deal.creator_quota ?? "—"}
      </p>
      {participants.length === 0 ? (
        <p className="hint">Belum ada kreator mendaftar.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Kreator</th>
              <th>Kode</th>
              <th>Daftar</th>
              <th>Status</th>
              {canCurate && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {participants.map((p) =>
              canCurate ? (
                <CurateRow key={p.id} deal={deal} participant={p} creator={creatorById[p.mcn_creator_id]} />
              ) : (
                <tr key={p.id}>
                  <td>{creatorById[p.mcn_creator_id]?.name ?? "—"}</td>
                  <td>{p.code ?? "—"}</td>
                  <td>{tanggal(p.created_at)}</td>
                  <td>
                    <span className={`badge ${PARTICIPANT_STATUS_BADGE[p.status] ?? "gray"}`}>
                      {PARTICIPANT_STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SubmissionsSection({
  participants,
  videoSubmissions,
  liveSubmissions,
  creatorById,
}: {
  participants: ParticipantRow[];
  videoSubmissions: VideoSubmissionRow[];
  liveSubmissions: LiveSubmissionRow[];
  creatorById: Record<string, { name: string; username: string | null; code: string | null }>;
}) {
  const participantCreator = new Map(participants.map((p) => [p.id, p.mcn_creator_id]));
  const creatorName = (participantId: string) => {
    const cid = participantCreator.get(participantId);
    return (cid && creatorById[cid]?.name) ?? "—";
  };

  if (videoSubmissions.length === 0 && liveSubmissions.length === 0) {
    return (
      <div className="card">
        <h2>Bukti Deliverable</h2>
        <p className="hint">Belum ada bukti yang disubmit kreator.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Bukti Deliverable</h2>
      {videoSubmissions.length > 0 && (
        <>
          <h3 style={{ fontSize: 14 }}>Video ({videoSubmissions.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Kreator</th>
                <th>Link</th>
                <th>Post ID</th>
                <th>Submit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {videoSubmissions.map((s) => (
                <tr key={s.id}>
                  <td>{creatorName(s.participant_id)}</td>
                  <td>
                    <a href={s.post_url} target="_blank" rel="noreferrer">
                      {s.post_url.length > 40 ? `${s.post_url.slice(0, 40)}…` : s.post_url}
                    </a>
                  </td>
                  <td className="hint">{s.post_id ?? "—"}</td>
                  <td>{tanggal(s.submitted_at)}</td>
                  <td>{s.is_duplicate && <span className="badge red">Duplikat</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {liveSubmissions.length > 0 && (
        <>
          <h3 style={{ fontSize: 14, marginTop: 14 }}>Live ({liveSubmissions.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Kreator</th>
                <th>Tanggal</th>
                <th>Durasi</th>
                <th>Bukti</th>
              </tr>
            </thead>
            <tbody>
              {liveSubmissions.map((s) => (
                <tr key={s.id}>
                  <td>{creatorName(s.participant_id)}</td>
                  <td>{tanggal(s.live_date)}</td>
                  <td>{s.duration_minutes} menit</td>
                  <td>
                    {s.proof_url ? (
                      <a href={s.proof_url} target="_blank" rel="noreferrer">
                        link
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const PAYOUT_STATUS_CLASS: Record<string, string> = {
  "[Menunggu Disbursement]": "amber",
  "[Ditransfer]": "green",
  "[Dibatalkan]": "red",
};

const BATCH_STATUS_CLASS: Record<string, string> = { draft: "gray", closed: "green" };

function CreateBatchForm({ dealId }: { dealId: string }) {
  const [state, action, pending] = useActionState<PayoutActionResult | null, FormData>(createCurationBatch, null);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="deal_id" value={dealId} />
      <div>
        <label>Periode Mulai</label>
        <input name="period_start" type="date" required />
      </div>
      <div>
        <label>Periode Selesai</label>
        <input name="period_end" type="date" required />
      </div>
      <button type="submit" disabled={pending} className="sm">
        {pending ? "Membuat…" : "+ Batch Kurasi"}
      </button>
      {state && !state.ok && <div className="err">{state.message}</div>}
    </form>
  );
}

function CloseBatchButton({
  batch,
  dealId,
  preview,
}: {
  batch: CurationBatchRow;
  dealId: string;
  preview: { count: number; total: number };
}) {
  const [state, action, pending] = useActionState<PayoutActionResult | null, FormData>(closeCurationBatch, null);
  return (
    <form action={action}>
      <input type="hidden" name="batch_id" value={batch.id} />
      <input type="hidden" name="deal_id" value={dealId} />
      <p className="hint">
        Preview: {preview.count} kreator completed, total {rupiah(preview.total)}.
      </p>
      <button type="submit" disabled={pending} className="sm">
        {pending ? "Menutup…" : "Tutup Periode"}
      </button>
      {state && <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>}
    </form>
  );
}

function BatchesSection({
  deal,
  batches,
  participants,
  videoSubmissions,
  liveSubmissions,
  payouts,
  canCurate,
}: {
  deal: CampaignDetailRow;
  batches: CurationBatchRow[];
  participants: ParticipantRow[];
  videoSubmissions: VideoSubmissionRow[];
  liveSubmissions: LiveSubmissionRow[];
  payouts: CampaignPayoutRow[];
  canCurate: boolean;
}) {
  const alreadyPaidParticipantIds = payouts.map((p) => p.participant_id);
  const completion = computeCampaignCompletion({
    campaignTrack: deal.campaign_track as "video" | "live" | null,
    baseFee: deal.base_fee,
    participants: participants.map((p) => ({
      participantId: p.id,
      mcnCreatorId: p.mcn_creator_id,
      status: p.status,
    })),
    videoSubmissions: videoSubmissions.map((s) => ({ participantId: s.participant_id, isDuplicate: s.is_duplicate })),
    liveSubmissions: liveSubmissions.map((s) => ({ participantId: s.participant_id })),
    alreadyPaidParticipantIds,
  });
  const preview = { count: completion.length, total: sumCompletionAmount(completion) };

  return (
    <div className="card">
      <h2>Batch Kurasi</h2>
      <p className="hint">
        Tutup periode untuk mengunci pendaftar yang completed jadi payout (keputusan #13) — sekali
        ditutup, hasilnya tidak berubah lagi meski bukti baru masuk.
      </p>
      {canCurate && <CreateBatchForm dealId={deal.id} />}

      {batches.length === 0 ? (
        <p className="hint">Belum ada batch kurasi.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Periode</th>
              <th>Status</th>
              <th>Hasil</th>
              {canCurate && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td>{b.code ?? "—"}</td>
                <td>
                  {tanggal(b.period_start)} – {tanggal(b.period_end)}
                </td>
                <td>
                  <span className={`badge ${BATCH_STATUS_CLASS[b.status] ?? "gray"}`}>{b.status}</span>
                </td>
                <td>
                  {b.status === "closed"
                    ? `${b.total_completed ?? 0} kreator · ${rupiah(b.total_amount)}`
                    : "—"}
                </td>
                {canCurate && (
                  <td>{b.status === "draft" && <CloseBatchButton batch={b} dealId={deal.id} preview={preview} />}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PayoutsSection({
  payouts,
  creatorById,
}: {
  payouts: CampaignPayoutRow[];
  creatorById: Record<string, { name: string; username: string | null; code: string | null }>;
}) {
  if (payouts.length === 0) return null;
  return (
    <div className="card">
      <h2>Payout ({payouts.length})</h2>
      <p className="hint">Transfer &amp; pembatalan dikelola tim Finance di /finance.</p>
      <table>
        <thead>
          <tr>
            <th>Kode</th>
            <th>Kreator</th>
            <th className="right">Nominal</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((p) => (
            <tr key={p.id}>
              <td>{p.code ?? "—"}</td>
              <td>{creatorById[p.mcn_creator_id]?.name ?? "—"}</td>
              <td className="right">{rupiah(p.amount)}</td>
              <td>
                <span className={`badge ${PAYOUT_STATUS_CLASS[p.status] ?? "gray"}`}>{p.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CampaignDetail({
  deal,
  budgetLog,
  adsSpend,
  participants,
  videoSubmissions,
  liveSubmissions,
  curationBatches,
  payouts,
  creatorById,
  nameById,
  me,
  canManageBudgetStage,
  canCurate,
}: {
  deal: CampaignDetailRow;
  budgetLog: BudgetLogRow[];
  adsSpend: AdsSpendRow[];
  participants: ParticipantRow[];
  videoSubmissions: VideoSubmissionRow[];
  liveSubmissions: LiveSubmissionRow[];
  curationBatches: CurationBatchRow[];
  payouts: CampaignPayoutRow[];
  creatorById: Record<string, { name: string; username: string | null; code: string | null }>;
  nameById: Record<string, string>;
  me: { rank: string | null; is_od: boolean; is_director: boolean } | null;
  canManageBudgetStage: boolean;
  canCurate: boolean;
}) {
  const stage = (isCampaignStage(deal.campaign_stage) ? deal.campaign_stage : "draft") as CampaignStage;

  return (
    <>
      <h1>
        {deal.code ?? "—"} · {deal.brand_name}
      </h1>
      <p className="page-sub">
        {deal.funding_source ? FUNDING_SOURCE_LABEL[deal.funding_source as FundingSource] : "Funding belum diisi"} ·{" "}
        {deal.campaign_track ? CAMPAIGN_TRACK_LABEL[deal.campaign_track as CampaignTrack] : "Track belum diisi"} ·{" "}
        Tim ops: {deal.operational_team ?? "—"}
        {deal.operational_owner_id && nameById[deal.operational_owner_id] ? ` (${nameById[deal.operational_owner_id]})` : ""}
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Stage</div>
          <div className="v small">{CAMPAIGN_STAGE_LABEL[stage]}</div>
        </div>
        <div className="stat">
          <div className="k">Alokasi (base fee × kuota)</div>
          <div className="v small">{rupiah(deal.allocated_amount)}</div>
        </div>
        <div className="stat">
          <div className="k">Creator Budget</div>
          <div className="v small">{rupiah(deal.creator_budget)}</div>
        </div>
        <div className="stat">
          <div className="k">Over Budget</div>
          <div className="v small">{deal.over_budget ? "Ya" : "Tidak"}</div>
        </div>
      </div>

      <div className="card">
        <h2>Stage Campaign</h2>
        <StageSwitcher deal={deal} canManage={canManageBudgetStage} me={me} />
      </div>

      <div className="card">
        <h2>Budget</h2>
        <BudgetForm deal={deal} canManage={canManageBudgetStage} />
        {deal.over_budget && deal.over_budget_reason && (
          <p className="hint">
            <span className="badge red">Over Budget</span> {deal.over_budget_reason}
          </p>
        )}

        {budgetLog.length > 0 && (
          <details className="disclose" style={{ marginTop: 14 }}>
            <summary>Riwayat Budget ({budgetLog.length})</summary>
            <table>
              <thead>
                <tr>
                  <th>Waktu</th>
                  <th>Base Fee</th>
                  <th>Kuota</th>
                  <th>Alokasi</th>
                  <th>Creator Budget</th>
                  <th>Over Budget</th>
                  <th>Alasan</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {budgetLog.map((l) => (
                  <tr key={l.id}>
                    <td>{tanggal(l.created_at)}</td>
                    <td>{rupiah(l.base_fee)}</td>
                    <td>{num(l.creator_quota)}</td>
                    <td>{rupiah(l.allocated_amount)}</td>
                    <td>{rupiah(l.creator_budget)}</td>
                    <td>{l.over_budget ? "Ya" : "Tidak"}</td>
                    <td>{l.over_budget_reason ?? "—"}</td>
                    <td>{(l.actor && nameById[l.actor]) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>

      <ParticipantsSection deal={deal} participants={participants} creatorById={creatorById} canCurate={canCurate} />

      <SubmissionsSection
        participants={participants}
        videoSubmissions={videoSubmissions}
        liveSubmissions={liveSubmissions}
        creatorById={creatorById}
      />

      <BatchesSection
        deal={deal}
        batches={curationBatches}
        participants={participants}
        videoSubmissions={videoSubmissions}
        liveSubmissions={liveSubmissions}
        payouts={payouts}
        canCurate={canCurate}
      />

      <PayoutsSection payouts={payouts} creatorById={creatorById} />

      <AdsSpendSection deal={deal} adsSpend={adsSpend} canAdd={canManageBudgetStage} />

      <div className="card">
        <h2>Target &amp; Window</h2>
        <p>
          Target Location ID: <strong>{deal.target_location_id ?? "—"}</strong>
        </p>
        <p>
          Target GMV: {rupiah(deal.target_gmv)} · Target Views: {num(deal.target_views)}
        </p>
        <p>
          Window Post: {deal.post_window_start ? tanggal(deal.post_window_start) : "—"} –{" "}
          {deal.post_window_end ? tanggal(deal.post_window_end) : "—"}
        </p>
        <p>Deadline Submit Bukti: {deal.submission_deadline ? tanggal(deal.submission_deadline) : "—"}</p>
        <p>Free Meal: {deal.has_free_meal ? "Ya" : "Tidak"}</p>
        {deal.brief && <p style={{ whiteSpace: "pre-wrap" }}>{deal.brief}</p>}
      </div>

      <div className="card">
        <h2>Segmentasi Kelayakan Pendaftar</h2>
        <p className="hint">Dipakai gerbang pendaftaran kreator di Fase G.2. Follower tidak dipakai.</p>
        <p>
          Industry: <Tag list={deal.eligible_industries} />
        </p>
        <p>
          Kota: <Tag list={deal.eligible_cities} />
        </p>
        <p>
          Level: <Tag list={deal.eligible_levels} />
        </p>
        <p>
          Jenis Kreator: <Tag list={deal.eligible_creator_types} />
        </p>
        <p>
          Roster Live: <Tag list={deal.eligible_roster_status} />
        </p>
        <p>
          Status Kontrak: <Tag list={deal.eligible_status_kontrak} />
        </p>
        <p>
          Ambang GMV: {deal.min_gmv ? `${rupiah(deal.min_gmv)} (${deal.min_gmv_metric ?? "-"}, ${deal.min_gmv_period_days ?? "-"} hari)` : "—"}
        </p>
      </div>
    </>
  );
}
