"use client";

import { useActionState } from "react";
import {
  verifyPayment,
  setTransactionFlag,
  setPayoutStatus,
  type ActionResult,
} from "@/lib/actions/finance";
import { setCampaignPayoutStatus, type ActionResult as CampaignPayoutActionResult } from "@/lib/actions/campaign-payouts";

export function VerifyForm({
  transactionId,
  outstanding,
}: {
  transactionId: string;
  outstanding: number;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    verifyPayment,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="transaction_id" value={transactionId} />
      <input
        name="amount"
        type="number"
        min={1}
        max={outstanding}
        step="1000"
        placeholder="Jumlah diterima"
        required
        style={{ width: 140 }}
      />
      <input name="proof" placeholder="No. bukti (opsional)" style={{ width: 140 }} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Verifikasi"}
      </button>
      {state && (
        <span className={state.ok ? "badge green" : "badge red"} title={state.message}>
          {state.ok ? "ok" : "gagal"}
        </span>
      )}
    </form>
  );
}

// Disbursement PYO: transfer manual (bukti wajib) atau batalkan (lead/director, alasan wajib).
export function PayoutTransferForm({ payoutId }: { payoutId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setPayoutStatus,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={payoutId} />
      <input type="hidden" name="to_status" value="[Ditransfer]" />
      <input
        name="transfer_proof"
        placeholder="No./link bukti transfer (wajib)"
        required
        style={{ width: 200 }}
      />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Tandai Ditransfer"}
      </button>
      {state && (
        <span className={state.ok ? "badge green" : "badge red"} title={state.message}>
          {state.ok ? "ok" : state.message}
        </span>
      )}
    </form>
  );
}

export function PayoutCancelForm({ payoutId }: { payoutId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setPayoutStatus,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={payoutId} />
      <input type="hidden" name="to_status" value="[Dibatalkan]" />
      <input
        name="cancellation_reason"
        placeholder="Alasan pembatalan (wajib)"
        required
        style={{ width: 180 }}
      />
      <button className="sm dangerbtn" disabled={pending}>
        {pending ? "…" : "Batalkan"}
      </button>
      {state && (
        <span className={state.ok ? "badge green" : "badge red"} title={state.message}>
          {state.ok ? "ok" : state.message}
        </span>
      )}
    </form>
  );
}

// Disbursement payout campaign MEA GO (Fase G.4) — cermin PayoutTransferForm/
// PayoutCancelForm di atas, tapi memanggil setCampaignPayoutStatus (tabel
// campaign_payouts, TERPISAH dari creator_payouts M5/M9).
export function CampaignPayoutTransferForm({ payoutId }: { payoutId: string }) {
  const [state, action, pending] = useActionState<CampaignPayoutActionResult | null, FormData>(
    setCampaignPayoutStatus,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={payoutId} />
      <input type="hidden" name="to_status" value="[Ditransfer]" />
      <input
        name="transfer_proof"
        placeholder="No./link bukti transfer (wajib)"
        required
        style={{ width: 200 }}
      />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Tandai Ditransfer"}
      </button>
      {state && (
        <span className={state.ok ? "badge green" : "badge red"} title={state.message}>
          {state.ok ? "ok" : state.message}
        </span>
      )}
    </form>
  );
}

export function CampaignPayoutCancelForm({ payoutId }: { payoutId: string }) {
  const [state, action, pending] = useActionState<CampaignPayoutActionResult | null, FormData>(
    setCampaignPayoutStatus,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={payoutId} />
      <input type="hidden" name="to_status" value="[Dibatalkan]" />
      <input
        name="cancellation_reason"
        placeholder="Alasan pembatalan (wajib)"
        required
        style={{ width: 180 }}
      />
      <button className="sm dangerbtn" disabled={pending}>
        {pending ? "…" : "Batalkan"}
      </button>
      {state && (
        <span className={state.ok ? "badge green" : "badge red"} title={state.message}>
          {state.ok ? "ok" : state.message}
        </span>
      )}
    </form>
  );
}

export function FlagButton({
  transactionId,
  field,
  current,
  label,
}: {
  transactionId: string;
  field: "flag_jatuh_tempo" | "flag_bermasalah";
  current: boolean;
  label: string;
}) {
  const [, action, pending] = useActionState<ActionResult | null, FormData>(
    setTransactionFlag,
    null
  );
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="transaction_id" value={transactionId} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={current ? "false" : "true"} />
      <button
        className={`sm ${current ? (field === "flag_bermasalah" ? "dangerbtn" : "warnbtn") : "ghost2"}`}
        disabled={pending}
      >
        {current ? `✓ ${label}` : label}
      </button>
    </form>
  );
}
