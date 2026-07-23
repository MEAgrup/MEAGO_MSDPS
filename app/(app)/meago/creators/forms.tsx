"use client";

import { useActionState, useState, useRef, useEffect } from "react";
import {
  assignOwner,
  setAdsBudgetCap,
  setCreatorProfile,
  toggleRoster,
  editCreator,
  type ActionResult,
} from "@/lib/actions/mcn-creators";
import { createCreatorAccount } from "@/lib/actions/portal";
import { INDUSTRIES } from "@/lib/mcn/industries";

const JENIS_CREATOR_OPTIONS = ["live", "video", "mixed"] as const;
const STATUS_KONTRAK_OPTIONS = ["kontrak", "non kontrak"] as const;

type CmOption = { id: string; full_name: string; rank: string };

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

type CreatorData = {
  id: string;
  name: string;
  username: string | null;
  city: string | null;
  jenis_creator: string | null;
  niche: string | null;
  status_kontrak: string;
  notes: string | null;
  ads_budget_cap: number | null;
  owner_cpm_id: string | null;
};

// EditCreatorModal — modal untuk edit full data kreator. Open/close dikontrol dari parent.
// onClose dipanggil ketika modal ditutup (baik via close button atau after save).
export function EditCreatorModal({
  creator,
  isOpen,
  onClose,
}: {
  creator: CreatorData;
  isOpen: boolean;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    editCreator,
    null
  );

  useEffect(() => {
    if (state?.ok) {
      onClose();
    }
  }, [state?.ok, onClose]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === modalRef.current) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" ref={modalRef} onClick={handleBackdropClick}>
      <div className="modal-content">
        <div className="modal-header">
          <h2>Edit Kreator: {creator.name}</h2>
          <button className="modal-close-btn" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <form action={action}>
          <input type="hidden" name="creator_id" value={creator.id} />
          <input type="hidden" name="current_owner_id" value={creator.owner_cpm_id || ""} />

          <label>Nama <span style={{ color: "var(--danger)" }}>*</span></label>
          <input
            type="text"
            name="name"
            defaultValue={creator.name}
            required
            disabled={pending}
          />

          <label>Username</label>
          <input
            type="text"
            name="username"
            defaultValue={creator.username ?? ""}
            disabled={pending}
          />

          <label>Kota</label>
          <input
            type="text"
            name="city"
            defaultValue={creator.city ?? ""}
            disabled={pending}
          />

          <label>Jenis Kreator</label>
          <select name="jenis_creator" defaultValue={creator.jenis_creator ?? ""} disabled={pending}>
            <option value="">— pilih jenis —</option>
            {JENIS_CREATOR_OPTIONS.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>

          <label>Industry</label>
          <select name="niche" defaultValue={creator.niche ?? ""} disabled={pending}>
            <option value="">— pilih industry —</option>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>

          <label>Status Kontrak</label>
          <select
            name="status_kontrak"
            defaultValue={creator.status_kontrak}
            disabled={pending}
          >
            {STATUS_KONTRAK_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>

          <label>Budget Cap Ads (Rp)</label>
          <input
            type="text"
            name="ads_budget_cap"
            defaultValue={creator.ads_budget_cap ? String(creator.ads_budget_cap) : ""}
            placeholder="mis. 1.500.000"
            inputMode="numeric"
            disabled={pending}
          />

          <label>Catatan</label>
          <textarea
            name="notes"
            defaultValue={creator.notes ?? ""}
            rows={3}
            disabled={pending}
          />

          {state && (
            <div className={state.ok ? "ok-msg" : "err"}>
              {state.message}
            </div>
          )}

          <div className="modal-footer">
            <button type="button" onClick={onClose} disabled={pending}>
              Batal
            </button>
            <button type="submit" disabled={pending}>
              {pending ? "…" : "Simpan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// EditCreatorButton — button yang membuka modal edit. Manage modal state internally.
export function EditCreatorButton({ creator }: { creator: CreatorData }) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button className="sm" type="button" onClick={() => setIsModalOpen(true)}>
        Edit
      </button>
      <EditCreatorModal
        creator={creator}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
