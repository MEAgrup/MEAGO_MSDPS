"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { tanggal } from "@/lib/format";
import {
  assignProspectOwner,
  createCreatorFromProspect,
  recordProspectAcquisition,
  setProspectStatus,
  type ActionResult,
} from "@/lib/actions/creator-prospects";
import { PortalAccessButton } from "@/components/portal-access-button";

export type Prospect = {
  id: string;
  code: string | null;
  nama: string;
  tiktok_username: string;
  email: string | null;
  phone_normalized: string | null;
  followers_range: string | null;
  niche: string | null;
  kota: string | null;
  tiktok_go_status: string | null;
  binding_lain: string | null;
  usia_18: boolean | null;
  source: string;
  cta_id: string | null;
  attribution: Record<string, unknown> | null;
  status: string;
  owner_id: string | null;
  matched_mcn_creator_id: string | null;
  existing_bound: boolean;
  rejected_reason: string | null;
  rejected_note: string | null;
  acquisition_id: string | null;
  created_at: string;
};

export type RegisteredCreator = {
  mcn_creator_id: string;
  creator_code: string | null;
  creator_name: string;
  binding_status: string | null;
};

export type LinkedCreator = {
  code: string | null;
  name: string;
  binding_status: string | null;
  auth_user_id: string | null;
};

// Cermin status_transitions entity 'creator_prospect' (migrasi 0371) — hanya
// untuk menyusun pilihan; DB tetap penentu ([Ditolak]→[Dihubungi] khusus lead).
const NEXT_STATUS: Record<string, string[]> = {
  "[Baru]": ["[Dihubungi]", "[Proses Binding]", "[Bound]", "[Tidak Respon]", "[Ditolak]"],
  "[Dihubungi]": ["[Proses Binding]", "[Bound]", "[Tidak Respon]", "[Ditolak]"],
  "[Proses Binding]": ["[Bound]", "[Dihubungi]", "[Tidak Respon]", "[Ditolak]"],
  "[Tidak Respon]": ["[Dihubungi]"],
  "[Ditolak]": ["[Dihubungi]"],
  "[Bound]": [],
};

const STATUS_CLASS: Record<string, string> = {
  "[Baru]": "slate",
  "[Dihubungi]": "blue",
  "[Proses Binding]": "amber",
  "[Bound]": "green",
  "[Tidak Respon]": "gray",
  "[Ditolak]": "red",
};

const REJECT_REASONS = ["tidak memenuhi syarat", "binding di agency lain", "tidak respon", "lainnya"];

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

