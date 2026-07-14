"use client";

import { useActionState } from "react";
import { generateSkorMingguIni, type ActionResult } from "@/lib/actions/blocks";

export function GenerateSkorButton() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    generateSkorMingguIni,
    null
  );
  return (
    <form action={action} style={{ display: "inline" }}>
      <button className="sm" disabled={pending}>
        {pending ? "Menghitung…" : "Hitung snapshot minggu ini"}
      </button>
      {state && <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>}
    </form>
  );
}
