"use client";

import { useActionState, useState } from "react";
import { rupiah, tanggal } from "@/lib/format";
import {
  updatePoiDiningCycleProgress,
  completePoiDiningStep,
  skipPoiDiningStep,
  type ActionResult,
} from "@/lib/actions/poi-dining";
import {
  POI_DINING_BERBAYAR_STEPS,
  POI_DINING_BERBAYAR_TOTAL_STEPS,
  DINING_BERBAYAR_OPTIONAL_STEPS_END,
  REPORT_STATUS_OPTIONS,
  toJakartaDatetimeLocalInput,
  formatJakartaDatetime,
  formatStepSla,
  formatSlaDuration,
  diningBerbayarStatus,
  stepCompletedAt,
  type DiningStepRow,
  type PoiSopStepDef,
} from "@/lib/mcn/poi-sop";
import { POI_NOTES_HINT } from "../poi/poi-card";

export type DiningBerbayarCycle = {
  deal_id: string;
  code: string | null;
  brand_name: string;
  pic_name: string | null;
  bd_name: string;
  ops_name: string | null;
  cycle_id: string;
  cycle_no: number;
  period_start: string;
  period_end: string;
  ops_datetime: string | null;
  actual_vt: number | null;
  total_gmv: number | null;
  report_link: string | null;
  report_status: string | null;
  notes: string | null;
  steps: DiningStepRow[];
};

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

