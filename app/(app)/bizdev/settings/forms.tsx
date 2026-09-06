"use client";

import { useActionState, useEffect, useState } from "react";
import { updatePoiSlaSetting, type ActionResult } from "@/lib/actions/poi-settings";

export type SlaRow = {
  id: string;
  flow: string;
  step_no: number;
  task: string;
  sla_days: number | null;
  sla_label: string | null;
};

function SlaRowForm({ row }: { row: SlaRow }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updatePoiSlaSetting, null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <tr>
      <td className="mono">{row.step_no}</td>
      <td>{row.task}</td>
      <td className="muted">{row.sla_days != null ? `${row.sla_days} hari` : row.sla_label ?? "—"}</td>
      <td className="right">
        {open ? (
          <form action={action} className="inline-form" style={{ justifyContent: "flex-end" }}>
            <input type="hidden" name="id" value={row.id} />
            <input
              type="number"
              name="sla_days"
              min="0"
              step="1"
              defaultValue={row.sla_days ?? ""}
              placeholder="hari"
              style={{ width: 90 }}
            />
            <input type="text" name="sla_label" defaultValue={row.sla_label ?? ""} placeholder="label (opsional)" style={{ width: 160 }} />
            <button type="submit" className="sm" disabled={pending}>
              {pending ? "…" : "Simpan"}
            </button>
            <button type="button" className="sm ghost2" onClick={() => setOpen(false)} disabled={pending}>
              Batal
            </button>
          </form>
        ) : (
          <button type="button" className="sm ghost2" onClick={() => setOpen(true)}>
            Atur SLA
          </button>
        )}
        {state && !state.ok && (
          <div className="err" style={{ marginTop: 4 }}>
            {state.message}
          </div>
        )}
      </td>
    </tr>
  );
}

export function SlaSettingsTable({ title, rows }: { title: string; rows: SlaRow[] }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Step</th>
              <th>Task</th>
              <th>SLA Saat Ini</th>
              <th className="right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SlaRowForm key={r.id} row={r} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Belum ada data SLA.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
