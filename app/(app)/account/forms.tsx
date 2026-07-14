"use client";

import { useActionState } from "react";
import {
  assignAm,
  createStrategy,
  setStrategyStatus,
  createBrief,
  setBriefStatus,
  createComplaint,
  setComplaintStatus,
  type ActionResult,
} from "@/lib/actions/account";

type Emp = { id: string; full_name: string };

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

// ---- Intake: assign AM ----
export function AssignAmForm({
  merchantId,
  ams,
  isReassign,
}: {
  merchantId: string;
  ams: Emp[];
  isReassign: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(assignAm, null);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="merchant_id" value={merchantId} />
      <select name="am_id" required style={{ width: 160 }}>
        <option value="">Pilih AM…</option>
        {ams.map((a) => (
          <option key={a.id} value={a.id}>
            {a.full_name}
          </option>
        ))}
      </select>
      {isReassign && (
        <input name="reason" placeholder="Alasan penggantian (wajib)" style={{ width: 200 }} required />
      )}
      <button className="sm" disabled={pending}>
        {pending ? "…" : isReassign ? "Ganti AM" : "Tugaskan AM"}
      </button>
      <Msg state={state} />
    </form>
  );
}

// ---- Strategy & Plan ----
export function CreateStrategyForm({ serviceId }: { serviceId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createStrategy,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <input type="hidden" name="service_id" value={serviceId} />
      <div className="row">
        <div>
          <label>Objective *</label>
          <input name="objective" required />
        </div>
        <div>
          <label>Target KPIs * (di-set Account)</label>
          <input name="target_kpis" placeholder="mis. 10 video, GMV Rp 30jt" required />
        </div>
      </div>
      <label>Content / Execution Outline *</label>
      <textarea name="outline" rows={3} required placeholder="Isi sesuai tipe service (archetype/angle/jadwal, SKU priority, targeting/budget, sesi live…)" />
      <div className="row">
        <div>
          <label>Timeline Mulai *</label>
          <input name="timeline_start" type="date" required />
        </div>
        <div>
          <label>Timeline Selesai *</label>
          <input name="timeline_end" type="date" required />
        </div>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Buat Strategy Plan"}
      </button>
    </form>
  );
}

export function StrategyActions({
  strategyId,
  status,
  isLead,
}: {
  strategyId: string;
  status: string;
  isLead: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setStrategyStatus,
    null
  );
  return (
    <div className="inline-actions">
      {status === "[Strategy Drafting]" && (
        <form action={action} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={strategyId} />
          <input type="hidden" name="to_status" value="[Strategy Submitted for Approval]" />
          <button className="sm" disabled={pending}>
            Submit untuk Approval
          </button>
        </form>
      )}
      {status === "[Strategy Submitted for Approval]" && isLead && (
        <>
          <form action={action} style={{ display: "inline" }}>
            <input type="hidden" name="id" value={strategyId} />
            <input type="hidden" name="to_status" value="[Strategy Approved]" />
            <button className="sm" disabled={pending}>
              Approve
            </button>
          </form>
          <form action={action} className="inline-form">
            <input type="hidden" name="id" value={strategyId} />
            <input type="hidden" name="to_status" value="[Strategy Drafting]" />
            <input name="revision_notes" placeholder="Catatan revisi (wajib)" required style={{ width: 220 }} />
            <button className="sm ghost2" disabled={pending}>
              Minta Revisi
            </button>
          </form>
        </>
      )}
      <Msg state={state} />
    </div>
  );
}

// ---- Brief (field kondisional per divisi) ----
const SCOPE_ITEMS = [
  "Title",
  "Deskripsi",
  "Foto/Gambar",
  "Keyword/SEO listing",
  "Review Harga",
  "Variasi Produk",
];
const AD_PLATFORMS = ["TikTok Ads", "Shopee Ads", "Meta Ads", "Google Ads", "Other"];

