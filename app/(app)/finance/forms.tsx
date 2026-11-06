"use client";

import { useState } from "react";
import { useActionState } from "react";
import {
  verifyPayment,
  setContractUrl,
  setTransactionFlag,
  setPayoutStatus,
  type ActionResult,
} from "@/lib/actions/finance";
import { setCampaignPayoutStatus, type ActionResult as CampaignPayoutActionResult } from "@/lib/actions/campaign-payouts";
import { rupiah } from "@/lib/format";

export function VerifyForm({
  transactionId,
  outstanding,
  needsContract,
}: {
  transactionId: string;
  outstanding: number;
  // true = belum ada link kontrak tersimpan → kolom link tampil; wajib bila
  // ini verifikasi pertama (dijaga juga di RPC verify_payment, 0378).
  needsContract?: { required: boolean };
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    verifyPayment,
    null
  );
  const [mode, setMode] = useState<"penuh" | "sebagian">("penuh");

  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="transaction_id" value={transactionId} />
      <div className="verify-mode-row" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <label style={{ display: "flex", gap: 4, alignItems: "center", fontWeight: "normal" }}>
          <input
            type="radio"
            checked={mode === "penuh"}
            onChange={() => setMode("penuh")}
          />
          Bayar Penuh
        </label>
        <label style={{ display: "flex", gap: 4, alignItems: "center", fontWeight: "normal" }}>
          <input
            type="radio"
            checked={mode === "sebagian"}
            onChange={() => setMode("sebagian")}
          />
          Bayar Sebagian
        </label>
      </div>
      {mode === "penuh" ? (
        <>
          <input type="hidden" name="amount" value={outstanding} />
          <span className="muted">{rupiah(outstanding)}</span>
        </>
      ) : (
        <input
          name="amount"
          type="number"
          min={1}
          max={outstanding}
          step="1"
          placeholder="Jumlah diterima"
          required
          style={{ width: 140 }}
        />
      )}
      <input name="proof" placeholder="No. bukti (opsional)" style={{ width: 140 }} />
      {needsContract && (
        <input
          name="contract_url"
          type="url"
          pattern="https?://.+"
          placeholder={`Link kontrak SPK/MoU${needsContract.required ? " (wajib)" : ""}`}
          required={needsContract.required}
          style={{ width: 200 }}
        />
      )}
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Verifikasi"}
      </button>
      {state && (
        <span className={state.ok ? "badge green" : "badge red"} title={state.message}>
          {state.ok ? "ok" : state.message}
        </span>
      )}
    </form>
  );
}

// Link kontrak SPK/MoU tersimpan (bisa diklik) + ganti oleh Finance (0378).
export function ContractLink({ url }: { url: string | null }) {
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      lihat kontrak
    </a>
  ) : (
    <span className="muted">—</span>
  );
}

export function ContractUrlForm({ transactionId }: { transactionId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setContractUrl,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="transaction_id" value={transactionId} />
      <input
        name="contract_url"
        type="url"
        pattern="https?://.+"
        placeholder="Ganti link kontrak"
        required
        style={{ width: 160 }}
      />
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && (
        <span className={state.ok ? "badge green" : "badge red"} title={state.message}>
          {state.ok ? "ok" : state.message}
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
