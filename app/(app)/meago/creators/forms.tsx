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
const BINDING_STATUS_OPTIONS = ["Bound creators", "Previously bound creators"] as const;

type CmOption = { id: string; full_name: string; rank: string };

// Field kreator yang bisa diedit manual (dikirim ke updateCreator). Kolom turunan
// (GMV/aktivitas/komisi) sengaja tidak termasuk.
export type EditableCreator = {
  id: string;
  name: string;
  username: string | null;
  binding_status: string | null;
  contract_status: string | null;
  niche: string | null;
  jenis_creator: string | null;
  creator_level: string | null;
  live_roster: boolean;
  owner_cpm_id: string | null;
};

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

const BINDING_BADGE: Record<string, { cls: string; label: string }> = {
  "Bound creators": { cls: "green", label: "Bounded" },
  "Previously bound creators": { cls: "red", label: "Prev. Bounded" },
};

// MasterCreatorRow — satu baris tabel "Master Kreator" yang bisa berubah antara mode
// tampilan dan mode edit terpadu. Tombol "Edit" membuka baris form berlabel di bawahnya
// (inline expandable) berisi SEMUA kolom yang dikelola manual, termasuk "Status Kontrak".
// Kolom turunan (GMV/aktivitas/komisi) dioper sudah ter-format & tetap read-only.
export function MasterCreatorRow({
  creator,
  code,
  cmName,
  derived,
  komisi,
  cmOptions,
  canEditOwner,
  colSpan,
}: {
  creator: EditableCreator;
  code: string | null;
  cmName: string | null;
  derived: {
    avgPayGmv: string;
    redeemedGmv: string;
    totalPost: string;
    postsWithSales: string;
    liveStream: string;
    validLiveStream: string;
  };
  komisi: string;
  cmOptions: CmOption[];
  canEditOwner: boolean;
  colSpan: number;
}) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateCreator,
    null
  );

  // Tutup form otomatis setelah simpan berhasil (revalidatePath sudah memuat ulang data).
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  const binding = creator.binding_status ? BINDING_BADGE[creator.binding_status] : null;

  return (
    <>
      <tr>
        <td>
          {creator.name}
          {code && <div className="mono muted" style={{ fontSize: 11 }}>{code}</div>}
        </td>
        <td className="mono">{creator.username ?? "—"}</td>
        <td>{cmName ?? <span className="muted">—</span>}</td>
        <td>
          {creator.binding_status ? (
            <span className={`badge ${binding?.cls ?? "gray"}`}>
              {binding?.label ?? creator.binding_status}
            </span>
          ) : (
            <span className="muted">Unbounded</span>
          )}
        </td>
        <td>{creator.contract_status && creator.contract_status !== "-" ? creator.contract_status : <span className="muted">-</span>}</td>
        <td className="muted">{creator.niche ?? "—"}</td>
        <td className="muted">{creator.jenis_creator ?? "—"}</td>
        <td>
          {creator.creator_level ? (
            <span className="badge slate">{creator.creator_level}</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="right">{derived.avgPayGmv}</td>
        <td className="right">{derived.redeemedGmv}</td>
        <td className="muted">{komisi}</td>
        <td className="right">{derived.totalPost}</td>
        <td className="right">{derived.postsWithSales}</td>
        <td className="right">{derived.liveStream}</td>
        <td className="right">{derived.validLiveStream}</td>
        <td>
          {creator.live_roster ? (
            <span className="badge green">Roster</span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td>
          <button className="sm" type="button" onClick={() => setEditing((v) => !v)}>
            {editing ? "Tutup" : "Edit"}
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={colSpan} style={{ background: "var(--panel, #f8fafc)" }}>
            <form
              action={action}
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 12,
                padding: "8px 4px",
                alignItems: "end",
              }}
            >
              <input type="hidden" name="creator_id" value={creator.id} />

              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                Nama <span className="err">*</span>
                <input name="name" defaultValue={creator.name} required />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                Username
                <input name="username" defaultValue={creator.username ?? ""} />
              </label>

              {canEditOwner && (
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                  CM
                  <select name="owner_cpm_id" defaultValue={creator.owner_cpm_id ?? ""}>
                    <option value="">— tanpa CM —</option>
                    {cmOptions.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name}
                        {e.rank === "lead" ? " (Lead)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                Status
                <select name="binding_status" defaultValue={creator.binding_status ?? ""}>
                  <option value="">Unbounded</option>
                  {BINDING_STATUS_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {BINDING_BADGE[b]?.label ?? b}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                Status Kontrak
                <input
                  name="contract_status"
                  defaultValue={creator.contract_status ?? "-"}
                  placeholder="mis. Aktif / Berakhir / -"
                />
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                Industry
                <select name="niche" defaultValue={creator.niche ?? ""}>
                  <option value="">— industry —</option>
                  {INDUSTRIES.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                Jenis
                <select name="jenis_creator" defaultValue={creator.jenis_creator ?? ""}>
                  <option value="">— jenis —</option>
                  {JENIS_CREATOR_OPTIONS.map((j) => (
                    <option key={j} value={j}>
                      {j}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                Level
                <input name="creator_level" defaultValue={creator.creator_level ?? ""} placeholder="mis. L1" />
              </label>

              <label style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>
                <input
                  type="checkbox"
                  name="live_roster"
                  value="true"
                  defaultChecked={creator.live_roster}
                  style={{ width: "auto" }}
                />
                Roster Live
              </label>

              <div style={{ display: "flex", gap: 8, alignItems: "center", gridColumn: "1 / -1" }}>
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Simpan"}
                </button>
                <button type="button" className="sm" onClick={() => setEditing(false)} disabled={pending}>
                  Batal
                </button>
                {state && (
                  <span className={state.ok ? "ok-msg" : "err"} style={{ fontSize: 12 }}>
                    {state.message}
                  </span>
                )}
              </div>
            </form>
          </td>
        </tr>
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