// StepItem — step 1-5 (opsional/tak berurutan): tombol "Tandai Selesai" selalu
// aktif selama belum resolved, plus "Lewati" khusus Director. Step 6-22
// (berurutan): "Tandai Selesai" hanya aktif utk step yang sedang berjalan.
function StepItem({
  cycleId,
  step,
  completedAt,
  skippedAt,
  isOptional,
  isCurrent,
  canApproveSkip,
}: {
  cycleId: string;
  step: PoiSopStepDef;
  completedAt: string | null;
  skippedAt: string | null;
  isOptional: boolean;
  isCurrent: boolean;
  canApproveSkip: boolean;
}) {
  const [completeState, completeAction, completePending] = useActionState<ActionResult | null, FormData>(
    completePoiDiningStep,
    null
  );
  const [skipState, skipAction, skipPending] = useActionState<ActionResult | null, FormData>(skipPoiDiningStep, null);
  const done = !!completedAt;
  const skipped = !!skippedAt;
  const resolved = done || skipped;

  return (
    <li className={`poi-step${resolved ? " done" : ""}`}>
      <div className="poi-step-body">
        <div className="poi-step-title">
          Step {step.step} · {step.task}
          {isOptional && !resolved && (
            <span className="badge gray" style={{ marginLeft: 6 }}>
              Opsional
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          SLA {formatStepSla(step)}
          {done && <> · selesai {formatJakartaDatetime(new Date(completedAt))}</>}
          {skipped && <> · dilewati {formatJakartaDatetime(new Date(skippedAt))} (approval Director)</>}
        </div>
        {completeState && !completeState.ok && <div className="err" style={{ marginTop: 6 }}>{completeState.message}</div>}
        {skipState && !skipState.ok && <div className="err" style={{ marginTop: 6 }}>{skipState.message}</div>}
      </div>
      {resolved ? (
        <span className={`badge ${done ? "green" : "slate"}`}>{done ? "Selesai" : "Dilewati"}</span>
      ) : (
        <div className="actions-row">
          <form action={completeAction}>
            <input type="hidden" name="cycle_id" value={cycleId} />
            <input type="hidden" name="step_no" value={step.step} />
            <button type="submit" className="sm" disabled={(!isOptional && !isCurrent) || completePending}>
              {completePending ? "…" : "Tandai Selesai"}
            </button>
          </form>
          {isOptional && (
            <form action={skipAction} title={canApproveSkip ? undefined : "Hanya Director yang dapat melewati step ini"}>
              <input type="hidden" name="cycle_id" value={cycleId} />
              <input type="hidden" name="step_no" value={step.step} />
              <button type="submit" className="sm ghost2" disabled={!canApproveSkip || skipPending}>
                {skipPending ? "…" : "Lewati (Director)"}
              </button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

export function DiningBerbayarCard({
  cycle,
  opsNames,
  canApproveSkip,
  stepDefs = POI_DINING_BERBAYAR_STEPS,
}: {
  cycle: DiningBerbayarCycle;
  opsNames: readonly string[];
  canApproveSkip: boolean;
  stepDefs?: PoiSopStepDef[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updatePoiDiningCycleProgress, null);

  const now = new Date();
  const { optionalResolvedCount, optionalDone, lastCompletedSequentialStep, currentStep, allDone } =
    diningBerbayarStatus(cycle.steps);
  const step6CompletedAt = stepCompletedAt(cycle.steps, 6);
  const opsVisible = !!step6CompletedAt;
  const opsAt = cycle.ops_datetime ? new Date(cycle.ops_datetime) : null;
  const lastStepCompletedAt = stepCompletedAt(cycle.steps, POI_DINING_BERBAYAR_TOTAL_STEPS);
  const slaTotal = formatSlaDuration(opsAt, lastStepCompletedAt ? new Date(lastStepCompletedAt) : now);

  const sopLabel = allDone
    ? `Selesai (${POI_DINING_BERBAYAR_TOTAL_STEPS}/${POI_DINING_BERBAYAR_TOTAL_STEPS} step)`
    : !optionalDone
      ? `MOU/Invoice: ${optionalResolvedCount}/5 step opsional resolved`
      : `Step ${lastCompletedSequentialStep}/${POI_DINING_BERBAYAR_TOTAL_STEPS} selesai · sedang: Step ${currentStep?.step} — ${currentStep?.task}`;

  const periodLabel = `${tanggal(cycle.period_start)} – ${tanggal(cycle.period_end)}`;

  return (
    <>
      <div className="subcard poi-card" onClick={() => setOpen(true)}>
        <div className="poi-card-head">
          <strong>{cycle.brand_name}</strong>
          <span className="badge indigo">Berbayar · Siklus {cycle.cycle_no}</span>
        </div>
        <div className="mono muted" style={{ fontSize: 11, marginBottom: 8 }}>
          {cycle.code ?? "—"}
        </div>
        <dl className="poi-fields">
          <dt>Nama BD</dt>
          <dd>{cycle.bd_name}</dd>
          <dt>Nama Ops</dt>
          <dd>{cycle.ops_name ?? "—"}</dd>
          <dt>Periode Siklus</dt>
          <dd>{periodLabel}</dd>
          <dt>Tanggal Ops</dt>
          <dd>
            {opsVisible ? (
              formatJakartaDatetime(opsAt)
            ) : (
              <span className="muted">isi setelah Step 6 selesai</span>
            )}
          </dd>
          <dt>SOP</dt>
          <dd>{sopLabel}</dd>
        </dl>
        <div className="poi-sla-row" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>
              SLA Total (Tanggal Ops → Step {POI_DINING_BERBAYAR_TOTAL_STEPS})
            </div>
            <strong>{slaTotal}</strong>
          </div>
        </div>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="modal-head">
              <h3>
                {cycle.brand_name} · Siklus {cycle.cycle_no} ({periodLabel})
                {cycle.code ? ` · ${cycle.code}` : ""}
              </h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <Msg state={state} />
              <form action={action}>
                <input type="hidden" name="cycle_id" value={cycle.cycle_id} />
                <input type="hidden" name="deal_id" value={cycle.deal_id} />

                <div className="row">
                  <div>
                    <label>Nama Ops</label>
                    <select name="ops_name" defaultValue={cycle.ops_name ?? ""}>
                      <option value="">— belum dipilih —</option>
                      {opsNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Periode Siklus</label>
                    <input value={periodLabel} readOnly disabled />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Tanggal Ops</label>
                    {opsVisible ? (
                      <input
                        type="datetime-local"
                        name="ops_datetime"
                        defaultValue={toJakartaDatetimeLocalInput(opsAt)}
                      />
                    ) : (
                      <>
                        <input value="—" readOnly disabled />
                        <p className="hint">Muncul & dapat diisi setelah Step 6 selesai.</p>
                      </>
                    )}
                  </div>
                  <div>
                    <label>Actual VT</label>
                    <input type="number" name="actual_vt" min="0" step="1" defaultValue={cycle.actual_vt ?? ""} />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Total GMV</label>
                    <input type="number" name="total_gmv" min="0" step="1" defaultValue={cycle.total_gmv ?? ""} />
                    {cycle.total_gmv != null && <p className="hint">{rupiah(cycle.total_gmv)}</p>}
                  </div>
                  <div>
                    <label>Status Report</label>
                    <select name="report_status" defaultValue={cycle.report_status ?? ""}>
                      <option value="">— belum ada —</option>
                      {REPORT_STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <label>Link Report Monthly</label>
                <input type="url" name="report_link" placeholder="https://…" defaultValue={cycle.report_link ?? ""} />

                <label>Notes</label>
                <textarea name="notes" rows={3} defaultValue={cycle.notes ?? ""} placeholder={POI_NOTES_HINT} />
                {/* Sama dengan card POI lain: catatan ini selalu tampil. */}
                <p className="hint">{POI_NOTES_HINT}</p>

                <div className="modal-foot" style={{ padding: "14px 0 0", borderTop: "none" }}>
                  <button type="submit" disabled={pending}>
                    {pending ? "Menyimpan…" : "Simpan"}
                  </button>
                </div>
              </form>

              <h3 style={{ marginTop: 20 }}>Task SOP ({POI_DINING_BERBAYAR_TOTAL_STEPS} step)</h3>
              <p className="muted" style={{ fontSize: 12, marginTop: -8 }}>
                Step 1-5 (MOU/Invoice/Payment) opsional & bebas urutan — bisa dilewati dengan approval Director. Step
                6-22 berurutan, baru bisa mulai setelah step 1-5 selesai/dilewati.
              </p>
              <ul className="poi-steps">
                {stepDefs.map((step) => (
                  <StepItem
                    key={step.step}
                    cycleId={cycle.cycle_id}
                    step={step}
                    completedAt={stepCompletedAt(cycle.steps, step.step)}
                    skippedAt={cycle.steps.find((s) => s.step_no === step.step)?.skipped_at ?? null}
                    isOptional={step.step <= DINING_BERBAYAR_OPTIONAL_STEPS_END}
                    isCurrent={currentStep?.step === step.step}
                    canApproveSkip={canApproveSkip}
                  />
                ))}
              </ul>
            </div>
            <div className="modal-foot">
              <button type="button" className="ghost2" onClick={() => setOpen(false)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
