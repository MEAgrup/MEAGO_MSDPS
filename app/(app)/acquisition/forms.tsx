"use client";

import { useActionState, useState } from "react";
import {
  recordAcquisition,
  recordReferral,
  markReferralPaid,
  markHandoffDone,
  refreshGmvPostJoin,
  assignPicCm,
  type ActionResult,
} from "@/lib/actions/acquisition";
import { addCreator, type ActionResult as McnActionResult } from "@/lib/actions/mcn-creators";
import { INDUSTRIES } from "@/lib/mcn/industries";
import { JENIS_KONTRAK } from "@/lib/mcn/binding-fields";

type CreatorOpt = { id: string; code: string | null; name: string };
export type CmOpt = { id: string; full_name: string };

// Field binding wajib (migrasi 0382): dipakai form "Catat Akuisisi (Binding)" dan
// form akuisisi di modal Prospek Kreator. PIC CM ditetapkan Akuisisi saat binding.
export function BindingFieldsInputs({
  cmOptions,
  defaultWa,
}: {
  cmOptions: CmOpt[];
  defaultWa?: string | null;
}) {
  return (
    <>
      <div className="row">
        <div>
          <label>UID TikTok *</label>
          <input name="creator_uid" inputMode="numeric" pattern="[0-9]{5,25}" placeholder="mis. 7012345678901234567" required />
        </div>
        <div>
          <label>No. WhatsApp *</label>
          <input name="whatsapp" inputMode="tel" defaultValue={defaultWa ?? ""} placeholder="08xx / 62xx" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>GMV Potential / bulan (Rp) *</label>
          <input name="gmv_potential" inputMode="numeric" placeholder="mis. 25.000.000" required />
        </div>
        <div>
          <label>Tanggal Binding Akhir *</label>
          <input type="date" name="binding_end_date" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Jenis Kontrak *</label>
          <select name="status_kontrak" defaultValue="" required>
            <option value="" disabled>
              Pilih jenis kontrak…
            </option>
            {JENIS_KONTRAK.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>PIC CM *</label>
          <select name="pic_cm_id" defaultValue="" required>
            <option value="" disabled>
              Pilih PIC Creator Management…
            </option>
            {cmOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}

export function AssignPicCmForm({ id, currentId, cmOptions }: { id: string; currentId: string | null; cmOptions: CmOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(assignPicCm, null);
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <select name="pic_cm_id" defaultValue={currentId ?? ""} aria-label="PIC CM" required>
        <option value="" disabled>
          — pilih PIC CM —
        </option>
        {cmOptions.map((o) => (
          <option key={o.id} value={o.id}>
            {o.full_name}
          </option>
        ))}
      </select>
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && !state.ok && <div className="err" style={{ marginTop: 4 }}>{state.message}</div>}
    </form>
  );
}

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function AddCreatorForm() {
  const [state, action, pending] = useActionState<McnActionResult | null, FormData>(
    addCreator,
    null
  );
  return (
    <form action={action}>
      {state && <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>}
      <div className="row">
        <div>
          <label>Nama Kreator *</label>
          <input name="name" required />
        </div>
        <div>
          <label>Username TikTok</label>
          <input name="username" placeholder="username TikTok (opsional)" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Industry</label>
          <select name="niche" defaultValue="">
            <option value="">— pilih —</option>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Kota</label>
          <input name="city" placeholder="kota (opsional)" />
        </div>
      </div>
      <label>Catatan</label>
      <textarea name="notes" rows={2} />
      <input type="hidden" name="platform" value="tiktok" />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Daftarkan Prospek"}
      </button>
    </form>
  );
}

export function RecordAcquisitionForm({ prospects, cmOptions }: { prospects: CreatorOpt[]; cmOptions: CmOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    recordAcquisition,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Kreator (prospek) *</label>
          <select name="mcn_creator_id" defaultValue="" required>
            <option value="" disabled>
              Pilih kreator prospek…
            </option>
            {prospects.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? "—"} · {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Tanggal Binding *</label>
          <input type="date" name="binding_date" required />
        </div>
      </div>
      <BindingFieldsInputs cmOptions={cmOptions} />
      <label>Sumber Lead</label>
      <select name="lead_source" defaultValue="">
        <option value="">— pilih —</option>
        <option value="inbound">inbound</option>
        <option value="outbound">outbound</option>
        <option value="platform">platform</option>
      </select>
      <label>Catatan</label>
      <textarea name="notes" rows={2} />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Catat Akuisisi (Binding)"}
      </button>
    </form>
  );
}

export function RefreshGmvButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    refreshGmvPostJoin,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Refresh GMV"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

export function HandoffButton({ id, blocked }: { id: string; blocked: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    markHandoffDone,
    null
  );
  return (
    <div>
      <form action={action} className="inline-form">
        <input type="hidden" name="id" value={id} />
        <button className="sm" disabled={pending}>
          {pending ? "…" : "Handoff Selesai"}
        </button>
      </form>
      {blocked && (
        <div className="muted" style={{ fontSize: 11 }}>
          PIC CM belum ditetapkan — pilih PIC CM di kolom PIC CM dulu.
        </div>
      )}
      {state && !state.ok && <div className="err" style={{ marginTop: 4 }}>{state.message}</div>}
    </div>
  );
}

export function RecordReferralForm({ creators }: { creators: CreatorOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    recordReferral,
    null
  );
  const [source, setSource] = useState<"antar_creator" | "platform" | "">("");
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Kreator Baru *</label>
          <select name="new_creator_id" defaultValue="" required>
            <option value="" disabled>
              Pilih kreator…
            </option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? "—"} · {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Sumber Referral *</label>
          <select
            name="referral_source"
            defaultValue=""
            required
            onChange={(e) => setSource(e.target.value as "antar_creator" | "platform")}
          >
            <option value="" disabled>
              Pilih sumber…
            </option>
            <option value="antar_creator">antar_creator</option>
            <option value="platform">platform</option>
          </select>
        </div>
      </div>
      {source === "antar_creator" && (
        <>
          <label>Kreator Perujuk *</label>
          <select name="referrer_creator_id" defaultValue="" required>
            <option value="" disabled>
              Pilih kreator perujuk…
            </option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? "—"} · {c.name}
              </option>
            ))}
          </select>
        </>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Catat Referral"}
      </button>
    </form>
  );
}

export function MarkReferralPaidButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    markReferralPaid,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Tandai Dibayar"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}
