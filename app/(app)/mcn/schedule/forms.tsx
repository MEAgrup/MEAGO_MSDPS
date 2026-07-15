"use client";

import { useActionState } from "react";
import {
  createSlot,
  updateSlot,
  deleteSlot,
  verifySlot,
  copyWeek,
  toggleRosterInline,
  type ActionResult,
} from "@/lib/actions/mcn-schedule";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function AddSlotForm({ creatorId, date }: { creatorId: string; date: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createSlot,
    null
  );
  return (
    <details>
      <summary>+ tambah slot</summary>
      <form action={action} style={{ marginTop: 8 }}>
        <Msg state={state} />
        <input type="hidden" name="mcn_creator_id" value={creatorId} />
        <input type="hidden" name="schedule_date" value={date} />
        <div className="row">
          <div>
            <label>Jam mulai</label>
            <input type="time" name="start_time" />
          </div>
          <div>
            <label>Jam selesai</label>
            <input type="time" name="end_time" />
          </div>
        </div>
        <label>Brand</label>
        <input name="brand_name" />
        <label>Status</label>
        <select name="status" defaultValue="scheduled">
          <option value="scheduled">scheduled</option>
          <option value="tentative">tentative</option>
          <option value="off">off</option>
        </select>
        <button className="sm" type="submit" disabled={pending}>
          {pending ? "…" : "Buat Slot"}
        </button>
      </form>
    </details>
  );
}

// Toggle satu field boolean (pk_ready / product_connected_tap) lewat updateSlot.
export function SlotFieldToggle({
  slotId,
  field,
  current,
  label,
}: {
  slotId: string;
  field: "pk_ready" | "product_connected_tap";
  current: boolean;
  label: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateSlot,
    null
  );
  return (
    <form action={action} style={{ display: "inline-block" }}>
      <input type="hidden" name="id" value={slotId} />
      <input type="hidden" name={field} value={String(!current)} />
      <button className={`sm ${current ? "" : "ghost2"}`} disabled={pending} title={label}>
        {pending ? "…" : label}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          !
        </span>
      )}
    </form>
  );
}

const SLOT_STATUS_NEXT: Record<string, string[]> = {
  scheduled: ["tentative", "off"],
  tentative: ["scheduled", "off"],
  off: ["scheduled"],
};

export function SlotStatusControls({ slotId, status }: { slotId: string; status: string }) {
  const targets = SLOT_STATUS_NEXT[status] ?? [];
  if (targets.length === 0) return null;
  return (
    <div className="actions-row">
      {targets.map((t) => (
        <SlotStatusButton key={t} slotId={slotId} to={t} />
      ))}
    </div>
  );
}

function SlotStatusButton({ slotId, to }: { slotId: string; to: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateSlot,
    null
  );
  return (
    <form action={action} style={{ display: "inline-block" }}>
      <input type="hidden" name="id" value={slotId} />
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

export function DeleteSlotButton({ slotId }: { slotId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    deleteSlot,
    null
  );
  return (
    <form action={action} style={{ display: "inline-block" }}>
      <input type="hidden" name="id" value={slotId} />
      <button className="sm dangerbtn" disabled={pending}>
        {pending ? "…" : "Hapus"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

export function VerifySlotForm({ slotId }: { slotId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    verifySlot,
    null
  );
  return (
    <form action={action} className="inline-form">
      <Msg state={state} />
      <input type="hidden" name="id" value={slotId} />
      <input type="time" name="actual_start" required style={{ width: 100 }} />
      <input type="time" name="actual_end" style={{ width: 100 }} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Verifikasi"}
      </button>
    </form>
  );
}

export function CopyWeekForm({ sourceMonday }: { sourceMonday: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    copyWeek,
    null
  );
  return (
    <form action={action} className="inline-form">
      <Msg state={state} />
      <input type="hidden" name="source_monday" value={sourceMonday} />
      <label style={{ marginBottom: 0 }}>Salin ke minggu (Senin target)</label>
      <input type="date" name="target_monday" required style={{ width: 160 }} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Copy Week"}
      </button>
    </form>
  );
}

export function RosterToggleButton({
  creatorId,
  liveRoster,
  label,
}: {
  creatorId: string;
  liveRoster: boolean;
  label: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    toggleRosterInline,
    null
  );
  return (
    <form action={action} style={{ display: "inline-block" }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <input type="hidden" name="live_roster" value={String(!liveRoster)} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : label}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}
