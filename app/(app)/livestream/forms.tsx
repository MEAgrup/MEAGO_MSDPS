"use client";

import { useActionState } from "react";
import { setBriefStatus, type ActionResult } from "@/lib/actions/account";
import {
  addLsrManual,
  importLsrTemplate,
  resolveUnmatched,
  upsertGmvAuthoritative,
} from "@/lib/actions/livestream";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

// Forward brief ke vendor / tandai selesai (state machine brief LiveStream).
export function BriefForwardForm({
  briefId,
  toStatus,
  label,
}: {
  briefId: string;
  toStatus: string;
  label: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setBriefStatus,
    null
  );
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={briefId} />
      <input type="hidden" name="to_status" value={toStatus} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : label}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function ImportTemplateForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    importLsrTemplate,
    null
  );
  return (
    <form action={action}>
      <textarea
        name="rows"
        rows={6}
        required
        placeholder={
          "Tempel isi Template Baku (tanpa/dengan header):\n" +
          "Nama Merchant ; Week ; Total GMV ; Jam Tayang ; Total View ; Total Like ; Total Komen ; Total Share"
        }
        style={{ width: "100%", fontFamily: "monospace" }}
      />
      <div className="inline-form" style={{ marginTop: 8 }}>
        <input
          name="source_file_ref"
          placeholder="Referensi file sumber (wajib, arsip audit)"
          required
          style={{ width: 300 }}
        />
        <button className="sm" disabled={pending}>
          {pending ? "…" : "Import Template Baku"}
        </button>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function ManualLsrForm({ briefId }: { briefId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addLsrManual,
    null
  );
  return (
    <form action={action} className="inline-form" style={{ flexWrap: "wrap" }}>
      <input type="hidden" name="brief_id" value={briefId} />
      <input name="week_number" type="number" min={1} placeholder="Minggu" required style={{ width: 80 }} />
      <input name="gmv" type="number" min={0} step="any" placeholder="GMV" style={{ width: 120 }} />
      <input name="jam_tayang" type="number" min={0} step="0.1" placeholder="Jam tayang" style={{ width: 110 }} />
      <input name="total_view" type="number" min={0} placeholder="View" style={{ width: 100 }} />
      <input name="total_like" type="number" min={0} placeholder="Like" style={{ width: 100 }} />
      <input name="total_komen" type="number" min={0} placeholder="Komen" style={{ width: 100 }} />
      <input name="total_share" type="number" min={0} placeholder="Share" style={{ width: 100 }} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Simpan minggu (manual)"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function ResolveUnmatchedForm({
  lsrId,
  briefs,
}: {
  lsrId: string;
  briefs: { id: string; code: string | null; merchantName: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    resolveUnmatched,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={lsrId} />
      <select name="brief_id" required defaultValue="">
        <option value="" disabled>
          Petakan ke Brief…
        </option>
        {briefs.map((b) => (
          <option key={b.id} value={b.id}>
            {b.code} · {b.merchantName}
          </option>
        ))}
      </select>
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Resolve"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function GmvAuthForm({
  merchants,
}: {
  merchants: { id: string; code: string | null; nama_toko: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    upsertGmvAuthoritative,
    null
  );
  return (
    <form action={action} className="inline-form" style={{ flexWrap: "wrap" }}>
      <select name="merchant_id" required defaultValue="">
        <option value="" disabled>
          Pilih merchant…
        </option>
        {merchants.map((m) => (
          <option key={m.id} value={m.id}>
            {m.code} · {m.nama_toko}
          </option>
        ))}
      </select>
      <input name="period" type="month" required />
      <input
        name="gmv_value"
        type="number"
        min={0}
        step="any"
        placeholder="GMV bulan tsb"
        required
        style={{ width: 150 }}
      />
      <select name="confidence" required defaultValue="">
        <option value="" disabled>
          Confidence…
        </option>
        <option>[GMV Terverifikasi]</option>
        <option>[GMV Estimasi]</option>
      </select>
      <input name="source_note" placeholder="Sumber data (opsional)" style={{ width: 200 }} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Simpan GMV otoritatif"}
      </button>
      <Msg state={state} />
    </form>
  );
}
