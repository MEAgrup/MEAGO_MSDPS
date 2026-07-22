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
const STATUS_KONTRAK_OPTIONS: { value: string; label: string }[] = [
  { value: "-", label: "— (belum diisi)" },
  { value: "kontrak", label: "Kontrak" },
  { value: "non_kontrak", label: "Non Kontrak" },
];

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

// ---------------------------------------------------------------------------
// EditCreatorRow — tombol "Edit" per baris Master Kreator + modal form berisi
// SELURUH kolom yang bisa di-edit dalam satu submit (server action updateCreator).
// Kolom metrik (Avg Pay GMV, dst) bersifat override: kosong = pakai hitungan
// otomatis (placeholder menampilkan nilai otomatis saat ini), diisi = pakai nilai
// manual. CM hanya bisa diubah CM Lead/management (canAssignOwner); selain itu
// tampil read-only.
// ---------------------------------------------------------------------------

export type CreatorEdit = {
  id: string;
  code: string | null;
  name: string;
  username: string | null;
  owner_cpm_id: string | null;
  binding_status: string | null;
  status_kontrak: string;
  niche: string | null;
  jenis_creator: string | null;
  creator_level: string | null;
  commission_share: number | null;
  live_roster: boolean;
  manual_avg_pay_gmv: number | null;
  manual_redeemed_gmv: number | null;
  manual_total_post: number | null;
  manual_posts_with_sales: number | null;
  manual_live_stream: number | null;
  manual_valid_live_stream: number | null;
};

// Placeholder "otomatis" untuk tiap kolom metrik (nilai hitung sekarang, sudah
// diformat di server). Ditampilkan sebagai placeholder input override.
export type ComputedPlaceholders = {
  manual_avg_pay_gmv: string;
  manual_redeemed_gmv: string;
  manual_total_post: string;
  manual_posts_with_sales: string;
  manual_live_stream: string;
  manual_valid_live_stream: string;
};

function numToInput(n: number | null): string {
  return n === null || n === undefined ? "" : String(n);
}

export function EditCreatorRow({
  creator,
  cmName,
  cmOptions,
  canAssignOwner,
  computed,
}: {
  creator: CreatorEdit;
  cmName: string;
  cmOptions: CmOption[];
  canAssignOwner: boolean;
  computed: ComputedPlaceholders;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateCreator,
    null
  );

  // Tutup otomatis beberapa saat setelah sukses agar tabel yang sudah ter-revalidate
  // tampil dengan data baru; pesan sukses sempat terlihat dulu.
  useEffect(() => {
    if (state?.ok) {
      const t = setTimeout(() => setOpen(false), 1200);
      return () => clearTimeout(t);
    }
  }, [state]);

  const metricRow = (
    key: keyof ComputedPlaceholders,
    label: string,
    current: number | null
  ) => (
    <div>
      <label>{label} (override)</label>
      <input
        name={key}
        defaultValue={numToInput(current)}
        placeholder={`otomatis: ${computed[key]}`}
        inputMode="decimal"
      />
    </div>
  );

  return (
    <>
      <button type="button" className="sm ghost2" onClick={() => setOpen(true)}>
        Edit
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,.5)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "40px 16px",
            zIndex: 50,
            overflowY: "auto",
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 680, width: "100%", margin: 0 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 6,
              }}
            >
              <h2 style={{ margin: 0 }}>Edit Kreator</h2>
              <button
                type="button"
                className="sm ghost2"
                onClick={() => setOpen(false)}
                aria-label="Tutup"
              >
                ✕
              </button>
            </div>
            <p className="section-sub">
              {creator.code ? `${creator.code} · ` : ""}
              {creator.name}. Kolom metrik bersifat override — kosongkan untuk memakai
              hitungan otomatis (rata-rata 3 bulan).
            </p>

            <form action={action}>
              {state && <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>}
              <input type="hidden" name="creator_id" value={creator.id} />

              <div className="row">
                <div>
                  <label>Nama *</label>
                  <input name="name" defaultValue={creator.name} required />
                </div>
                <div>
                  <label>Username</label>
                  <input name="username" defaultValue={creator.username ?? ""} />
                </div>
              </div>

              <div className="row">
                <div>
                  <label>CM</label>
                  {canAssignOwner ? (
                    <select name="owner_cpm_id" defaultValue={creator.owner_cpm_id ?? ""}>
                      <option value="">— tanpa CM —</option>
                      {cmOptions.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name}
                          {e.rank === "lead" ? " (Lead)" : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input value={cmName} disabled />
                  )}
                </div>
                <div>
                  <label>Status (binding)</label>
                  <select name="binding_status" defaultValue={creator.binding_status ?? ""}>
                    <option value="">— (unbounded) —</option>
                    {BINDING_STATUS_OPTIONS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="row">
                <div>
                  <label>Status Kontrak</label>
                  <select name="status_kontrak" defaultValue={creator.status_kontrak ?? "-"}>
                    {STATUS_KONTRAK_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
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
                  <label>Jenis</label>
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
                  <label>Level</label>
                  <input
                    name="creator_level"
                    defaultValue={creator.creator_level ?? ""}
                    placeholder="mis. L1 / dari file"
                  />
                </div>
              </div>

              <div className="row">
                <div>
                  <label>Komisi (%)</label>
                  <input
                    name="commission_share"
                    defaultValue={numToInput(creator.commission_share)}
                    placeholder="mis. 10"
                    inputMode="decimal"
                  />
                </div>
                <div>{/* spacer */}</div>
              </div>

              <div className="row">
                {metricRow("manual_avg_pay_gmv", "Avg Pay GMV", creator.manual_avg_pay_gmv)}
                {metricRow("manual_redeemed_gmv", "Redeemed GMV", creator.manual_redeemed_gmv)}
              </div>
              <div className="row">
                {metricRow("manual_total_post", "Total post", creator.manual_total_post)}
                {metricRow(
                  "manual_posts_with_sales",
                  "Posts with sales",
                  creator.manual_posts_with_sales
                )}
              </div>
              <div className="row">
                {metricRow("manual_live_stream", "Live stream", creator.manual_live_stream)}
                {metricRow(
                  "manual_valid_live_stream",
                  "Valid live stream",
                  creator.manual_valid_live_stream
                )}
              </div>

              <div className="checks">
                <label>
                  <input
                    type="checkbox"
                    name="live_roster"
                    value="true"
                    defaultChecked={creator.live_roster}
                  />
                  Roster Live
                </label>
              </div>

              <div className="actions-row">
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Simpan Perubahan"}
                </button>
                <button
                  type="button"
                  className="ghost2"
                  onClick={() => setOpen(false)}
                  disabled={pending}
                >
                  Tutup
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
