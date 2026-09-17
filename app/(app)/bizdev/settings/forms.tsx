"use client";

import { useActionState, useEffect, useState } from "react";
import {
  updatePoiSlaSetting,
  setPoiSopStepActive,
  addPoiSopStep,
  type ActionResult,
} from "@/lib/actions/poi-settings";

export type SlaRow = {
  id: string;
  flow: string;
  step_no: number;
  task: string;
  sla_days: number | null;
  sla_label: string | null;
  is_optional: boolean;
  active: boolean;
};

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ marginTop: 4 }}>
      {state.message}
    </div>
  );
}

// SlaRowForm — satu baris step: tampilan ringkas + "Edit" (task/SLA/opsional)
// dan "Hapus"/"Aktifkan" (soft delete, lihat setPoiSopStepActive).
function SlaRowForm({ row, isBerbayarFlow }: { row: SlaRow; isBerbayarFlow: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updatePoiSlaSetting, null);
  const [toggleState, toggleAction, togglePending] = useActionState<ActionResult | null, FormData>(
    setPoiSopStepActive,
    null
  );
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <tr className={row.active ? undefined : "muted"}>
      <td className="mono">{row.step_no}</td>
      <td>
        {row.task}
        {row.is_optional && (
          <span className="badge gray" style={{ marginLeft: 6 }}>
            Opsional
          </span>
        )}
        {!row.active && (
          <span className="badge slate" style={{ marginLeft: 6 }}>
            Nonaktif
          </span>
        )}
      </td>
      <td className="muted">{row.sla_days != null ? `${row.sla_days} hari` : row.sla_label ?? "—"}</td>
      <td className="right">
        {open ? (
          <form action={action} className="inline-form" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
            <input type="hidden" name="id" value={row.id} />
            <input type="text" name="task" defaultValue={row.task} placeholder="task" style={{ width: 260 }} required />
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
            {isBerbayarFlow && (
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                <input type="checkbox" name="is_optional" defaultChecked={row.is_optional} />
                Opsional (boleh di-skip)
              </label>
            )}
            <button type="submit" className="sm" disabled={pending}>
              {pending ? "…" : "Simpan"}
            </button>
            <button type="button" className="sm ghost2" onClick={() => setOpen(false)} disabled={pending}>
              Batal
            </button>
          </form>
        ) : (
          <div className="actions-row" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="sm ghost2" onClick={() => setOpen(true)}>
              Edit
            </button>
            <form action={toggleAction}>
              <input type="hidden" name="id" value={row.id} />
              <input type="hidden" name="active" value={row.active ? "false" : "true"} />
              <button
                type="submit"
                className="sm ghost2"
                disabled={togglePending}
                onClick={(e) => {
                  if (row.active && !confirm(`Hapus (nonaktifkan) step "${row.task}"? Riwayat yang sudah ada tetap tersimpan.`)) {
                    e.preventDefault();
                  }
                }}
              >
                {togglePending ? "…" : row.active ? "Hapus" : "Aktifkan"}
              </button>
            </form>
          </div>
        )}
        {state && !state.ok && <Msg state={state} />}
        {toggleState && !toggleState.ok && <Msg state={toggleState} />}
      </td>
    </tr>
  );
}

// AddStepForm — tambah step baru ke akhir urutan flow (lihat addPoiSopStep).
function AddStepForm({ flow, isBerbayarFlow }: { flow: string; isBerbayarFlow: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addPoiSopStep, null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <div style={{ marginTop: 10 }}>
        <button type="button" className="sm ghost2" onClick={() => setOpen(true)}>
          + Tambah Step
        </button>
        {state && !state.ok && <Msg state={state} />}
      </div>
    );
  }

  return (
    <form action={action} className="inline-form" style={{ marginTop: 10, flexWrap: "wrap" }}>
      <input type="hidden" name="flow" value={flow} />
      <input type="text" name="task" placeholder="Task step baru" style={{ width: 320 }} required />
      <input type="number" name="sla_days" min="0" step="1" placeholder="SLA (hari)" style={{ width: 100 }} />
      <input type="text" name="sla_label" placeholder="label SLA (opsional)" style={{ width: 180 }} />
      {isBerbayarFlow && (
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          <input type="checkbox" name="is_optional" />
          Opsional (boleh di-skip)
        </label>
      )}
      <button type="submit" className="sm" disabled={pending}>
        {pending ? "Menyimpan…" : "Tambah"}
      </button>
      <button type="button" className="sm ghost2" onClick={() => setOpen(false)} disabled={pending}>
        Batal
      </button>
      {state && !state.ok && <Msg state={state} />}
    </form>
  );
}

export function SlaSettingsTable({ flow, title, rows }: { flow: string; title: string; rows: SlaRow[] }) {
  const isBerbayarFlow = flow === "poi_dining_berbayar";
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
              <SlaRowForm key={r.id} row={r} isBerbayarFlow={isBerbayarFlow} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Belum ada data step.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AddStepForm flow={flow} isBerbayarFlow={isBerbayarFlow} />
    </div>
  );
}
