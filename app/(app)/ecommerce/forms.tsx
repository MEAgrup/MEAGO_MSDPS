"use client";

import { useActionState } from "react";
import { setBriefStatus, type ActionResult } from "@/lib/actions/account";
import { createSkuUnit, setSkuStatus, saveChecklist } from "@/lib/actions/ecommerce";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function PickupBriefButton({ briefId }: { briefId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setBriefStatus,
    null
  );
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={briefId} />
      <input type="hidden" name="to_status" value="[In Progress]" />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Pick-up Brief"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function CreateUnitForm({ briefId }: { briefId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createSkuUnit,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="brief_id" value={briefId} />
      <input
        name="product_ref"
        placeholder="Nama produk + link/ID listing (wajib produk nyata)"
        required
        style={{ width: 360 }}
      />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "+ Work Unit"}
      </button>
      <Msg state={state} />
    </form>
  );
}

// Satu form per aksi + hidden input (submitter name/value tidak terkirim — BUILD_PLAN).
export function SkuStatusForm({
  unitId,
  toStatus,
  label,
  notesField,
  notesPlaceholder,
  danger,
}: {
  unitId: string;
  toStatus: string;
  label: string;
  notesField?: "revision_notes" | "cancellation_reason";
  notesPlaceholder?: string;
  danger?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setSkuStatus,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={unitId} />
      <input type="hidden" name="to_status" value={toStatus} />
      {notesField && (
        <input
          name={notesField}
          placeholder={notesPlaceholder ?? "Catatan (wajib)"}
          required
          style={{ width: 200 }}
        />
      )}
      <button className={`sm ${danger ? "dangerbtn" : ""}`} disabled={pending}>
        {pending ? "…" : label}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function ChecklistForm({
  unitId,
  scope,
  done,
}: {
  unitId: string;
  scope: string[];
  done: string[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    saveChecklist,
    null
  );
  return (
    <form action={action}>
      <input type="hidden" name="id" value={unitId} />
      <div className="checks">
        {scope.map((it) => (
          <label key={it}>
            <input
              type="checkbox"
              name="checklist_done"
              value={it}
              defaultChecked={done.includes(it)}
            />{" "}
            {it}
          </label>
        ))}
      </div>
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : "Simpan checklist"}
      </button>
      <Msg state={state} />
    </form>
  );
}

// Timer manual dihapus — waktu kerja otomatis per Brief (trigger briefs_track_time).
