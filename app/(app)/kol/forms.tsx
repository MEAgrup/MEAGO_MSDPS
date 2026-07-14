"use client";

import { useActionState } from "react";
import { setBriefStatus, type ActionResult } from "@/lib/actions/account";
import {
  createCreator,
  updateCreatorPayment,
  createBooking,
  setBookingStatus,
  setBookingGmv,
  createPayout,
} from "@/lib/actions/kol";

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

const PLATFORMS = ["TikTok", "Instagram", "YouTube", "Shopee", "Other"];

export function CreateCreatorForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createCreator,
    null
  );
  return (
    <form action={action} className="inline-form" style={{ flexWrap: "wrap" }}>
      <input name="name_handle" placeholder="Nama / handle (wajib)" required style={{ width: 180 }} />
      <span className="checks" style={{ display: "inline-flex", gap: 8 }}>
        {PLATFORMS.map((p) => (
          <label key={p}>
            <input type="checkbox" name="platforms" value={p} /> {p}
          </label>
        ))}
      </span>
      <input name="niche" placeholder="Niche (wajib)" required style={{ width: 130 }} />
      <select name="source_pool" required defaultValue="">
        <option value="" disabled>
          Source Pool…
        </option>
        <option>MCN MEA Roster</option>
        <option>KOL External Pool</option>
        <option>Ad-hoc New</option>
      </select>
      <input name="roster_ref" placeholder="Roster Ref (wajib jika Roster)" style={{ width: 170 }} />
      <input
        name="payment_details"
        placeholder="Payment details (wajib sebelum Booked)"
        style={{ width: 230 }}
      />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "+ Creator Master"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function UpdatePaymentForm({ creatorId }: { creatorId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateCreatorPayment,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={creatorId} />
      <input
        name="payment_details"
        placeholder="Bank/e-wallet + no. rekening"
        required
        style={{ width: 200 }}
      />
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : "Simpan payment"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function CreateBookingForm({
  briefId,
  deliverableType,
  creators,
}: {
  briefId: string;
  deliverableType: "Video" | "Live Session";
  creators: { id: string; code: string | null; name_handle: string }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createBooking,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="brief_id" value={briefId} />
      <input type="hidden" name="deliverable_type" value={deliverableType} />
      <select name="creator_id" required defaultValue="">
        <option value="" disabled>
          Pilih creator…
        </option>
        {creators.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} · {c.name_handle}
          </option>
        ))}
      </select>
      <input
        name="agreed_rate"
        type="number"
        min={1}
        step="any"
        placeholder={deliverableType === "Video" ? "Rate per video" : "Rate basis 5 jam"}
        required
        style={{ width: 150 }}
      />
      <input name="due_date" type="date" required />
      <button className="sm" disabled={pending}>
        {pending ? "…" : `+ Booking ${deliverableType === "Video" ? "Video" : "Live"}`}
      </button>
      <Msg state={state} />
    </form>
  );
}

// Satu form per aksi + hidden input (submitter name/value tidak terkirim — BUILD_PLAN).
export function BookingStatusForm({
  bookingId,
  toStatus,
  label,
  withProof,
  withHours,
  notesField,
  danger,
}: {
  bookingId: string;
  toStatus: string;
  label: string;
  withProof?: boolean;
  withHours?: boolean;
  notesField?: "cancellation_reason";
  danger?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setBookingStatus,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={bookingId} />
      <input type="hidden" name="to_status" value={toStatus} />
      {withProof && (
        <input
          name="delivery_proof"
          placeholder="Link/bukti tayang (wajib)"
          required
          style={{ width: 200 }}
        />
      )}
      {withHours && (
        <input
          name="hours_logged"
          type="number"
          min={0.1}
          step="0.1"
          placeholder="Jam live (wajib)"
          required
          style={{ width: 130 }}
        />
      )}
      {notesField && (
        <input name={notesField} placeholder="Alasan (wajib)" required style={{ width: 180 }} />
      )}
      <button className={`sm ${danger ? "dangerbtn" : ""}`} disabled={pending}>
        {pending ? "…" : label}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function BookingGmvForm({
  bookingId,
  current,
}: {
  bookingId: string;
  current: number | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setBookingGmv,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={bookingId} />
      <input
        name="gmv_generated"
        type="number"
        min={0}
        step="any"
        defaultValue={current ?? undefined}
        placeholder="GMV deliverable"
        required
        style={{ width: 140 }}
      />
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : "Simpan GMV"}
      </button>
      <Msg state={state} />
    </form>
  );
}

export function CreatePayoutForm({
  creatorId,
  payoutType,
}: {
  creatorId: string;
  payoutType: "PYO-Video" | "PYO-Live";
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createPayout,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="creator_id" value={creatorId} />
      <input type="hidden" name="payout_type" value={payoutType} />
      <input
        name="amount"
        type="number"
        min={1}
        step="any"
        placeholder="Nominal payout (wajib)"
        required
        style={{ width: 170 }}
      />
      <button className="sm warnbtn" disabled={pending}>
        {pending ? "…" : `Payment Request ${payoutType === "PYO-Video" ? "(10 video)" : "(5 jam)"}`}
      </button>
      <Msg state={state} />
    </form>
  );
}
