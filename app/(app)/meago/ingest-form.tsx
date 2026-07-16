"use client";

// IngestForm — dipakai bersama oleh /meago/workspace dan /meago/creators (card "Upload Data
// Mingguan"). Jangan duplikasi: kedua halaman import dari sini (workspace/forms.tsx
// re-export komponen ini supaya import lama tetap jalan).

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
      <button type="submit" disabled={pending}>
        {pending ? "Memproses…" : "Upload & Proses"}
      </button>
    </form>
  );
}
