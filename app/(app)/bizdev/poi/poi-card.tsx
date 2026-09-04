"use client";

import { useActionState, useState } from "react";
import { rupiah, tanggal } from "@/lib/format";
import { updatePoiSopProgress, completePoiSopStep, type ActionResult } from "@/lib/actions/poi";
import {
  POI_CATEGORY_LABELS,
  POI_SOP_STEPS,
  REPORT_STATUS_OPTIONS,
  REPORT_WARNING_STEP,
  PRE_VISIT_END_STEP,
  POST_VISIT_END_STEP,
  effectiveOpsDatetime,
  visitDatetime,
  toJakartaDatetimeLocalInput,
  formatJakartaDatetime,
  formatStepSla,
  sopProgressStatus,
  stepCompletedAt,
  computePoiSla,
  type PoiTabCategory,
  type PoiSopStepDef,
} from "@/lib/mcn/poi-sop";

export type PoiTransaction = {
  deal_id: string;
  code: string | null;
  brand_name: string;
  pic_name: string | null;
  kategori_poi: string;
  bd_name: string;
  ops_name: string | null;
  visit_start_date: string | null;
  visit_start_time: string | null;
  progress_id: string;
  ops_datetime: string | null;
  actual_vt: number | null;
  total_gmv: number | null;
  report_link: string | null;
  report_status: string | null;
  notes: string | null;
  steps: { step_no: number; completed_at: string | null }[];
};

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

function visitLabel(date: string | null, time: string | null): string {
  if (!date) return "—";
  return `${tanggal(date)} ${(time ?? "").slice(0, 5)}`.trim();
}

// Catatan tetap di bawah field Notes seluruh card POI (Accommodation & TTD,
// Dining Free/Barter, Dining Berbayar) — menggantikan hint lama "Disarankan
// isi Notes — SOP tersisa N step lagi sebelum selesai."
export const POI_NOTES_HINT = "Total GMV, Actual VT, Link Report diisi pada step akhir";

