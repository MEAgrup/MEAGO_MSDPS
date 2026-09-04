"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { rupiah, tanggal } from "@/lib/format";
import {
  deleteLead,
  deleteLeadsBulk,
  updateLeadFields,
  updateLeadStatus,
  type ActionResult,
} from "@/lib/actions/leads";
import {
  APPROACH_VIA,
  CRM_STATUSES,
  HASIL_APPROACH,
  RENEWAL_REQUIRES_STATUS,
  WILAYAH,
  isDealStatus,
  type BrandCategory,
  type CrmStatus,
} from "@/lib/leads/intake";
import { IntakeFormFields, type BdOption, type BusinessTypeOptions } from "./intake-fields";
import { ClaimButton } from "./forms";
import { RegisterDealModal } from "../deals/forms";
import { exportRowsToExcel } from "@/lib/xlsx-export";

export type PoolLead = {
  id: string;
  code: string | null;
  lead_name: string;
  brand_name: string | null;
  bd_employee_id: string | null;
  brand_category: string | null;
  business_type: string | null;
  wilayah: string | null;
  source: string | null;
  pic_name_position: string | null;
  pic_phone: string | null;
  web_socmed_link: string | null;
  phone_normalized: string | null;
  status: string;
  stale: boolean;
  crm_status: string;
  benefit_dealing: string | null;
  nominal_bayar: number;
  tanggal_mulai_kontrak: string | null;
  tanggal_akhir_kontrak: string | null;
  created_at: string;
};

const CRM_STATUS_CLASS: Record<string, string> = {
  Leads: "slate",
  Approaching: "blue",
  "Follow Up": "amber",
  Dealing: "green",
  Rejected: "red",
  Renewal: "indigo",
};

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

// LeadPicker — combobox "Pilih Brand / Merchant": ketik untuk hot search, daftar
// pra-urut A-Z. Native <select> tidak cukup untuk daftar besar + pencarian, jadi
// dibuat manual (tanpa library — konsisten dengan sisa app yang plain React).
// Diekspor supaya dipakai ulang oleh Merchant Deals (pemilihan POI/Merchant
// Dealing/Renewal) — hidden input name selalu "lead_id".
export function LeadPicker({
  leads,
  value,
  onChange,
}: {
  leads: PoolLead[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [openList, setOpenList] = useState(false);
  const sorted = useMemo(
    () =>
      [...leads].sort((a, b) =>
        (a.brand_name ?? a.lead_name).localeCompare(b.brand_name ?? b.lead_name)
      ),
    [leads]
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((l) => (l.brand_name ?? l.lead_name).toLowerCase().includes(q));
  }, [sorted, query]);
  const selected = leads.find((l) => l.id === value);

  return (
    <div className="combobox-wrap">
      <input
        type="text"
        placeholder="Cari brand / merchant…"
        value={openList ? query : (selected?.brand_name ?? selected?.lead_name ?? "")}
        onFocus={() => {
          setOpenList(true);
          setQuery("");
        }}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => setTimeout(() => setOpenList(false), 150)}
      />
      <input type="hidden" name="lead_id" value={value} required />
      {openList && (
        <div className="combobox-list">
          {filtered.map((l) => (
            <div
              key={l.id}
              className="combobox-item"
              onMouseDown={() => {
                onChange(l.id);
                setOpenList(false);
              }}
            >
              {l.brand_name ?? l.lead_name}{" "}
              <span className="muted">
                {l.code ?? "(pending)"} · {l.crm_status}
              </span>
            </div>
          ))}
          {filtered.length === 0 && <div className="combobox-item muted">Tidak ditemukan</div>}
        </div>
      )}
    </div>
  );
}

