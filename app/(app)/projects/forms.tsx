"use client";

import { useActionState } from "react";
import {
  createProject,
  setProjectStatus,
  addProjectMerchant,
  removeProjectMerchant,
  assignProjectCreator,
  unassignProjectCreator,
  type ActionResult,
} from "@/lib/actions/projects";
import { INDUSTRIES as INDUSTRY_CATEGORIES } from "@/lib/mcn/industries";

type MerchantOpt = { id: string; code: string | null; nama_toko: string };
type CreatorOpt = { id: string; code: string | null; name: string };

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function CreateProjectForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createProject,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Nama Project *</label>
          <input name="name" required />
        </div>
        <div>
          <label>Kategori Industri *</label>
          <select name="industry_category" defaultValue="" required>
            <option value="" disabled>
              Pilih kategori…
            </option>
            {INDUSTRY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Tanggal Mulai *</label>
          <input type="date" name="start_date" required />
        </div>
        <div>
          <label>Tanggal Akhir *</label>
          <input type="date" name="end_date" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Ads Budget</label>
          <input name="ads_budget" placeholder="mis. 10.000.000" />
        </div>
        <div>
          <label>Target GMV</label>
          <input name="target_gmv" placeholder="mis. 100.000.000" />
        </div>
      </div>
      <label>Jumlah Kreator Dibutuhkan *</label>
      <input name="creators_needed" type="number" min="1" required style={{ maxWidth: 160 }} />
      <div className="row">
        <div>
          <label>Total Video Dibutuhkan</label>
          <input name="videos_needed" type="number" min="1" placeholder="mis. 100" />
        </div>
        <div>
          <label>Lokasi POI</label>
          <input name="poi_location" placeholder="mis. Bandung — Braga" />
        </div>
      </div>
      <label>Deskripsi</label>
      <textarea name="description" rows={3} />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Buat Project"}
      </button>
    </form>
  );
}

const STATUS_NEXT: Record<string, string[]> = {
  draft: ["active", "cancelled"],
  active: ["done", "cancelled"],
};

function StatusButton({ id, to }: { id: string; to: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setProjectStatus,
    null
  );
  return (
    <form action={action} style={{ display: "inline-block", marginRight: 6 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={to} />
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : `→ ${to}`}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          ditolak
        </span>
      )}
    </form>
  );
}

export function ProjectStatusControls({ id, status }: { id: string; status: string }) {
  const targets = STATUS_NEXT[status] ?? [];
  if (targets.length === 0) return <span className="muted">—</span>;
  return (
    <div className="actions-row">
      {targets.map((t) => (
        <StatusButton key={t} id={id} to={t} />
      ))}
    </div>
  );
}

export function AddMerchantForm({ projectId, merchants }: { projectId: string; merchants: MerchantOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    addProjectMerchant,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="project_id" value={projectId} />
      <select name="merchant_id" defaultValue="" required style={{ width: 200 }}>
        <option value="" disabled>
          Pilih merchant…
        </option>
        {merchants.map((m) => (
          <option key={m.id} value={m.id}>
            {m.code ?? "—"} · {m.nama_toko}
          </option>
        ))}
      </select>
      <button className="sm" disabled={pending}>
        {pending ? "…" : "+ Merchant"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

export function RemoveMerchantButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    removeProjectMerchant,
    null
  );
  return (
    <form action={action} style={{ display: "inline-block" }}>
      <input type="hidden" name="id" value={id} />
      <button className="sm dangerbtn" disabled={pending}>
        {pending ? "…" : "Hapus"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

export function AssignCreatorForm({
  projectId,
  creators,
  showFilledBy,
}: {
  projectId: string;
  creators: CreatorOpt[];
  showFilledBy: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    assignProjectCreator,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="project_id" value={projectId} />
      <select name="mcn_creator_id" defaultValue="" required style={{ width: 200 }}>
        <option value="" disabled>
          Pilih kreator…
        </option>
        {creators.map((c) => (
          <option key={c.id} value={c.id}>
            {c.code ?? "—"} · {c.name}
          </option>
        ))}
      </select>
      {showFilledBy && (
        <select name="filled_by" defaultValue="cm" style={{ width: 120 }}>
          <option value="cm">cm</option>
          <option value="acquisition">acquisition</option>
        </select>
      )}
      <button className="sm" disabled={pending}>
        {pending ? "…" : "+ Kreator"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

export function UnassignCreatorButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    unassignProjectCreator,
    null
  );
  return (
    <form action={action} style={{ display: "inline-block" }}>
      <input type="hidden" name="id" value={id} />
      <button className="sm dangerbtn" disabled={pending}>
        {pending ? "…" : "Lepas"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}
