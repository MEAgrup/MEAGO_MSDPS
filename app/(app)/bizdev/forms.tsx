"use client";

import { useActionState } from "react";
import { createShopLead, type ActionResult } from "@/lib/actions/bizdev";
import { setPipelineStage } from "@/lib/actions/deals";
import { progressRequest } from "@/lib/actions/mcn-requests";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function ShopLeadForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createShopLead,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Nama Lead Shop *</label>
          <input name="lead_name" required />
        </div>
        <div>
          <label>No. HP *</label>
          <input name="phone_raw" placeholder="0812… atau +62…" required />
        </div>
      </div>
      <label>Email</label>
      <input name="email" type="email" />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Kirim ke Pool Leads"}
      </button>
    </form>
  );
}

export const PIPELINE_STAGES = ["baru", "nego", "kontrak", "berjalan", "selesai"];

export function PipelineStageSelect({ dealId, current }: { dealId: string; current: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setPipelineStage,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={dealId} />
      <select name="pipeline_stage" defaultValue={current} style={{ width: 120 }}>
        {PIPELINE_STAGES.map((s) => (
          <option key={s} value={s}>
            {s}
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

// Progress status creator_requests (state machine DB: diajukan→diproses|ditolak,
// diproses→selesai). Sama seperti /meago/workspace, diduplikasi di sini karena
// tiap route menyimpan komponen form sendiri (konvensi repo).
const REQUEST_NEXT: Record<string, string[]> = {
  diajukan: ["diproses", "ditolak"],
  diproses: ["selesai"],
};

function RequestProgressButton({ id, to }: { id: string; to: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    progressRequest,
    null
  );
  return (
    <form action={action} style={{ display: "inline-block", marginRight: 6 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={to} />
      <button className={`sm ${to === "ditolak" ? "ghost2" : ""}`} disabled={pending}>
        {pending ? "…" : `→ ${to}`}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          {state.message}
        </span>
      )}
    </form>
  );
}

export function RequestProgressControls({ id, status }: { id: string; status: string }) {
  const targets = REQUEST_NEXT[status] ?? [];
  if (targets.length === 0) return <span className="muted">—</span>;
  return (
    <div className="actions-row">
      {targets.map((t) => (
        <RequestProgressButton key={t} id={id} to={t} />
      ))}
    </div>
  );
}