// UpdateStatusButton — modal alur status CRM. Dipakai dalam dua mode: global
// (tombol di toolbar tabel, brand dipilih lewat LeadPicker) dan per-baris
// (tombol "Update" di kolom Aksi, `fixedLead` mengunci brand ke baris itu).
// Renewal hanya aktif dipilih kalau lead terpilih berstatus Dealing; Benefit
// Dealing / Nominal Bayar / Durasi Kontrak hanya muncul untuk Dealing/Renewal
// (DEAL_STATUSES).
export function UpdateStatusButton({
  leads,
  benefitOptions,
  fixedLead,
}: {
  leads: PoolLead[];
  benefitOptions: string[];
  fixedLead?: PoolLead;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateLeadStatus,
    null
  );
  const [leadId, setLeadId] = useState(fixedLead?.id ?? "");
  const [status, setStatus] = useState<CrmStatus | "">("");
  const selected = fixedLead ?? leads.find((l) => l.id === leadId);
  const isDeal = status !== "" && isDealStatus(status);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setLeadId(fixedLead?.id ?? "");
      setStatus("");
    }
  }, [state, fixedLead]);

  return (
    <>
      <button
        type="button"
        className={fixedLead ? "sm ghost2" : undefined}
        onClick={() => setOpen(true)}
      >
        {fixedLead ? "Update" : "Update Status Leads"}
      </button>
      {open && (
        <div
          className="modal-backdrop"
          onClick={() => {
            setOpen(false);
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Update Status Leads{fixedLead ? ` · ${fixedLead.brand_name ?? fixedLead.lead_name}` : ""}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                {state && !state.ok && <div className="err">{state.message}</div>}

                <label>Pilih Brand / Merchant *</label>
                {fixedLead ? (
                  <input type="hidden" name="lead_id" value={fixedLead.id} />
                ) : (
                  <LeadPicker leads={leads} value={leadId} onChange={setLeadId} />
                )}
                {selected && (
                  <p className="hint">
                    {fixedLead && <b>{fixedLead.brand_name ?? fixedLead.lead_name}</b>}
                    {fixedLead && " — "}
                    Status saat ini: <b>{selected.crm_status}</b>
                  </p>
                )}

                <label>Status Baru *</label>
                <select
                  name="crm_status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as CrmStatus)}
                  required
                >
                  <option value="" disabled>
                    Pilih status…
                  </option>
                  {CRM_STATUSES.map((s) => (
                    <option
                      key={s}
                      value={s}
                      disabled={s === "Renewal" && selected?.crm_status !== RENEWAL_REQUIRES_STATUS}
                    >
                      {s}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  Alur normal: Leads → Approaching → Follow Up → Dealing/Rejected. &quot;Renewal&quot;
                  hanya dapat dipilih dari status Dealing.
                </p>

                <div className="row">
                  <div>
                    <label>Approach Via</label>
                    <select name="approach_via" defaultValue="">
                      <option value="">— pilih —</option>
                      {APPROACH_VIA.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Hasil Approach</label>
                    <select name="hasil_approach" defaultValue="">
                      <option value="">— pilih —</option>
                      {HASIL_APPROACH.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {isDeal && (
                  <>
                    <label>Benefit Dealing *</label>
                    <input name="benefit_dealing" list="benefit-dealing-options" required />
                    <datalist id="benefit-dealing-options">
                      {benefitOptions.map((b) => (
                        <option key={b} value={b} />
                      ))}
                    </datalist>

                    <label>Nominal Bayar *</label>
                    <input name="nominal_bayar" type="number" min="0" step="1" required />
                    <p className="hint">Jika barter atau free dapat tuliskan 0.</p>
                  </>
                )}

                <div className="row">
                  <div>
                    <label>Tanggal Awal Kontrak</label>
                    <input type="date" name="tanggal_mulai_kontrak" />
                  </div>
                  <div>
                    <label>Tanggal Akhir Kontrak</label>
                    <input type="date" name="tanggal_akhir_kontrak" />
                  </div>
                </div>

                <label>Notes</label>
                <textarea name="notes" rows={3} />
              </div>
              <div className="modal-foot">
                <button type="button" className="ghost2" onClick={() => setOpen(false)} disabled={pending}>
                  Batal
                </button>
                <button type="submit" disabled={pending || !leadId || !status}>
                  {pending ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// EditLeadModal — tombol "Edit" per baris di kolom Aksi. Mengedit field intake
// (bukan status — itu lewat UpdateStatusButton).
function EditLeadModal({
  lead,
  bdOptions,
  businessTypeOptions,
}: {
  lead: PoolLead;
  bdOptions: BdOption[];
  businessTypeOptions: BusinessTypeOptions;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateLeadFields,
    null
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button type="button" className="sm ghost2" onClick={() => setOpen(true)}>
        Edit
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Edit Lead{lead.code ? ` · ${lead.code}` : ""}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                {state && !state.ok && <div className="err">{state.message}</div>}
                <input type="hidden" name="lead_id" value={lead.id} />
                <IntakeFormFields
                  idPrefix={`edit-${lead.id}`}
                  bdOptions={bdOptions}
                  businessTypeOptions={businessTypeOptions}
                  defaults={{
                    bd_employee_id: lead.bd_employee_id ?? "",
                    brand_name: lead.brand_name ?? lead.lead_name,
                    brand_category: (lead.brand_category as BrandCategory | null) ?? "",
                    business_type: lead.business_type ?? "",
                    wilayah: lead.wilayah ?? "",
                    source: lead.source ?? "",
                    pic_name_position: lead.pic_name_position ?? "",
                    pic_phone: lead.pic_phone ?? "",
                    web_socmed_link: lead.web_socmed_link ?? "",
                  }}
                />
              </div>
              <div className="modal-foot">
                <button type="button" className="ghost2" onClick={() => setOpen(false)} disabled={pending}>
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

// DeleteLeadButton — lead yang sudah pernah "diambil" BD (ClaimButton) punya
// baris prospect_attempts anak; DB menolak delete-nya (FK 23503). Saat itu
// terjadi, deleteLead mengembalikan requiresForce=true — tombol kedua "Hapus +
// Prospek Terkait" muncul untuk mengirim ulang aksi yang sama dengan force=1
// (menghapus prospect_attempts anak lebih dulu, baru lead-nya).
function DeleteLeadButton({ leadId, label }: { leadId: string; label: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteLead, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const isForce = submitter?.name === "force";
        const msg = isForce
          ? `Hapus lead "${label}" beserta SELURUH prospek terkait? Tindakan ini tidak dapat dibatalkan.`
          : `Hapus lead "${label}"? Tindakan ini tidak dapat dibatalkan.`;
        if (!confirm(msg)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="lead_id" value={leadId} />
      <div className="inline-form">
        <button className="sm dangerbtn" disabled={pending}>
          {pending ? "…" : "Hapus"}
        </button>
        {state?.requiresForce && (
          <button className="sm dangerbtn" name="force" value="1" disabled={pending}>
            {pending ? "…" : "Hapus + Prospek Terkait"}
          </button>
        )}
      </div>
      {state && !state.ok && (
        <div className="err" style={{ marginTop: 4, marginBottom: 0, maxWidth: 280 }}>
          {state.message}
        </div>
      )}
    </form>
  );
}

function BulkDeleteBar({ ids }: { ids: string[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    deleteLeadsBulk,
    null
  );
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const isForce = submitter?.name === "force";
        const msg = isForce
          ? `Hapus ${ids.length} lead terpilih beserta SELURUH prospek terkait? Tindakan ini tidak dapat dibatalkan.`
          : `Hapus ${ids.length} lead terpilih? Tindakan ini tidak dapat dibatalkan.`;
        if (!confirm(msg)) {
          e.preventDefault();
        }
      }}
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="lead_ids" value={id} />
      ))}
      <div className="inline-form">
        <button className="sm dangerbtn" disabled={pending || ids.length === 0}>
          {pending ? "Menghapus…" : `Hapus ${ids.length} Terpilih`}
        </button>
        {state?.requiresForce && (
          <button className="sm dangerbtn" name="force" value="1" disabled={pending}>
            {pending ? "Menghapus…" : "Hapus + Prospek Terkait"}
          </button>
        )}
      </div>
      {state && <Msg state={state} />}
    </form>
  );
}

type SortKey = "code" | "brand" | "bd" | "business_type" | "wilayah" | "crm_status";
type SortDir = "asc" | "desc";
const PAGE_SIZES = [10, 50, 100] as const;

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className="sortable" onClick={() => onSort(sortKey)}>
      {label} {active === sortKey ? (dir === "asc" ? "▲" : "▼") : ""}
    </th>
  );
}

// PoolLeadSection — tabel Pool Lead: sort per kolom, filter (brand wildcard,
// jenis usaha, wilayah, PIC & kontak, status), paginasi 10/50/100, pilih baris
// untuk hapus massal, dan aksi Edit/Hapus per baris.
export function PoolLeadSection({
  leads,
  bdOptions,
  bdNameById,
  businessTypeOptions,
  benefitOptions,
  recordedLeadIds,
  isBizDev,
  canManage,
}: {
  leads: PoolLead[];
  bdOptions: BdOption[];
  bdNameById: Record<string, string>;
  businessTypeOptions: BusinessTypeOptions;
  benefitOptions: string[];
  recordedLeadIds: Set<string>;
  isBizDev: boolean;
  canManage: boolean;
}) {
  const [brandQuery, setBrandQuery] = useState("");
  const [jenisFilter, setJenisFilter] = useState("");
  const [wilayahFilter, setWilayahFilter] = useState("");
  const [picQuery, setPicQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dealingNotificationOpen, setDealingNotificationOpen] = useState(true);
  const [notifQuery, setNotifQuery] = useState("");
  const [notifPage, setNotifPage] = useState(1);

  const jenisUsahaValues = useMemo(
    () => Array.from(new Set(leads.map((l) => l.business_type).filter((v): v is string => !!v))).sort(),
    [leads]
  );

  const filtered = useMemo(() => {
    const brandQ = brandQuery.trim().toLowerCase();
    const picQ = picQuery.trim().toLowerCase();
    return leads.filter((l) => {
      const brand = (l.brand_name ?? l.lead_name).toLowerCase();
      if (brandQ && !brand.includes(brandQ)) return false;
      if (jenisFilter && l.business_type !== jenisFilter) return false;
      if (wilayahFilter && l.wilayah !== wilayahFilter) return false;
      if (statusFilter && l.crm_status !== statusFilter) return false;
      if (picQ) {
        const hay = `${l.pic_name_position ?? ""} ${l.pic_phone ?? ""}`.toLowerCase();
        if (!hay.includes(picQ)) return false;
      }
      return true;
    });
  }, [leads, brandQuery, jenisFilter, wilayahFilter, statusFilter, picQuery]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (l: PoolLead): string => {
      switch (sortKey) {
        case "code":
          return l.code ?? "";
        case "brand":
          return l.brand_name ?? l.lead_name;
        case "bd":
          return (l.bd_employee_id && bdNameById[l.bd_employee_id]) ?? "";
        case "business_type":
          return l.business_type ?? "";
        case "wilayah":
          return l.wilayah ?? "";
        case "crm_status":
          return l.crm_status;
      }
    };
    return [...filtered].sort((a, b) => val(a).localeCompare(val(b)) * dir);
  }, [filtered, sortKey, sortDir, bdNameById]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, pageCount);
  const paginated = sorted.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  function onSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pageIds = paginated.map((l) => l.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAllOnPage() {
    setSelected((s) => {
      const next = new Set(s);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  // Brand yang sudah tercatat transaksinya (brand_deals.lead_id) hilang dari
  // notifikasi — sudah tidak perlu ditindaklanjuti lewat "Catat Transaksi".
  const dealingLeads = leads.filter((l) => l.crm_status === "Dealing" && !recordedLeadIds.has(l.id));

  // Hot search wildcard: kode brand (ID) atau nama BD (BDM PIC).
  const notifFiltered = useMemo(() => {
    const q = notifQuery.trim().toLowerCase();
    if (!q) return dealingLeads;
    return dealingLeads.filter((l) => {
      const bd = (l.bd_employee_id && bdNameById[l.bd_employee_id]) ?? "";
      const hay = `${l.code ?? ""} ${bd}`.toLowerCase();
      return hay.includes(q);
    });
  }, [dealingLeads, notifQuery, bdNameById]);

  const NOTIF_PAGE_SIZE = 10;
  const notifPageCount = Math.max(1, Math.ceil(notifFiltered.length / NOTIF_PAGE_SIZE));
  const notifClampedPage = Math.min(notifPage, notifPageCount);
  const notifPaginated = notifFiltered.slice(
    (notifClampedPage - 1) * NOTIF_PAGE_SIZE,
    notifClampedPage * NOTIF_PAGE_SIZE
  );

  const renderNotifTable = (rows: PoolLead[]) => (
    <div style={{ overflowX: "auto" }}>
      <table>
        <thead>
          <tr>
            <th>Kode</th>
            <th>Brand</th>
            <th>BD</th>
            <th>Benefit</th>
            <th>Nominal</th>
            <th>Periode Kontrak</th>
            <th className="right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id}>
              <td className="mono">{l.code ?? "—"}</td>
              <td>{l.brand_name ?? l.lead_name}</td>
              <td>{(l.bd_employee_id && bdNameById[l.bd_employee_id]) ?? "—"}</td>
              <td>{l.benefit_dealing ?? "—"}</td>
              <td className="right">{rupiah(l.nominal_bayar)}</td>
              <td>
                {l.tanggal_mulai_kontrak
                  ? `${tanggal(l.tanggal_mulai_kontrak)} – ${tanggal(l.tanggal_akhir_kontrak)}`
                  : "—"}
              </td>
              <td className="right">
                <RegisterDealModal
                  dealingLeads={leads}
                  bdOptions={bdOptions}
                  benefitOptions={benefitOptions}
                  fixedLead={l}
                />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                Tidak ada brand dealing yang cocok dengan pencarian.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      {dealingLeads.length > 0 && (
        <div className="card">
          <details open={dealingNotificationOpen} onToggle={(e) => setDealingNotificationOpen(e.currentTarget.open)}>
            <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 500 }}>
              📬 Notifikasi Brand Dealing ({dealingLeads.length})
            </summary>
            <div style={{ marginTop: 12 }}>
              <div className="table-toolbar">
                <div style={{ flex: 1, maxWidth: 340 }}>
                  <label>Cari ID Brand / BD</label>
                  <input
                    value={notifQuery}
                    onChange={(e) => {
                      setNotifQuery(e.target.value);
                      setNotifPage(1);
                    }}
                    placeholder="wildcard, mis. LEAD-2026 atau nama BD"
                    style={{ marginBottom: 0 }}
                  />
                </div>
              </div>
              {renderNotifTable(notifPaginated)}
              <div className="pagination">
                <div className="muted">10 baris / halaman</div>
                <div className="actions-row">
                  <button
                    type="button"
                    className="sm ghost2"
                    disabled={notifClampedPage <= 1}
                    onClick={() => setNotifPage((p) => Math.max(1, p - 1))}
                  >
                    ‹ Sebelumnya
                  </button>
                  <span className="muted" style={{ alignSelf: "center" }}>
                    Halaman {notifClampedPage} dari {notifPageCount}
                  </span>
                  <button
                    type="button"
                    className="sm ghost2"
                    disabled={notifClampedPage >= notifPageCount}
                    onClick={() => setNotifPage((p) => Math.min(notifPageCount, p + 1))}
                  >
                    Selanjutnya ›
                  </button>
                </div>
              </div>
            </div>
          </details>
        </div>
      )}

      <div className="card">
        <div className="table-toolbar">
          <h2>Pool Lead ({sorted.length})</h2>
          <div className="actions-row">
            <button
              type="button"
              className="sm ghost2"
              disabled={sorted.length === 0}
              onClick={() =>
                exportRowsToExcel(
                  "leads-prospek",
                  "Leads",
                  sorted.map((l) => ({
                    Kode: l.code ?? "",
                    "Brand / Merchant / POI": l.brand_name ?? l.lead_name,
                    BD: (l.bd_employee_id && bdNameById[l.bd_employee_id]) ?? "",
                    "Jenis Usaha": l.business_type ?? "",
                    "Kategori Brand": l.brand_category ?? "",
                    Wilayah: l.wilayah ?? "",
                    Source: l.source ?? "",
                    "PIC & Kontak": `${l.pic_name_position ?? ""} ${l.pic_phone ?? l.phone_normalized ?? ""}`.trim(),
                    Status: l.crm_status,
                    Benefit: l.benefit_dealing ?? "",
                    Nominal: l.nominal_bayar,
                    "Tanggal Dibuat": l.created_at?.slice(0, 10) ?? "",
                  }))
                )
              }
            >
              Export Excel
            </button>
            {canManage && <UpdateStatusButton leads={leads} benefitOptions={benefitOptions} />}
          </div>
        </div>

      <div className="filters-row">
        <div>
          <label>Cari Brand</label>
          <input
            value={brandQuery}
            onChange={(e) => {
              setBrandQuery(e.target.value);
              setPage(1);
            }}
            placeholder="wildcard, mis. hotel"
          />
        </div>
        <div>
          <label>Jenis Usaha</label>
          <select
            value={jenisFilter}
            onChange={(e) => {
              setJenisFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">— semua —</option>
            {jenisUsahaValues.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Wilayah</label>
          <select
            value={wilayahFilter}
            onChange={(e) => {
              setWilayahFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">— semua —</option>
            {WILAYAH.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>PIC &amp; Kontak</label>
          <input
            value={picQuery}
            onChange={(e) => {
              setPicQuery(e.target.value);
              setPage(1);
            }}
            placeholder="nama atau nomor…"
          />
        </div>
        <div>
          <label>Status</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">— semua —</option>
            {CRM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {canManage && selected.size > 0 && (
        <div style={{ marginBottom: 12 }}>
          <BulkDeleteBar ids={[...selected]} />
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              {canManage && (
                <th>
                  <input type="checkbox" checked={allPageSelected} onChange={toggleAllOnPage} />
                </th>
              )}
              <SortHeader label="Kode" sortKey="code" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Brand" sortKey="brand" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="BD" sortKey="bd" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader
                label="Jenis Usaha"
                sortKey="business_type"
                active={sortKey}
                dir={sortDir}
                onSort={onSort}
              />
              <SortHeader label="Wilayah" sortKey="wilayah" active={sortKey} dir={sortDir} onSort={onSort} />
              <th>PIC &amp; Kontak</th>
              <th>Sumber</th>
              <SortHeader label="Status" sortKey="crm_status" active={sortKey} dir={sortDir} onSort={onSort} />
              {isBizDev && <th>Ambil</th>}
              {canManage && <th className="right">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {paginated.map((l) => {
              const claimable = l.status === "[Pool]" || l.status === "[Scouted - Aktif]";
              return (
                <tr key={l.id}>
                  {canManage && (
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(l.id)}
                        onChange={() => toggleOne(l.id)}
                      />
                    </td>
                  )}
                  <td className="mono">{l.code ?? "—"}</td>
                  <td>
                    {l.brand_name ?? l.lead_name} {l.stale && <span className="badge amber">stale</span>}
                    {isDealStatus(l.crm_status) && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {l.benefit_dealing ?? "—"} · {rupiah(l.nominal_bayar)}
                        {l.tanggal_mulai_kontrak &&
                          ` · ${tanggal(l.tanggal_mulai_kontrak)}–${tanggal(l.tanggal_akhir_kontrak)}`}
                      </div>
                    )}
                  </td>
                  <td>{(l.bd_employee_id && bdNameById[l.bd_employee_id]) ?? "—"}</td>
                  <td className="muted">{l.business_type ?? "—"}</td>
                  <td className="muted">{l.wilayah ?? "—"}</td>
                  <td>
                    {l.pic_name_position ?? "—"}
                    <div className="mono" style={{ fontSize: 11 }}>
                      {l.pic_phone ?? l.phone_normalized ?? "—"}
                    </div>
                  </td>
                  <td className="muted">{l.source ?? "—"}</td>
                  <td>
                    <span className={`badge ${CRM_STATUS_CLASS[l.crm_status] ?? "gray"}`}>{l.crm_status}</span>
                  </td>
                  {isBizDev && (
                    <td>{claimable ? <ClaimButton leadId={l.id} /> : <span className="muted">—</span>}</td>
                  )}
                  {canManage && (
                    <td className="right">
                      <div className="actions-row" style={{ justifyContent: "flex-end" }}>
                        <UpdateStatusButton leads={leads} benefitOptions={benefitOptions} fixedLead={l} />
                        <EditLeadModal lead={l} bdOptions={bdOptions} businessTypeOptions={businessTypeOptions} />
                        <DeleteLeadButton leadId={l.id} label={l.brand_name ?? l.lead_name} />
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {paginated.length === 0 && (
              <tr>
                <td
                  colSpan={5 + (canManage ? 2 : 0) + (isBizDev ? 1 : 0)}
                  className="muted"
                >
                  Tidak ada lead yang cocok dengan filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <div>
          Tampilkan{" "}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
              setPage(1);
            }}
            style={{ width: "auto", display: "inline-block", marginBottom: 0 }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>{" "}
          baris
        </div>
        <div className="actions-row">
          <button
            type="button"
            className="sm ghost2"
            disabled={clampedPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹ Sebelumnya
          </button>
          <span className="muted" style={{ alignSelf: "center" }}>
            Halaman {clampedPage} dari {pageCount}
          </span>
          <button
            type="button"
            className="sm ghost2"
            disabled={clampedPage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Selanjutnya ›
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
