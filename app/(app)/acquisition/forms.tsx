"use client";

import { useActionState, useState } from "react";
import {
  recordAcquisition,
  recordReferral,
  markReferralPaid,
  markHandoffDone,
  refreshGmvPostJoin,
  type ActionResult,
} from "@/lib/actions/acquisition";

type CreatorOpt = { id: string; code: string | null; name: string };

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function RecordAcquisitionForm({ prospects }: { prospects: CreatorOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    recordAcquisition,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Kreator (prospek) *</label>
          <select name="mcn_creator_id" defaultValue="" required>
            <option value="" disabled>
              Pilih kreator prospek…
            </option>
            {prospects.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? "—"} · {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Tanggal Binding *</label>
          <input type="date" name="binding_date" required />
        </div>
      </div>
      <label>Sumber Lead</label>
      <select name="lead_source" defaultValue="">
        <option value="">— pilih —</option>
        <option value="inbound">inbound</option>
        <option value="outbound">outbound</option>
        <option value="platform">platform</option>
      </select>
      <label>Catatan</label>
      <textarea name="notes" rows={2} />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Catat Akuisisi (Binding)"}
      </button>
    </form>
  );
}

export function RefreshGmvButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    refreshGmvPostJoin,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Refresh GMV"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

export function HandoffButton({ id, blocked }: { id: string; blocked: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    markHandoffDone,
    null
  );
  return (
    <div>
      <form action={action} className="inline-form">
        <input type="hidden" name="id" value={id} />
        <button className="sm" disabled={pending}>
          {pending ? "…" : "Handoff Selesai"}
        </button>
      </form>
      {blocked && (
        <div className="muted" style={{ fontSize: 11 }}>
          owner CM belum ditetapkan — minta CM Lead menetapkan owner dulu.
        </div>
      )}
      {state && !state.ok && <div className="err" style={{ marginTop: 4 }}>{state.message}</div>}
    </div>
  );
}

export function RecordReferralForm({ creators }: { creators: CreatorOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    recordReferral,
    null
  );
  const [source, setSource] = useState<"antar_creator" | "platform" | "">("");
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Kreator Baru *</label>
          <select name="new_creator_id" defaultValue="" required>
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
        <div>
          <label>Sumber Referral *</label>
          <select
            name="referral_source"
            defaultValue=""
            required
            onChange={(e) => setSource(e.target.value as "antar_creator" | "platform")}
          >
            <option value="" disabled>
              Pilih sumber…
            </option>
            <option value="antar_creator">antar_creator</option>
            <option value="platform">platform</option>
          </select>
        </div>
      </div>
      {source === "antar_creator" && (
        <>
          <label>Kreator Perujuk *</label>
          <select name="referrer_creator_id" defaultValue="" required>
            <option value="" disabled>
              Pilih kreator perujuk…
            </option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? "—"} · {c.name}
              </option>
            ))}
          </select>
        </>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Catat Referral"}
      </button>
    </form>
  );
}

export function MarkReferralPaidButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    markReferralPaid,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Tandai Dibayar"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}
