"use client";

// VideoGmvForm — card "Upload GMV Video Mingguan" di /meago/gmv-video. Pola sama dengan
// IngestForm (../ingest-form.tsx): useActionState + pesan ok/err apa adanya dari server
// action, termasuk ringkasan unmatched/auto-created supaya tidak ada yang senyap.

import { useActionState } from "react";
import { runVideoGmvIngest, type ActionResult } from "@/lib/actions/video-ingest";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

export function VideoGmvForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    runVideoGmvIngest,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <label>File GMV Video (CSV/XLSX) *</label>
      <input type="file" name="file" accept=".csv,.xlsx,.xls" required />
      <label>
        <input type="checkbox" name="force_reprocess" value="1" /> Proses ulang jika file
        duplikat (timpa data periode yang sama)
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Memproses…" : "Upload & Proses"}
      </button>
    </form>
  );
}
