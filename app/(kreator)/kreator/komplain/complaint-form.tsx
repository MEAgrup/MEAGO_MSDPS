"use client";

import { useActionState } from "react";
import { createComplaint, type ActionResult } from "@/lib/actions/portal";

export function ComplaintForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createComplaint,
    null
  );

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 460 }}>
      {state && <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>}

      <label>
        Subjek (opsional)
        <input name="subject" placeholder="mis. Kendala jadwal live" />
      </label>

      <label>
        Isi komplain / feedback
        <textarea name="body" rows={4} placeholder="Jelaskan komplain atau feedback kamu…" />
      </label>

      <button type="submit" disabled={pending} style={{ alignSelf: "flex-start" }}>
        {pending ? "Mengirim…" : "Kirim Komplain"}
      </button>
    </form>
  );
}
