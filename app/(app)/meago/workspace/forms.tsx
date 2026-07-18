"use client";

import { useActionState, useState } from "react";
import {
  createRequest,
  approveRequest,
  progressRequest,
  type ActionResult,
} from "@/lib/actions/mcn-requests";
import { PORTAL_REQUEST_TYPES, REQUEST_TYPE_LABELS, NOMINAL_TYPES } from "@/lib/mcn/request-types";

// Jenis lama form CM (tetap valid — lihat komentar 0311 di lib/mcn/request-types.ts).
const LEGACY_REQUEST_TYPES = ["sample", "ads", "hsl"] as const;

// IngestForm sekarang komponen bersama (dipakai juga di /meago/creators) — lihat
// app/(app)/meago/ingest-form.tsx. Re-export di sini supaya import existing
// (`import { IngestForm } from "./forms"`) tetap jalan tanpa perlu ubah page.tsx.
export { IngestForm } from "../ingest-form";

type CreatorOpt = { id: string; name: string; code: string | null };

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

export function CreateRequestForm({ creators }: { creators: CreatorOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createRequest,
    null
  );
  const [type, setType] = useState<string>("sample");
  const showNominal = (NOMINAL_TYPES as readonly string[]).includes(type);
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Kreator *</label>
          <select name="mcn_creator_id" defaultValue="" required>
            <option value="" disabled>
              Pilih kreator…
            </option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? "(draft)"} · {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Tipe *</label>
          <select
            name="type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            required
          >
            {LEGACY_REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {REQUEST_TYPE_LABELS[t]}
              </option>
            ))}
            {PORTAL_REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {REQUEST_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Target Brand</label>
          <input name="target_brand" placeholder="mis. nama tempat/brand (free meal, visit, dll)" />
        </div>
        <div>
          <label>Budget Ads (bila tipe ads)</label>
          <input name="budget" placeholder="mis. 500.000" />
        </div>
      </div>
      {showNominal && (
        <div className="row">
          <div>
            <label>Nominal (Rupiah) — {REQUEST_TYPE_LABELS[type]}</label>
            <input name="nominal" placeholder="mis. 500.000" />
          </div>
        </div>
      )}
      <label>Detail</label>
      <textarea name="detail" rows={2} />
      <button type="submit" disabled={pending}>
        {pending ? "Mengirim…" : "Buat Request"}
      </button>
    </form>
  );
}

export function ApproveRequestButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    approveRequest,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Approve"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          ditolak
        </span>
      )}
    </form>
  );
}

const REQUEST_NEXT: Record<string, string[]> = {
  diajukan: ["diproses", "ditolak"],
  diproses: ["selesai"],
};

function ProgressButton({ id, to }: { id: string; to: string }) {
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
  if (targets.length === 0) return <span className="muted">selesai</span>;
  return (
    <div className="actions-row">
      {targets.map((t) => (
        <ProgressButton key={t} id={id} to={t} />
      ))}
    </div>
  );
}
