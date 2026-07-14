"use client";

import { useActionState } from "react";
import {
  createCampaign,
  setCampaignStatus,
  upsertMarketingBudget,
  type ActionResult,
} from "@/lib/actions/campaigns";

type Emp = { id: string; full_name: string };

const NEXT: Record<string, string[]> = {
  "[Draft]": ["[Active]"],
  "[Active]": ["[Paused]", "[Closed]"],
  "[Paused]": ["[Active]", "[Closed]"],
  "[Closed]": ["[Archived]"],
  "[Archived]": [],
};

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function NewCampaignForm({ owners }: { owners: Emp[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createCampaign,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Nama Kampanye *</label>
          <input name="campaign_name" required />
        </div>
        <div>
          <label>Channel / Sumber *</label>
          <input name="channel" placeholder="mis. Meta Ads, Webinar, Referral" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Tanggal Mulai *</label>
          <input name="start_date" type="date" required />
        </div>
        <div>
          <label>Owner (PIC)</label>
          <select name="owner_id" defaultValue="">
            <option value="">Saya sendiri</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="checks">
        <label>
          <input type="checkbox" name="is_online" /> Online
        </label>
        <label>
          <input type="checkbox" name="is_offline" /> Offline
        </label>
      </div>
      <div className="checks">
        <label>
          <input type="checkbox" name="activate" defaultChecked /> Langsung aktifkan (jadikan
          [Active])
        </label>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Buat Kampanye"}
      </button>
    </form>
  );
}

// One <form> per transition with a hidden to_status input. Relying on a submit
// button's name/value is unreliable with React 19 Server Actions (the submitter
// value is not delivered), so we send it explicitly.
function TransitionButton({ id, to }: { id: string; to: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setCampaignStatus,
    null
  );
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to_status" value={to} />
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : to}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          ditolak
        </span>
      )}
    </form>
  );
}

export function StatusButtons({ id, status }: { id: string; status: string }) {
  const targets = NEXT[status] ?? [];
  if (targets.length === 0) return <span className="muted">—</span>;
  return (
    <div className="actions-row">
      {targets.map((t) => (
        <TransitionButton key={t} id={id} to={t} />
      ))}
    </div>
  );
}

export function BudgetForm({ campaignId, current }: { campaignId: string; current: number | null }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    upsertMarketingBudget,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="campaign_id" value={campaignId} />
      <input
        name="budget"
        type="number"
        min={1}
        step="1000"
        defaultValue={current ?? undefined}
        placeholder="Budget (Rp)"
        required
        style={{ width: 160 }}
      />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && (
        <span className={state.ok ? "badge green" : "badge red"}>
          {state.ok ? "tersimpan" : "gagal"}
        </span>
      )}
    </form>
  );
}
