"use client";

import { useActionState } from "react";
import { setBriefStatus, type ActionResult } from "@/lib/actions/account";
import { createAdCampaign, setAdcStatus, createWpe } from "@/lib/actions/ads";

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

export function CreateAdcForm({ briefId }: { briefId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createAdCampaign,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="brief_id" value={briefId} />
      <select name="platform" required defaultValue="">
        <option value="" disabled>
          Platform…
        </option>
        <option>TikTok Ads</option>
        <option>Shopee Ads</option>
        <option>Meta Ads</option>
        <option>Google Ads</option>
        <option>Other</option>
      </select>
      <select name="objective" required defaultValue="">
        <option value="" disabled>
          Objective…
        </option>
        <option>Traffic</option>
        <option>Conversion</option>
        <option>Awareness</option>
        <option>Engagement</option>
      </select>
      <select name="currency" defaultValue="IDR">
        <option>IDR</option>
        <option>USD</option>
      </select>
      <input
        name="budget_allocated"
        type="number"
        min={0}
        step="any"
        placeholder="Budget (boleh nanti)"
        style={{ width: 150 }}
      />
      <input name="creative_ref" placeholder="Link creative (opsional)" style={{ width: 190 }} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "+ Campaign Record"}
      </button>
      <Msg state={state} />
    </form>
  );
}

// Satu form per aksi + hidden input (submitter name/value tidak terkirim — BUILD_PLAN).
export function AdcStatusForm({
  adcId,
  toStatus,
  label,
  notesField,
  notesPlaceholder,
  withBudget,
  danger,
}: {
  adcId: string;
  toStatus: string;
  label: string;
  notesField?: "revision_notes" | "pause_reason" | "cancellation_reason";
  notesPlaceholder?: string;
  withBudget?: boolean;
  danger?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setAdcStatus,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={adcId} />
      <input type="hidden" name="to_status" value={toStatus} />
      {withBudget && (
        <input
          name="budget_allocated"
          type="number"
          min={0}
          step="any"
          placeholder="Budget final (kosong = pakai yang ada)"
          style={{ width: 220 }}
        />
      )}
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

export function CreateWpeForm({
  adcId,
  nextWeek,
  finalReport,
}: {
  adcId: string;
  nextWeek: number;
  finalReport?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createWpe, null);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="campaign_record_id" value={adcId} />
      <input
        type="hidden"
        name="entry_type"
        value={finalReport ? "[Final Report]" : "[Weekly]"}
      />
      <input
        name="week_number"
        type="number"
        min={1}
        defaultValue={nextWeek}
        required
        title="Minggu ke-"
        style={{ width: 70 }}
      />
      <input name="spend" type="number" min={0} step="any" placeholder="Spend" required style={{ width: 110 }} />
      <input
        name="impressions"
        type="number"
        min={0}
        placeholder="Impressions"
        required
        style={{ width: 110 }}
      />
      <input name="clicks" type="number" min={0} placeholder="Clicks" required style={{ width: 90 }} />
      <input
        name="conversions"
        type="number"
        min={0}
        step="any"
        placeholder="Conversions"
        style={{ width: 110 }}
      />
      <input
        name="gmv_generated"
        type="number"
        min={0}
        step="any"
        placeholder="GMV"
        style={{ width: 110 }}
      />
      <input
        name="notes"
        placeholder={finalReport ? "Summary + rekomendasi (wajib)" : "Catatan (opsional)"}
        required={finalReport}
        style={{ width: 220 }}
      />
      <button className={`sm ${finalReport ? "warnbtn" : ""}`} disabled={pending}>
        {pending ? "…" : finalReport ? "Submit Final Report" : "+ WPE Mingguan"}
      </button>
      <Msg state={state} />
    </form>
  );
}