// StepItem — satu baris checklist "Tandai Selesai". Urutan & imutabilitas
// ditegakkan trigger DB; tombol hanya aktif utk step yang sedang berjalan
// supaya UI tidak menyarankan aksi yang pasti ditolak server.
function StepItem({
  progressId,
  step,
  completedAt,
  isCurrent,
}: {
  progressId: string;
  step: PoiSopStepDef;
  completedAt: string | null;
  isCurrent: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(completePoiSopStep, null);
  const done = !!completedAt;

  return (
    <li className={`poi-step${done ? " done" : ""}`}>
      <div className="poi-step-body">
        <div className="poi-step-title">
          Step {step.step} · {step.task}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          SLA {formatStepSla(step)}
          {done && <> · selesai {formatJakartaDatetime(new Date(completedAt))}</>}
        </div>
        {state && !state.ok && <div className="err" style={{ marginTop: 6 }}>{state.message}</div>}
      </div>
      {done ? (
        <span className="badge green">Selesai</span>
      ) : (
        <form action={action}>
          <input type="hidden" name="progress_id" value={progressId} />
          <input type="hidden" name="step_no" value={step.step} />
          <button type="submit" className="sm" disabled={!isCurrent || pending}>
            {pending ? "…" : "Tandai Selesai"}
          </button>
        </form>
      )}
    </li>
  );
}

export function PoiCard({
  tx,
  opsNames,
  stepDefs = POI_SOP_STEPS,
  preVisitEndStep = PRE_VISIT_END_STEP,
  postVisitEndStep = POST_VISIT_END_STEP,
  reportWarningStep = REPORT_WARNING_STEP,
  badgeLabel,
}: {
  tx: PoiTransaction;
  opsNames: readonly string[];
  stepDefs?: PoiSopStepDef[];
  preVisitEndStep?: number;
  postVisitEndStep?: number;
  reportWarningStep?: number;
  badgeLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updatePoiSopProgress, null);

  const now = new Date();
  const opsEffective = effectiveOpsDatetime(tx.ops_datetime, tx.visit_start_date);
  const visitAt = visitDatetime(tx.visit_start_date, tx.visit_start_time);
  const { lastCompletedStep, currentStep, allDone } = sopProgressStatus(tx.steps, stepDefs);
  const sla = computePoiSla({
    opsDatetime: opsEffective,
    visitDatetime: visitAt,
    preVisitEndCompletedAt: stepCompletedAt(tx.steps, preVisitEndStep),
    postVisitEndCompletedAt: stepCompletedAt(tx.steps, postVisitEndStep),
    now,
  });
  const showReportWarning = !allDone && !!currentStep && currentStep.step >= reportWarningStep;

  // Seluruh step dicentang tapi hasilnya tidak pernah diisi. Tanpa penanda ini,
  // transaksi seperti itu tampak "beres" padahal deliverable vs realisasi tidak bisa
  // dibandingkan sama sekali — kondisi yang ditemukan di semua transaksi live saat
  // audit 2026-09-02 (SOP 15/15 selesai, actual_vt & total_gmv masih NULL).
  const hasilKosong = allDone && tx.actual_vt === null && tx.total_gmv === null;

  const sopLabel = allDone
    ? `Selesai (${tx.steps.length}/${tx.steps.length} step)`
    : `Step ${lastCompletedStep}/${tx.steps.length} selesai · sedang: Step ${currentStep!.step} — ${currentStep!.task}`;

  return (
    <>
      <div className="subcard poi-card" onClick={() => setOpen(true)}>
        <div className="poi-card-head">
          <strong>{tx.brand_name}</strong>
          <span className="badge indigo">
            {badgeLabel ?? (POI_CATEGORY_LABELS as Record<string, string>)[tx.kategori_poi] ?? tx.kategori_poi}
          </span>
          {hasilKosong && (
            <span className="badge red" title="Semua step SOP sudah dicentang, tapi Actual VT & Total GMV belum diisi">
              Hasil belum diisi
            </span>
          )}
        </div>
        <div className="mono muted" style={{ fontSize: 11, marginBottom: 8 }}>
          {tx.code ?? "—"}
        </div>
        <dl className="poi-fields">
          <dt>Nama BD</dt>
          <dd>{tx.bd_name}</dd>
          <dt>Nama Ops</dt>
          <dd>{tx.ops_name ?? "—"}</dd>
          <dt>Tanggal Visit</dt>
          <dd>{visitLabel(tx.visit_start_date, tx.visit_start_time)}</dd>
          <dt>Tanggal Ops</dt>
          <dd>
            {formatJakartaDatetime(opsEffective)}
            {!tx.ops_datetime && (
              <span className="badge amber" style={{ marginLeft: 6 }}>
                saran
              </span>
            )}
          </dd>
          <dt>SOP</dt>
          <dd>{sopLabel}</dd>
        </dl>
        <div className="poi-sla-row">
          <div>
            <div className="muted" style={{ fontSize: 11 }}>
              SLA Total
            </div>
            <strong>{sla.total}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>
              Pre-Visit SLA
            </div>
            <strong>{sla.preVisit}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>
              Post-Visit SLA
            </div>
            <strong>{sla.postVisit}</strong>
          </div>
        </div>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="modal-head">
              <h3>
                {tx.brand_name}
                {tx.code ? ` · ${tx.code}` : ""}
              </h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <Msg state={state} />
              <form action={action}>
                <input type="hidden" name="progress_id" value={tx.progress_id} />
                <input type="hidden" name="deal_id" value={tx.deal_id} />

                <div className="row">
                  <div>
                    <label>Nama Ops</label>
                    <select name="ops_name" defaultValue={tx.ops_name ?? ""}>
                      <option value="">— belum dipilih —</option>
                      {opsNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Tanggal Visit</label>
                    <input value={visitLabel(tx.visit_start_date, tx.visit_start_time)} readOnly disabled />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Tanggal Ops</label>
                    <input
                      type="datetime-local"
                      name="ops_datetime"
                      defaultValue={toJakartaDatetimeLocalInput(opsEffective)}
                    />
                    {!tx.ops_datetime && <p className="hint">Saran H-10 dari Tanggal Visit — ganti bila perlu.</p>}
                  </div>
                  <div>
                    <label>Actual VT</label>
                    <input type="number" name="actual_vt" min="0" step="1" defaultValue={tx.actual_vt ?? ""} />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Total GMV</label>
                    <input type="number" name="total_gmv" min="0" step="1" defaultValue={tx.total_gmv ?? ""} />
                    {tx.total_gmv != null && <p className="hint">{rupiah(tx.total_gmv)}</p>}
                  </div>
                  <div>
                    <label>Status Report</label>
                    <select name="report_status" defaultValue={tx.report_status ?? ""}>
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
                <input type="url" name="report_link" placeholder="https://…" defaultValue={tx.report_link ?? ""} />

                <label>Notes</label>
                <textarea name="notes" rows={3} defaultValue={tx.notes ?? ""} placeholder={POI_NOTES_HINT} />
                {/* Catatan ini SELALU tampil (bukan lagi hanya saat SOP mendekati
                    selesai) — instruksi user 2026-09-04: yang perlu diingatkan
                    bukan "sisa berapa step", tapi kapan hasilnya diisi. */}
                <p className="hint">{POI_NOTES_HINT}</p>

                {showReportWarning && (
                  <p className="warn-box">
                    Peringatan: Anda sudah mencapai Step {reportWarningStep}. Harap segera melengkapi Link Report
                    Monthly dan Statusnya di atas!
                  </p>
                )}

                <div className="modal-foot" style={{ padding: "14px 0 0", borderTop: "none" }}>
                  <button type="submit" disabled={pending}>
                    {pending ? "Menyimpan…" : "Simpan"}
                  </button>
                </div>
              </form>

              <h3 style={{ marginTop: 20 }}>Task SOP ({tx.steps.length} step)</h3>
              <ul className="poi-steps">
                {stepDefs.map((step) => (
                  <StepItem
                    key={step.step}
                    progressId={tx.progress_id}
                    step={step}
                    completedAt={stepCompletedAt(tx.steps, step.step)}
                    isCurrent={currentStep?.step === step.step}
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
