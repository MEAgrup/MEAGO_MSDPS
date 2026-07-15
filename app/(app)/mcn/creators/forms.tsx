"use client";

import { useActionState } from "react";
import {
  addCreator,
  assignOwner,
  toggleRoster,
  setAdsBudgetCap,
  setCreatorStatus,
  type ActionResult,
} from "@/lib/actions/mcn-creators";

type Employee = { id: string; full_name: string };

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function AddCreatorForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addCreator,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Nama Kreator *</label>
          <input name="name" required />
        </div>
        <div>
          <label>Niche</label>
          <input name="niche" placeholder="mis. Fashion" />
        </div>
      </div>
      <label>Catatan</label>
      <textarea name="notes" rows={2} />
      <input type="hidden" name="platform" value="tiktok" />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Daftarkan Prospek"}
      </button>
    </form>
  );
}

export function AssignOwnerForm({
  creatorId,
  ownerId,
  cmEmployees,
}: {
  creatorId: string;
  ownerId: string | null;
  cmEmployees: Employee[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    assignOwner,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="creator_id" value={creatorId} />
      <select name="owner_cpm_id" defaultValue={ownerId ?? ""} style={{ width: 160 }}>
        <option value="">— tanpa owner —</option>
        {cmEmployees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.full_name}
          </option>
        ))}
      </select>
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

export function ToggleRosterButton({
  creatorId,
  liveRoster,
}: {
  creatorId: string;
  liveRoster: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    toggleRoster,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="creator_id" value={creatorId} />
      <input type="hidden" name="live_roster" value={String(!liveRoster)} />
      <button className={`sm ${liveRoster ? "ghost2" : ""}`} disabled={pending}>
        {pending ? "…" : liveRoster ? "Keluarkan dari roster" : "Masukkan ke roster"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

export function AdsBudgetCapForm({
  creatorId,
  current,
}: {
  creatorId: string;
  current: number | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setAdsBudgetCap,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="creator_id" value={creatorId} />
      <input
        name="ads_budget_cap"
        defaultValue={current ?? ""}
        placeholder="mis. 1.000.000"
        style={{ width: 120 }}
      />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && (
        <span className={`badge ${state.ok ? "green" : "red"}`} title={state.message}>
          {state.ok ? "ok" : "gagal"}
        </span>
      )}
    </form>
  );
}

const STATUS_NEXT: Record<string, string[]> = {
  prospek: ["binding", "aktif"],
  binding: ["aktif"],
  aktif: ["nonaktif"],
  nonaktif: ["aktif"],
};

function StatusTransitionButton({ creatorId, to }: { creatorId: string; to: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setCreatorStatus,
    null
  );
  return (
    <form action={action} style={{ display: "inline-block", marginRight: 6 }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <input type="hidden" name="status" value={to} />
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : `→ ${to}`}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          ditolak
        </span>
      )}
    </form>
  );
}

export function CreatorStatusControls({
  creatorId,
  status,
}: {
  creatorId: string;
  status: string;
}) {
  const targets = STATUS_NEXT[status] ?? [];
  if (targets.length === 0) return <span className="muted">—</span>;
  return (
    <div className="actions-row">
      {targets.map((t) => (
        <StatusTransitionButton key={t} creatorId={creatorId} to={t} />
      ))}
    </div>
  );
}
