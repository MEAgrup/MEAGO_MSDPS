"use client";

import { useActionState } from "react";
import {
  createShopLead,
  createCampaignRequest,
  cmConfirm,
  brandAcc,
  finalizeCampaign,
  handoverCampaign,
  type ActionResult,
} from "@/lib/actions/bizdev";
import { setPipelineStage } from "@/lib/actions/deals";
import { progressRequest } from "@/lib/actions/mcn-requests";

type DealOpt = { id: string; code: string | null; brand_name: string };
type CreatorOpt = { id: string; code: string | null; name: string };

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

export function CampaignRequestForm({ deals, creators }: { deals: DealOpt[]; creators: CreatorOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createCampaignRequest,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Deal</label>
          <select name="deal_id" defaultValue="">
            <option value="">— tanpa deal —</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code ?? "—"} · {d.brand_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Kreator *</label>
          <select name="mcn_creator_id" defaultValue="" required>
            <option value="" disabled>
              Pilih kreator…
            </option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? "—"} · {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="checks">
        <label>
          <input type="checkbox" name="needs_brand_acc" value="true" /> Butuh approval brand
        </label>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Mengirim…" : "Buat Campaign Request"}
      </button>
    </form>
  );
}

export function CmConfirmButtons({ id, can }: { id: string; can: boolean }) {
  const [mauState, mauAction, mauPending] = useActionState<ActionResult | null, FormData>(
    cmConfirm,
    null
  );
  if (!can) return null;
  return (
    <div className="actions-row">
      <form action={mauAction} style={{ display: "inline-block" }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="confirm" value="mau" />
        <button className="sm" disabled={mauPending}>
          {mauPending ? "…" : "CM: mau"}
        </button>
      </form>
      <form action={mauAction} style={{ display: "inline-block" }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="confirm" value="tidak" />
        <button className="sm ghost2" disabled={mauPending}>
          {mauPending ? "…" : "CM: tidak"}
        </button>
      </form>
      {mauState && !mauState.ok && (
        <span className="badge red" title={mauState.message}>
          ditolak
        </span>
      )}
    </div>
  );
}

export function BrandAccButtons({ id, can }: { id: string; can: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(brandAcc, null);
  if (!can) return null;
  return (
    <div className="actions-row">
      <form action={action} style={{ display: "inline-block" }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="acc" value="approved" />
        <button className="sm" disabled={pending}>
          {pending ? "…" : "Brand: approved"}
        </button>
      </form>
      <form action={action} style={{ display: "inline-block" }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="acc" value="ditolak" />
        <button className="sm ghost2" disabled={pending}>
          {pending ? "…" : "Brand: ditolak"}
        </button>
      </form>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          ditolak
        </span>
      )}
    </div>
  );
}

export function FinalizeButtons({ id, can }: { id: string; can: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    finalizeCampaign,
    null
  );
  if (!can) return null;
  return (
    <div className="actions-row">
      <form action={action} style={{ display: "inline-block" }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="final" value="fix" />
        <button className="sm" disabled={pending}>
          {pending ? "…" : "Final: fix"}
        </button>
      </form>
      <form action={action} style={{ display: "inline-block" }}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="final" value="batal" />
        <button className="sm dangerbtn" disabled={pending}>
          {pending ? "…" : "Final: batal"}
        </button>
      </form>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          ditolak
        </span>
      )}
    </div>
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

export function HandoverButton({ id, can }: { id: string; can: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    handoverCampaign,
    null
  );
  if (!can) return null;
  return (
    <form action={action} style={{ display: "inline-block" }}>
      <input type="hidden" name="id" value={id} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Handover ke CM"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          ditolak
        </span>
      )}
    </form>
  );
}
