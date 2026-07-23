"use client";

import { useActionState, useEffect, useState } from "react";
import {
  assignOwner,
  setAdsBudgetCap,
  setCreatorProfile,
  toggleRoster,
  updateCreator,
  type ActionResult,
} from "@/lib/actions/mcn-creators";
import { createCreatorAccount } from "@/lib/actions/portal";
import { INDUSTRIES } from "@/lib/mcn/industries";

const JENIS_CREATOR_OPTIONS = ["live", "video", "mixed"] as const;
const STATUS_OPTIONS = ["prospek", "binding", "aktif", "nonaktif"] as const;

type CmOption = { id: string; full_name: string; rank: string };

// Baris kreator lengkap yang dipakai modal edit — mirror kolom mcn_creators.
export type CreatorEditable = {
  id: string;
  code: string | null;
  name: string;
  platform: string | null;
  username: string | null;
  city: string | null;
  niche: string | null;
  jenis_creator: string | null;
  creator_level: string | null;
  binding_status: string | null;
  status: string;
  status_kontrak: string | null;
  owner_cpm_id: string | null;
  live_roster: boolean;
  gmv: number | null;
  gmv_live: number | null;
  gmv_video: number | null;
  commission_share: number | null;
  ads_budget_cap: number | null;
  notes: string | null;
  top_niches: unknown;
  auth_user_id: string | null;
  created_at: string | null;
  status_changed_by: string | null;
  status_changed_at: string | null;
};

const numStr = (n: number | null | undefined) =>
  n !== null && n !== undefined ? String(n) : "";

// AssignOwnerRow — satu form per baris kreator di card "Assign CM / CPM". Select
// preselect ke owner sekarang; opsi pertama "— tanpa CM —" (value kosong) utk melepas
// assign. cmOptions dioper dari server page (employees divisi CreatorManagement, active).
export function AssignOwnerRow({
  creatorId,
  currentOwnerId,
  cmOptions,
}: {
  creatorId: string;
  currentOwnerId: string | null;
  cmOptions: CmOption[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    assignOwner,
    null
  );
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <select name="owner_cpm_id" defaultValue={currentOwnerId ?? ""}>
        <option value="">— tanpa CM —</option>
        {cmOptions.map((e) => (
          <option key={e.id} value={e.id}>
            {e.full_name}
            {e.rank === "lead" ? " (Lead)" : ""}
          </option>
        ))}
      </select>
      <button className="sm" type="submit" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && (
        <span className={state.ok ? "ok-msg" : "err"} style={{ fontSize: 11 }}>
          {state.message}
        </span>
      )}
    </form>
  );
}

// BudgetCapRow — form set ads_budget_cap per kreator. Input dikosongkan → hapus cap
// (action sudah menangani "" → null); validasi angka dilakukan di server via parseRupiah.
export function BudgetCapRow({
  creatorId,
  currentCap,
}: {
  creatorId: string;
  currentCap: number | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setAdsBudgetCap,
    null
  );
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <input
        name="ads_budget_cap"
        defaultValue={currentCap !== null ? String(currentCap) : ""}
        inputMode="numeric"
        placeholder="mis. 1.500.000"
        style={{ width: 130 }}
      />
      <button className="sm" type="submit" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && (
        <span className={state.ok ? "ok-msg" : "err"} style={{ fontSize: 11 }}>
          {state.message}
        </span>
      )}
    </form>
  );
}

// ProfileRow — form setCreatorProfile per kreator (jenis_creator + niche/Industry).
// Jalur pengisian manual satu-satunya sejak fase auto-fill dari export konten video
// dibatalkan (2026-07-16).
export function ProfileRow({
  creatorId,
  currentJenis,
  currentNiche,
}: {
  creatorId: string;
  currentJenis: string | null;
  currentNiche: string | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setCreatorProfile,
    null
  );
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <select name="jenis_creator" defaultValue={currentJenis ?? ""}>
        <option value="">— jenis —</option>
        {JENIS_CREATOR_OPTIONS.map((j) => (
          <option key={j} value={j}>
            {j}
          </option>
        ))}
      </select>
      <select name="niche" defaultValue={currentNiche ?? ""}>
        <option value="">— industry —</option>
        {INDUSTRIES.map((i) => (
          <option key={i} value={i}>
            {i}
          </option>
        ))}
      </select>
      <button className="sm" type="submit" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && (
        <span className={state.ok ? "ok-msg" : "err"} style={{ fontSize: 11 }}>
          {state.message}
        </span>
      )}
    </form>
  );
}

// PortalAccountRow — form buat akun portal kreator (email + password). Server action
// createCreatorAccount memakai service-role + gate CM Lead/OD/Director; kesalahan email
// duplikat dsb. diteruskan apa adanya.
export function PortalAccountRow({ creatorId }: { creatorId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createCreatorAccount,
    null
  );
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <input name="email" type="email" placeholder="email kreator" required style={{ width: 180 }} />
      <input
        name="password"
        type="text"
        placeholder="password (min 8)"
        required
        style={{ width: 140 }}
      />
      <button className="sm" type="submit" disabled={pending}>
        {pending ? "…" : "Buat akun"}
      </button>
      {state && (
        <span className={state.ok ? "ok-msg" : "err"} style={{ fontSize: 11 }}>
          {state.message}
        </span>
      )}
    </form>
  );
}

