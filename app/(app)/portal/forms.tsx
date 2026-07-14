"use client";

import { useActionState } from "react";
import {
  ajukanBlock,
  putuskanBlock,
  resumeBrief,
  type ActionResult,
} from "@/lib/actions/blocks";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function AjukanBlockForm({ briefId }: { briefId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    ajukanBlock,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="brief_id" value={briefId} />
      <input name="reason" placeholder="Alasan terblokir (wajib)…" required style={{ minWidth: 220 }} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Ajukan Block"}
      </button>
      <Msg state={state} />
    </form>
  );
}

// Satu <form> per aksi + hidden input (konvensi React 19 — jangan andalkan
// name/value tombol submit).
export function PutuskanBlockForms({ blockId }: { blockId: string }) {
  const [aState, approve, aPending] = useActionState<ActionResult | null, FormData>(
    putuskanBlock,
    null
  );
  const [rState, reject, rPending] = useActionState<ActionResult | null, FormData>(
    putuskanBlock,
    null
  );
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <form action={approve} style={{ display: "inline" }}>
        <input type="hidden" name="id" value={blockId} />
        <input type="hidden" name="to_status" value="[Approved]" />
        <button className="sm" disabled={aPending}>
          {aPending ? "…" : "Approve"}
        </button>
      </form>
      <form action={reject} style={{ display: "inline" }}>
        <input type="hidden" name="id" value={blockId} />
        <input type="hidden" name="to_status" value="[Rejected]" />
        <button className="sm btn-ghost" disabled={rPending}>
          {rPending ? "…" : "Reject"}
        </button>
      </form>
      <Msg state={aState} />
      <Msg state={rState} />
    </div>
  );
}

export function ResumeBriefButton({ briefId }: { briefId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    resumeBrief,
    null
  );
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="brief_id" value={briefId} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Lanjutkan (resume)"}
      </button>
      <Msg state={state} />
    </form>
  );
}
