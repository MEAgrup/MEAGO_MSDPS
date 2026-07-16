"use client";

import { useActionState } from "react";
import { addCreator, type ActionResult } from "@/lib/actions/mcn-creators";

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