// EditCreatorModal — tombol "Edit" per baris yang membuka modal berisi form seluruh
// kolom kreator (identitas/sistem read-only, kolom bisnis editable termasuk kolom
// baru status_kontrak). Submit memanggil updateCreator; setelah sukses server
// merevalidasi path sehingga tabel ter-refresh, dan modal ditutup otomatis.
export function EditCreatorModal({
  creator,
  cmOptions,
}: {
  creator: CreatorEditable;
  cmOptions: CmOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateCreator,
    null
  );

  // Tutup modal begitu update sukses (data tabel di-refresh oleh revalidatePath).
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
              <h3>Edit Kreator{creator.code ? ` · ${creator.code}` : ""}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                {state && !state.ok && <div className="err">{state.message}</div>}
                <input type="hidden" name="creator_id" value={creator.id} />

                <div className="row">
                  <div>
                    <label>Kode (ID) — read-only</label>
                    <input value={creator.code ?? "—"} disabled />
                  </div>
                  <div>
                    <label>Nama *</label>
                    <input name="name" defaultValue={creator.name} required />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Username</label>
                    <input name="username" defaultValue={creator.username ?? ""} />
                  </div>
                  <div>
                    <label>Platform</label>
                    <input name="platform" defaultValue={creator.platform ?? "tiktok"} />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Kota</label>
                    <input name="city" defaultValue={creator.city ?? ""} />
                  </div>
                  <div>
                    <label>Industry</label>
                    <select name="niche" defaultValue={creator.niche ?? ""}>
                      <option value="">— industry —</option>
                      {INDUSTRIES.map((i) => (
                        <option key={i} value={i}>
                          {i}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Jenis Kreator</label>
                    <select name="jenis_creator" defaultValue={creator.jenis_creator ?? ""}>
                      <option value="">— jenis —</option>
                      {JENIS_CREATOR_OPTIONS.map((j) => (
                        <option key={j} value={j}>
                          {j}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Creator Level</label>
                    <input name="creator_level" defaultValue={creator.creator_level ?? ""} />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Status</label>
                    <select name="status" defaultValue={creator.status}>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Status Kontrak</label>
                    <select name="status_kontrak" defaultValue={creator.status_kontrak ?? ""}>
                      <option value="">— belum ditetapkan —</option>
                      <option value="kontrak">Kontrak</option>
                      <option value="non kontrak">Non Kontrak</option>
                    </select>
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Binding Status</label>
                    <input name="binding_status" defaultValue={creator.binding_status ?? ""} />
                  </div>
                  <div>
                    <label>Owner CM / CPM</label>
                    <select name="owner_cpm_id" defaultValue={creator.owner_cpm_id ?? ""}>
                      <option value="">— tanpa CM —</option>
                      {cmOptions.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name}
                          {e.rank === "lead" ? " (Lead)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>GMV (rata-rata bulanan)</label>
                    <input
                      name="gmv"
                      inputMode="numeric"
                      defaultValue={numStr(creator.gmv)}
                      placeholder="mis. 1.500.000"
                    />
                  </div>
                  <div>
                    <label>Komisi (%) — read-only sync</label>
                    <input
                      value={creator.commission_share !== null ? String(creator.commission_share) : "—"}
                      disabled
                    />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>GMV Live</label>
                    <input name="gmv_live" inputMode="numeric" defaultValue={numStr(creator.gmv_live)} />
                  </div>
                  <div>
                    <label>GMV Video</label>
                    <input name="gmv_video" inputMode="numeric" defaultValue={numStr(creator.gmv_video)} />
                  </div>
                </div>

                <div className="row">
                  <div>
                    <label>Ads Budget Cap</label>
                    <input
                      name="ads_budget_cap"
                      inputMode="numeric"
                      defaultValue={numStr(creator.ads_budget_cap)}
                      placeholder="mis. 1.500.000"
                    />
                  </div>
                  <div>
                    <label>Roster Live</label>
                    <select name="live_roster" defaultValue={creator.live_roster ? "true" : "false"}>
                      <option value="false">Tidak</option>
                      <option value="true">Ya (roster live)</option>
                    </select>
                  </div>
                </div>

                <label>Catatan</label>
                <textarea
                  name="notes"
                  defaultValue={creator.notes ?? ""}
                  rows={2}
                  style={{ fontFamily: "inherit" }}
                />

                <label>Top Niches (JSON)</label>
                <textarea
                  name="top_niches"
                  defaultValue={creator.top_niches ? JSON.stringify(creator.top_niches) : ""}
                  rows={2}
                  placeholder='mis. ["Dining","Accommodation"]'
                />

                <details className="disclose">
                  <summary>Info sistem (read-only)</summary>
                  <div className="row">
                    <div>
                      <label>Akun Portal (auth user id)</label>
                      <input value={creator.auth_user_id ?? "—"} disabled />
                    </div>
                    <div>
                      <label>Dibuat pada</label>
                      <input value={creator.created_at ?? "—"} disabled />
                    </div>
                  </div>
                  <div className="row">
                    <div>
                      <label>Status diubah oleh</label>
                      <input value={creator.status_changed_by ?? "—"} disabled />
                    </div>
                    <div>
                      <label>Status diubah pada</label>
                      <input value={creator.status_changed_at ?? "—"} disabled />
                    </div>
                  </div>
                </details>
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

// RosterToggleRow — form toggleRoster per kreator. Hidden `live_roster` mengirim nilai
// TUJUAN (bukan nilai sekarang) — action membaca `=== "true"`.
export function RosterToggleRow({
  creatorId,
  inRoster,
}: {
  creatorId: string;
  inRoster: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    toggleRoster,
    null
  );
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="creator_id" value={creatorId} />
      <input type="hidden" name="live_roster" value={inRoster ? "false" : "true"} />
      <button className="sm" type="submit" disabled={pending}>
        {pending ? "…" : inRoster ? "Keluarkan dari roster" : "Masukkan ke roster"}
      </button>
      {state && (
        <span className={state.ok ? "ok-msg" : "err"} style={{ fontSize: 11 }}>
          {state.message}
        </span>
      )}
    </form>
  );
}
