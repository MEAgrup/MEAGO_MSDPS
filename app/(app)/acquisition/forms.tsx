"use client";

import { useActionState, useEffect, useState } from "react";
import {
  recordAcquisition,
  recordReferral,
  markReferralPaid,
  markHandoffDone,
  refreshGmvPostJoin,
  updateAcquisition,
  deleteAcquisition,
  type ActionResult,
} from "@/lib/actions/acquisition";
import { addCreator, type ActionResult as McnActionResult } from "@/lib/actions/mcn-creators";
import { INDUSTRIES } from "@/lib/mcn/industries";

type CreatorOpt = { id: string; code: string | null; name: string };

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

export function RecordAcquisitionForm({ prospects }: { prospects: CreatorOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    recordAcquisition,
    null
  );
  const [bindingStart, setBindingStart] = useState("");
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
          <label>Tanggal Binding Mulai *</label>
          <input
            type="date"
            name="binding_date"
            required
            value={bindingStart}
            onChange={(e) => setBindingStart(e.target.value)}
          />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Tanggal Binding Berakhir *</label>
          <input type="date" name="binding_end_date" required min={bindingStart || undefined} />
        </div>
        <div>
          <label>Nomor Telepon *</label>
          <input type="tel" name="phone" placeholder="0812… atau +62…" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>UID *</label>
          <input name="uid" placeholder="UID pelanggan" required />
        </div>
        <div>
          <label>Kreator Kontrak *</label>
          <select name="kreator_kontrak" defaultValue="" required>
            <option value="" disabled>
              — pilih —
            </option>
            <option value="kontrak">Kontrak</option>
            <option value="non kontrak">Non Kontrak</option>
          </select>
        </div>
      </div>
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
          owner CM belum ditetapkan — minta CM Lead menetapkan owner dulu.
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

// Baris akuisisi yang bisa diedit — kolom read-only (kreator/specialist/GMV/handoff)
// hanya ditampilkan, kolom editable mirror recordAcquisition.
export type AcquisitionEditable = {
  id: string;
  code: string | null;
  creator_label: string;
  specialist_label: string;
  binding_date: string;
  binding_end_date: string | null;
  phone: string | null;
  uid: string | null;
  kreator_kontrak: string | null;
  lead_source: string | null;
  notes: string | null;
};

// EditAcquisitionModal — tombol "Edit" per baris membuka modal berisi form kolom
// akuisisi yang bisa diubah. Submit memanggil updateAcquisition; sukses → modal
// tertutup & tabel di-refresh via revalidatePath. Validasi tanggal berakhir >= mulai
// ditegakkan di client (min) dan server.
export function EditAcquisitionModal({ acq }: { acq: AcquisitionEditable }) {
  const [open, setOpen] = useState(false);
  const [bindingStart, setBindingStart] = useState(acq.binding_date ?? "");
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateAcquisition,
    null
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button className="sm ghost2" type="button" onClick={() => setOpen(true)}>
        Edit
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Edit Akuisisi{acq.code ? ` · ${acq.code}` : ""}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                {state && !state.ok && <div className="err">{state.message}</div>}
                <input type="hidden" name="id" value={acq.id} />

                <div className="row">
                  <div>
                    <label>Kreator — read-only</label>
                    <input value={acq.creator_label} disabled />
                  </div>
                  <div>
                    <label>Specialist — read-only</label>
                    <input value={acq.specialist_label} disabled />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Tanggal Binding Mulai *</label>
                    <input
                      type="date"
                      name="binding_date"
                      required
                      value={bindingStart}
                      onChange={(e) => setBindingStart(e.target.value)}
                    />
                  </div>
                  <div>
                    <label>Tanggal Binding Berakhir *</label>
                    <input
                      type="date"
                      name="binding_end_date"
                      required
                      defaultValue={acq.binding_end_date ?? ""}
                      min={bindingStart || undefined}
                    />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Nomor Telepon *</label>
                    <input
                      type="tel"
                      name="phone"
                      required
                      defaultValue={acq.phone ?? ""}
                      placeholder="0812… atau +62…"
                    />
                  </div>
                  <div>
                    <label>UID *</label>
                    <input name="uid" required defaultValue={acq.uid ?? ""} placeholder="UID pelanggan" />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Kreator Kontrak *</label>
                    <select name="kreator_kontrak" defaultValue={acq.kreator_kontrak ?? ""} required>
                      <option value="" disabled>
                        — pilih —
                      </option>
                      <option value="kontrak">Kontrak</option>
                      <option value="non kontrak">Non Kontrak</option>
                    </select>
                  </div>
                  <div>
                    <label>Sumber Lead</label>
                    <select name="lead_source" defaultValue={acq.lead_source ?? ""}>
                      <option value="">— pilih —</option>
                      <option value="inbound">inbound</option>
                      <option value="outbound">outbound</option>
                      <option value="platform">platform</option>
                    </select>
                  </div>
                </div>

                <label>Catatan</label>
                <textarea
                  name="notes"
                  defaultValue={acq.notes ?? ""}
                  rows={2}
                  style={{ fontFamily: "inherit" }}
                />
              </div>
              <div className="modal-foot">
                <button
                  type="button"
                  className="ghost2"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Batal
                </button>
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Simpan Perubahan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// DeleteAcquisitionButton — hard-delete satu baris akuisisi. Konfirmasi lewat
// confirm() sebelum submit (pola dangerbtn seperti modul lain).
export function DeleteAcquisitionButton({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    deleteAcquisition,
    null
  );
  return (
    <form
      action={action}
      style={{ display: "inline-block" }}
      onSubmit={(e) => {
        if (!confirm(`Hapus akuisisi ${label}? Tindakan ini tidak dapat dibatalkan.`)) {
          e.preventDefault();
        }
      }}
    >
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
