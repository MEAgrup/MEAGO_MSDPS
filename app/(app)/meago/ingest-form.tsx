"use client";

// IngestForm — card "Upload Creator Analysis Mingguan", kini hanya di /meago/gmv-video
// (dipindah dari CM Workspace & Data Kreator, 2026-11-06). Jangan duplikasi ke halaman lain.

import { useActionState } from "react";
import { runIngest, type ActionResult } from "@/lib/actions/mcn-ingest";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

export function IngestForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    runIngest,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <label>File Performa (CSV/XLSX) *</label>
      <input type="file" name="file" accept=".csv,.xlsx,.xls" required />
      <input type="hidden" name="source_type" value="tiktok" />
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