function waLink(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

export function ProspectList({
  prospects,
  creators,
  registered,
  empName,
  acqOptions,
  myId,
  canWrite,
  canAssignAny,
}: {
  prospects: Prospect[];
  creators: Record<string, LinkedCreator>;
  registered: Record<string, RegisteredCreator>;
  empName: Record<string, string>;
  acqOptions: { id: string; full_name: string }[];
  myId: string;
  canWrite: boolean;
  canAssignAny: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [kota, setKota] = useState("");
  const [niche, setNiche] = useState("");
  const [source, setSource] = useState("");
  const [cta, setCta] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);

  const uniq = (vals: (string | null)[]) =>
    [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  const kotaOpts = useMemo(() => uniq(prospects.map((p) => p.kota)), [prospects]);
  const nicheOpts = useMemo(() => uniq(prospects.map((p) => p.niche)), [prospects]);
  const sourceOpts = useMemo(() => uniq(prospects.map((p) => p.source)), [prospects]);
  const ctaOpts = useMemo(() => uniq(prospects.map((p) => p.cta_id)), [prospects]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return prospects.filter((p) => {
      if (status && p.status !== status) return false;
      if (kota && p.kota !== kota) return false;
      if (niche && p.niche !== niche) return false;
      if (source && p.source !== source) return false;
      if (cta && p.cta_id !== cta) return false;
      if (qq && !`${p.code ?? ""} ${p.nama} ${p.tiktok_username}`.toLowerCase().includes(qq)) return false;
      return true;
    });
  }, [prospects, q, status, kota, niche, source, cta]);

  const detail = prospects.find((p) => p.id === detailId) ?? null;

  const select = (label: string, value: string, set: (v: string) => void, opts: string[]) => (
    <div>
      <label>{label}</label>
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">— semua —</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="card">
      <div className="table-toolbar">
        <h2>Daftar Prospek ({filtered.length})</h2>
      </div>
      <div className="filters-row">
        <div>
          <label>Cari</label>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="kode, nama, username" />
        </div>
        {select("Status", status, setStatus, Object.keys(NEXT_STATUS))}
        {select("Kota", kota, setKota, kotaOpts)}
        {select("Niche", niche, setNiche, nicheOpts)}
        {select("Sumber", source, setSource, sourceOpts)}
        {select("CTA", cta, setCta, ctaOpts)}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Kreator</th>
              <th>WhatsApp</th>
              <th>Kota · Niche</th>
              <th>Sumber · CTA</th>
              <th>Status</th>
              <th>PIC</th>
              <th className="right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const wa = waLink(p.phone_normalized);
              return (
                <tr key={p.id}>
                  <td className="mono">{p.code ?? "—"}</td>
                  <td>
                    {p.nama}
                    <div className="mono" style={{ fontSize: 11 }}>
                      @{p.tiktok_username}
                    </div>
                    {registered[p.id] && (
                      <span
                        className="badge indigo"
                        title={`Username sudah ada di Data Kreator: ${registered[p.id].creator_code ?? "—"} · ${registered[p.id].creator_name}`}
                      >
                        sudah terdaftar
                      </span>
                    )}
                  </td>
                  <td>
                    {wa ? (
                      <a href={wa} target="_blank" rel="noopener noreferrer" className="mono">
                        {p.phone_normalized}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="muted">
                    {p.kota ?? "—"} · {p.niche ?? "—"}
                  </td>
                  <td className="muted">
                    {p.source}
                    {p.cta_id && (
                      <div className="mono" style={{ fontSize: 11 }}>
                        {p.cta_id}
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[p.status] ?? "gray"}`}>{p.status}</span>
                  </td>
                  <td>{(p.owner_id && empName[p.owner_id]) ?? <span className="muted">—</span>}</td>
                  <td className="right">
                    <button type="button" className="sm ghost2" onClick={() => setDetailId(p.id)}>
                      Detail
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  Belum ada prospek yang cocok dengan filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {detail && (
        <ProspectDetail
          p={detail}
          creator={detail.matched_mcn_creator_id ? creators[detail.matched_mcn_creator_id] ?? null : null}
          registeredAs={registered[detail.id] ?? null}
          empName={empName}
          acqOptions={acqOptions}
          myId={myId}
          canWrite={canWrite}
          canAssignAny={canAssignAny}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}

function ProspectDetail({
  p,
  creator,
  registeredAs,
  empName,
  acqOptions,
  myId,
  canWrite,
  canAssignAny,
  onClose,
}: {
  p: Prospect;
  creator: LinkedCreator | null;
  registeredAs: RegisteredCreator | null;
  empName: Record<string, string>;
  acqOptions: { id: string; full_name: string }[];
  myId: string;
  canWrite: boolean;
  canAssignAny: boolean;
  onClose: () => void;
}) {
  const [statusState, statusAction, statusPending] = useActionState<ActionResult | null, FormData>(
    setProspectStatus,
    null
  );
  const [ownerState, ownerAction, ownerPending] = useActionState<ActionResult | null, FormData>(
    assignProspectOwner,
    null
  );
  const [creatorState, creatorAction, creatorPending] = useActionState<ActionResult | null, FormData>(
    createCreatorFromProspect,
    null
  );
  const [acqState, acqAction, acqPending] = useActionState<ActionResult | null, FormData>(
    recordProspectAcquisition,
    null
  );
  const [nextStatus, setNextStatus] = useState("");
  useEffect(() => setNextStatus(""), [p.status]);

  const isBoundCreator = creator?.binding_status === "Bound creators";
  const closed = p.status === "[Ditolak]" || p.status === "[Tidak Respon]";
  const canPortal = canWrite && p.status === "[Bound]" && isBoundCreator;
  const utm = Object.entries(p.attribution ?? {}).filter(([k]) => k.startsWith("utm_"));

  const row = (k: string, v: React.ReactNode) => (
    <div style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="muted" style={{ minWidth: 140 }}>
        {k}
      </div>
      <div>{v ?? "—"}</div>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>
            {p.code} · {p.nama}
          </h3>
          <button type="button" className="sm ghost2" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {row("Status", <span className={`badge ${STATUS_CLASS[p.status] ?? "gray"}`}>{p.status}</span>)}
          {p.rejected_reason && row("Alasan ditolak", `${p.rejected_reason}${p.rejected_note ? ` — ${p.rejected_note}` : ""}`)}
          {row("Username TikTok", <span className="mono">@{p.tiktok_username}</span>)}
          {row(
            "WhatsApp",
            waLink(p.phone_normalized) ? (
              <a href={waLink(p.phone_normalized) ?? ""} target="_blank" rel="noopener noreferrer">
                {p.phone_normalized}
              </a>
            ) : null
          )}
          {row("Email", p.email)}
          {row("Followers", p.followers_range)}
          {row("Niche · Kota", `${p.niche ?? "—"} · ${p.kota ?? "—"}`)}
          {row("TikTok GO", p.tiktok_go_status)}
          {row("Binding agency lain", p.binding_lain)}
          {row("Usia 18+", p.usia_18 === null ? "—" : p.usia_18 ? "Ya" : "Tidak")}
          {row("Sumber · CTA", `${p.source}${p.cta_id ? ` · ${p.cta_id}` : ""}`)}
          {utm.length > 0 && row("UTM", utm.map(([k, v]) => `${k}=${String(v)}`).join(" · "))}
          {row("Masuk", tanggal(p.created_at))}
          {row("PIC", (p.owner_id && empName[p.owner_id]) ?? "—")}
          {registeredAs &&
            row(
              "Sudah terdaftar",
              <>
                <span className="badge indigo">sudah terdaftar</span> {registeredAs.creator_code ?? "—"} ·{" "}
                {registeredAs.creator_name} · {registeredAs.binding_status ?? "belum binding"}
              </>
            )}
          {row(
            "Data Kreator",
            creator ? (
              <>
                {creator.code ?? "—"} · {creator.name} ·{" "}
                <span className={`badge ${isBoundCreator ? "green" : "gray"}`}>
                  {creator.binding_status ?? "belum binding"}
                </span>
              </>
            ) : (
              <span className="muted">belum tertaut</span>
            )
          )}
          {p.acquisition_id && row("Akuisisi", <span className="badge green">ACQ tercatat</span>)}

          {canWrite && NEXT_STATUS[p.status]?.length > 0 && (
            <form action={statusAction} style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 8px" }}>Ubah Status</h4>
              <Msg state={statusState} />
              <input type="hidden" name="id" value={p.id} />
              <select name="status" value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} required>
                <option value="" disabled>
                  Pilih status berikutnya…
                </option>
                {NEXT_STATUS[p.status].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {nextStatus === "[Bound]" && !isBoundCreator && (
                <div className="warn-box">
                  [Bound] butuh Data Kreator tertaut dengan binding_status &quot;Bound creators&quot;. Status ini
                  diisi dari data binding TikTok GO di menu Data Kreator.
                </div>
              )}
              {nextStatus === "[Ditolak]" && (
                <>
                  <label>Alasan *</label>
                  <select name="rejected_reason" defaultValue="" required>
                    <option value="" disabled>
                      Pilih alasan…
                    </option>
                    {REJECT_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <label>Catatan</label>
                  <input name="rejected_note" />
                </>
              )}
              <button type="submit" disabled={statusPending || !nextStatus}>
                {statusPending ? "Menyimpan…" : "Simpan Status"}
              </button>
            </form>
          )}

          {canWrite && !closed && (canAssignAny || !p.owner_id) && (
            <form action={ownerAction} style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 8px" }}>PIC Acquisition</h4>
              <Msg state={ownerState} />
              <input type="hidden" name="id" value={p.id} />
              {canAssignAny ? (
                <select name="owner_id" defaultValue={p.owner_id ?? ""} required>
                  <option value="" disabled>
                    Pilih PIC…
                  </option>
                  {acqOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.full_name}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="hidden" name="owner_id" value={myId} />
              )}
              <button type="submit" className="ghost2" disabled={ownerPending}>
                {ownerPending ? "…" : canAssignAny ? "Simpan PIC" : "Ambil Prospek Ini"}
              </button>
            </form>
          )}

          {canWrite && !closed && !p.matched_mcn_creator_id && (
            <form action={creatorAction} style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 8px" }}>Data Kreator</h4>
              <Msg state={creatorState} />
              <p className="hint">
                {registeredAs
                  ? "Username ini sudah terdaftar di Data Kreator. Tautkan prospek ke data tersebut bila memang orang yang sama."
                  : "Username belum ada di Data Kreator. Buat data kreator dari prospek ini (status awal prospek) — binding_status diisi dari data binding TikTok GO."}
              </p>
              <input type="hidden" name="id" value={p.id} />
              <button type="submit" className="ghost2" disabled={creatorPending}>
                {creatorPending ? "…" : registeredAs ? "Tautkan ke Data Kreator" : "Buat Data Kreator"}
              </button>
            </form>
          )}

          {canWrite && p.status === "[Bound]" && !p.acquisition_id && (
            <form action={acqAction} style={{ marginTop: 16 }}>
              <h4 style={{ margin: "0 0 8px" }}>Catat Akuisisi (ACQ)</h4>
              <Msg state={acqState} />
              <input type="hidden" name="id" value={p.id} />
              <label>Tanggal Binding *</label>
              <input type="date" name="binding_date" required />
              <button type="submit" className="ghost2" disabled={acqPending}>
                {acqPending ? "…" : "Catat Akuisisi (inbound)"}
              </button>
            </form>
          )}
        </div>
        <div className="modal-foot">
          {canPortal ? (
            <PortalAccessButton
              kind="creator"
              sourceId={p.id}
              label={p.nama}
              resend={!!creator?.auth_user_id}
            />
          ) : (
            <span className="muted" style={{ fontSize: 12 }}>
              {closed
                ? "Prospek ditutup — tidak ada akses portal."
                : "Akses portal tersedia setelah prospek Bound & binding_status Bound creators."}
            </span>
          )}
          <button type="button" className="ghost2" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