export function CreateBriefForm({
  serviceId,
  division,
  serviceType,
}: {
  serviceId: string;
  division: string;
  serviceType: string;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createBrief, null);
  const qtyLabel =
    division === "Ecommerce"
      ? "Target SKU Count *"
      : division === "Ads"
      ? "Target Campaign Count *"
      : serviceType === "KOL-Live"
      ? "Target Live Hours (total jam) *"
      : "Target Video Count *";
  return (
    <form action={action}>
      <Msg state={state} />
      <input type="hidden" name="service_id" value={serviceId} />
      <input type="hidden" name="division" value={division} />
      <div className="row">
        <div>
          <label>Deliverable Type *</label>
          <input
            name="deliverable_type"
            required
            placeholder={
              division === "Ecommerce"
                ? "SKU Optimization Set"
                : division === "Ads"
                ? "Ad Campaign Setup"
                : division === "LiveStream"
                ? "Live Session (Vendor)"
                : "KOL Creator Video Batch / Live Session"
            }
          />
        </div>
        <div>
          <label>Prioritas *</label>
          <select name="priority" required defaultValue="Medium">
            <option>Low</option>
            <option>Medium</option>
            <option>High</option>
          </select>
        </div>
      </div>
      <div className="row">
        {division !== "LiveStream" && (
          <div>
            <label>{qtyLabel}</label>
            <input name="quantity_target" type="number" min={1} step="any" required />
          </div>
        )}
        <div>
          <label>Due Date (SLA) *</label>
          <input name="due_date" type="date" required />
        </div>
      </div>

      {division === "Ecommerce" && (
        <>
          <label>Optimization Scope Checklist *</label>
          <div className="checks">
            {SCOPE_ITEMS.map((it) => (
              <label key={it}>
                <input type="checkbox" name="optimization_scope" value={it} /> {it}
              </label>
            ))}
          </div>
          <label>Custom Item (opsional)</label>
          <input name="custom_scope_item" placeholder="Scope non-standar, kosongkan bila tidak ada" />
        </>
      )}

      {division === "Ads" && (
        <>
          <label>Platform(s) *</label>
          <div className="checks">
            {AD_PLATFORMS.map((p) => (
              <label key={p}>
                <input type="checkbox" name="platforms" value={p} /> {p}
              </label>
            ))}
          </div>
          <div className="row">
            <div>
              <label>Budget Total (IDR)</label>
              <input name="budget_total_idr" type="number" min={0} step="1000" />
            </div>
            <div>
              <label>Budget Total (USD)</label>
              <input name="budget_total_usd" type="number" min={0} step="1" />
            </div>
          </div>
        </>
      )}

      {division === "LiveStream" && (
        <div className="row">
          <div>
            <label>Target GMV (Rp)</label>
            <input name="target_gmv" type="number" min={0} step="1000" />
          </div>
          <div>
            <label>Target Jam Tayang</label>
            <input name="target_jam_tayang" type="number" min={0} step="any" />
          </div>
        </div>
      )}

      <label>Instructions / Notes</label>
      <textarea name="instructions" rows={2} />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Buat & Dispatch Brief"}
      </button>
    </form>
  );
}

// Tombol transisi Brief satu-arah (satu form per aksi + hidden input —
// jangan andalkan name/value tombol submit, lihat BUILD_PLAN).
export function BriefStatusButton({
  briefId,
  toStatus,
  label,
  needsNotes,
}: {
  briefId: string;
  toStatus: string;
  label: string;
  needsNotes?: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setBriefStatus,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={briefId} />
      <input type="hidden" name="to_status" value={toStatus} />
      {needsNotes && (
        <input name="revision_notes" placeholder="Feedback (wajib)" required style={{ width: 180 }} />
      )}
      <button className="sm" disabled={pending}>
        {pending ? "…" : label}
      </button>
      <Msg state={state} />
    </form>
  );
}

// ---- Complaints ----
type MerchantOpt = { id: string; label: string };
type ServiceOpt = { id: string; label: string; merchant_id: string };

export function CreateComplaintForm({
  merchants,
  services,
}: {
  merchants: MerchantOpt[];
  services: ServiceOpt[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createComplaint,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Merchant *</label>
          <select name="merchant_id" required>
            <option value="">Pilih merchant…</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Severity *</label>
          <select name="severity" required defaultValue="">
            <option value="" disabled>
              Pilih…
            </option>
            <option value="Low">Low (−5)</option>
            <option value="Medium">Medium (−15)</option>
            <option value="High">High (−30)</option>
          </select>
        </div>
      </div>
      <label>Related Service (opsional, direkomendasikan)</label>
      <select name="related_service_id" defaultValue="">
        <option value="">—</option>
        {services.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
      <label>Deskripsi *</label>
      <textarea name="description" rows={2} required />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Catat Komplain"}
      </button>
    </form>
  );
}

export function ComplaintActions({ complaintId, status }: { complaintId: string; status: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setComplaintStatus,
    null
  );
  return (
    <div className="inline-actions">
      {status === "[Open]" && (
        <form action={action} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={complaintId} />
          <input type="hidden" name="to_status" value="[In Progress]" />
          <button className="sm" disabled={pending}>
            Tangani
          </button>
        </form>
      )}
      {status === "[In Progress]" && (
        <form action={action} className="inline-form">
          <input type="hidden" name="id" value={complaintId} />
          <input type="hidden" name="to_status" value="[Resolved]" />
          <input
            name="resolution_notes"
            placeholder="Resolution Notes (wajib)"
            required
            style={{ width: 220 }}
          />
          <button className="sm" disabled={pending}>
            Resolve
          </button>
        </form>
      )}
      {status === "[Resolved]" && (
        <form action={action} style={{ display: "inline" }}>
          <input type="hidden" name="id" value={complaintId} />
          <input type="hidden" name="to_status" value="[Closed]" />
          <button className="sm ghost2" disabled={pending}>
            Tutup
          </button>
        </form>
      )}
      <Msg state={state} />
    </div>
  );
}
