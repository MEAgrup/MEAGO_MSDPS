"use client";

import { useActionState } from "react";
import { addCreator, assignOwner, type ActionResult } from "@/lib/actions/mcn-creators";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function AddCreatorForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addCreator,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Nama Kreator *</label>
          <input name="name" required />
        </div>
        <div>
          <label>Username</label>
          <input name="username" placeholder="username TikTok (opsional)" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Industry</label>
          <select name="niche" defaultValue="">
            <option value="">— pilih —</option>
            <option value="Dining">Dining</option>
            <option value="Accommodation">Accommodation</option>
            <option value="Things to Do">Things to Do</option>
          </select>
        </div>
      </div>
      <label>Catatan</label>
      <textarea name="notes" rows={2} />
      <input type="hidden" name="platform" value="tiktok" />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Daftarkan Prospek"}
      </button>
    </form>
  );
}

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
