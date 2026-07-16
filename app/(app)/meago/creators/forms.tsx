"use client";

import { useActionState } from "react";
import {
  assignOwner,
  setAdsBudgetCap,
  toggleRoster,
  type ActionResult,
} from "@/lib/actions/mcn-creators";

type CmOption = { id: string; full_name: string; rank: string };

// AssignOwnerRow — satu form per baris kreator di card "Assign CM / CPM". Select
// preselect ke owner sekarang; opsi pertama "— tanpa CM —" (value kosong) utk melepas
// assign. cmOptions dioper dari server page (employees divisi CreatorManagement, active).
export function AssignOwnerRow({
  creatorId,
  currentOwnerId,
  cmOptions,
}: {
  creatorId: string;
  currentOwnerId: string | null;
  cmOptions: CmOption[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    assignOwner,
    null
  );
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <select name="owner_cpm_id" defaultValue={currentOwnerId ?? ""}>
        <option value="">— tanpa CM —</option>
        {cmOptions.map((e) => (
          <option key={e.id} value={e.id}>
            {e.full_name}
            {e.rank === "lead" ? " (Lead)" : ""}
          </option>
        ))}
      </select>
      <button className="sm" type="submit" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && (
        <span className={state.ok ? "ok-msg" : "err"} style={{ fontSize: 11 }}>
          {state.message}
        </span>
      )}
    </form>
  );
}

// BudgetCapRow — form set ads_budget_cap per kreator. Input dikosongkan → hapus cap
// (action sudah menangani "" → null); validasi angka dilakukan di server via parseRupiah.
export function BudgetCapRow({
  creatorId,
  currentCap,
}: {
  creatorId: string;
  currentCap: number | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setAdsBudgetCap,
    null
  );
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <input
        name="ads_budget_cap"
        defaultValue={currentCap !== null ? String(currentCap) : ""}
        inputMode="numeric"
        placeholder="mis. 1.500.000"
        style={{ width: 130 }}
      />
      <button className="sm" type="submit" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && (
        <span className={state.ok ? "ok-msg" : "err"} style={{ fontSize: 11 }}>
          {state.message}
        </span>
      )}
    </form>
  );
}

// RosterToggleRow — form toggleRoster per kreator. Hidden `live_roster` mengirim nilai
// TUJUAN (bukan nilai sekarang) — action membaca `=== "true"`.
export function RosterToggleRow({
  creatorId,
  inRoster,
}: {
  creatorId: string;
  inRoster: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    toggleRoster,
    null
  );
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <input type="hidden" name="live_roster" value={inRoster ? "false" : "true"} />
      <button className="sm" type="submit" disabled={pending}>
        {pending ? "…" : inRoster ? "Keluarkan dari roster" : "Masukkan ke roster"}
      </button>
      {state && (
        <span className={state.ok ? "ok-msg" : "err"} style={{ fontSize: 11 }}>
          {state.message}
        </span>
      )}
    </form>
  );
}
