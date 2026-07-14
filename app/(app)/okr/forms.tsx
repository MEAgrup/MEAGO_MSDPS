"use client";

import { useActionState } from "react";
import { setOkrTarget, clearOkrTarget, type ActionResult } from "@/lib/actions/okr";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

// Form set/ubah target satu metrik. Satu <form>/aksi + hidden input (React 19).
export function SetTargetForm({
  period,
  role,
  metric,
  comparator,
  current,
  unit,
}: {
  period: string;
  role: string;
  metric: string;
  comparator: "gte" | "lte";
  current: number | null;
  unit: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setOkrTarget,
    null
  );
  return (
    <form action={action} className="inline-form" style={{ flexWrap: "wrap", gap: 6 }}>
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="metric" value={metric} />
      <input type="hidden" name="comparator" value={comparator} />
      <span style={{ color: "#94a3b8" }}>{comparator === "lte" ? "≤" : "≥"}</span>
      <input
        name="target_value"
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        defaultValue={current ?? undefined}
        placeholder="target"
        required
        style={{ width: 90 }}
      />
      <span style={{ color: "#94a3b8" }}>{unit}</span>
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      <Msg state={state} />
    </form>
  );
}

// Nonaktifkan target aktif (kembali ke default engine).
export function ClearTargetButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    clearOkrTarget,
    null
  );
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <button className="sm btn-ghost" disabled={pending} title="Kembalikan ke default engine">
        {pending ? "…" : "Reset default"}
      </button>
      <Msg state={state} />
    </form>
  );
}
