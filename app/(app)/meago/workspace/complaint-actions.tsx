"use client";

import { useActionState } from "react";
import { progressComplaint, type ActionResult } from "@/lib/actions/complaints";

function ProgressButton({ id, to, label }: { id: string; to: string; label: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    progressComplaint,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="complaint_id" value={id} />
      <input type="hidden" name="next_status" value={to} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : label}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

// ComplaintProgressControls — 'baru' → "Proses" (jadi diproses), 'diproses' →
// "Selesaikan" (jadi selesai). 'selesai' = tanpa aksi lagi.
export function ComplaintProgressControls({ id, status }: { id: string; status: string }) {
  if (status === "baru") return <ProgressButton id={id} to="diproses" label="Proses" />;
  if (status === "diproses") return <ProgressButton id={id} to="selesai" label="Selesaikan" />;
  return <span className="muted">selesai</span>;
}
