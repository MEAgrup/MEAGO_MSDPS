"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  createCrmLead,
  updateCrmLeadStatus,
  updateCrmLeadProfile,
  importCrmLeadsBulk,
  deleteCrmLead,
  type ActionResult,
} from "@/lib/actions/crm-leads";
import {
  APPROACH_VIA,
  BENEFIT_DEALING,
  CRM_SOURCES,
  CRM_STATUSES,
  CRM_STATUS_CLASS,
  CRM_STATUS_NEXT,
  DEAL_STATUSES,
  HASIL_APPROACH,
  JENIS_USAHA_PRESETS,
  KATEGORI_BRAND,
  MANUAL,
  WILAYAH,
  type CrmStatus,
  type KategoriBrand,
} from "@/lib/crm/options";
import type { CrmLeadRow, EmployeeOption } from "@/lib/crm/types";
import { rupiah } from "@/lib/format";
import { waktuJakarta } from "@/lib/crm/waktu";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

export function statusBadge(status: string) {
  const cls = CRM_STATUS_CLASS[status as CrmStatus] ?? "gray";
  return <span className={`badge ${cls}`}>{status}</span>;
}

// Select karyawan + opsi "Tambah Manual…" (nama BD/OPS bisa orang luar direktori).
function EmployeePicker({
  namePrefix,
  employees,
  label,
  defaultId,
  defaultManual,
  required,
}: {
  namePrefix: "bd" | "ops";
  employees: EmployeeOption[];
  label: string;
  defaultId?: string | null;
  defaultManual?: string;
  required?: boolean;
}) {
  const initial = defaultId ?? (defaultManual ? MANUAL : "");
  const [pick, setPick] = useState(initial);
  return (
    <div>
      <label>
        {label} {required && "*"}
      </label>
      <select
        name={`${namePrefix}_pick`}
        value={pick}
        onChange={(e) => setPick(e.target.value)}
        required={required}
      >
        <option value="" disabled>
          — pilih nama —
        </option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.full_name} · {e.division}
          </option>
        ))}
        <option value={MANUAL}>Tambah Manual…</option>
      </select>
      {pick === MANUAL && (
        <input
          name={`nama_${namePrefix}_manual`}
          placeholder="Ketik nama manual"
          defaultValue={defaultManual ?? ""}
          required
        />
      )}
    </div>
  );
}

// Kategori brand + jenis usaha yang opsinya mengikuti kategori (adjustJenisUsahaOptions).
function KategoriJenisUsaha({
  defaultKategori,
  defaultJenis,
}: {
  defaultKategori?: string;
  defaultJenis?: string | null;
}) {
  const initialKategori = (KATEGORI_BRAND as readonly string[]).includes(defaultKategori ?? "")
    ? (defaultKategori as KategoriBrand)
    : "Accommodation";
  const [kategori, setKategori] = useState<KategoriBrand>(initialKategori);

  const presets = JENIS_USAHA_PRESETS[kategori];
  const jenisIsPreset = !!defaultJenis && presets.includes(defaultJenis);
  const [jenis, setJenis] = useState<string>(
    defaultJenis ? (jenisIsPreset ? defaultJenis : MANUAL) : ""
  );

  // Ganti kategori -> daftar jenis usaha berubah, pilihan lama direset supaya
  // tidak ada kombinasi kategori/jenis yang tidak masuk akal.
  function onKategoriChange(next: KategoriBrand) {
    setKategori(next);
    setJenis("");
  }

  return (
    <div className="row">
      <div>
        <label>Kategori Brand *</label>
        <select
          name="kategori_brand"
          value={kategori}
          onChange={(e) => onKategoriChange(e.target.value as KategoriBrand)}
          required
        >
          {KATEGORI_BRAND.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label>Jenis Usaha</label>
        <select name="jenis_usaha" value={jenis} onChange={(e) => setJenis(e.target.value)}>
          <option value="">— pilih jenis usaha —</option>
          {presets.map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
          <option value={MANUAL}>Tambah Manual…</option>
        </select>
        {jenis === MANUAL && (
          <input
            name="jenis_usaha_manual"
            placeholder="Ketik jenis usaha manual"
            defaultValue={jenisIsPreset ? "" : defaultJenis ?? ""}
            required
          />
        )}
      </div>
    </div>
  );
}

// Bagian form yang identik antara "Forms Leads Masuk" dan "Edit Data Lead".
function LeadFields({
  employees,
  lead,
}: {
  employees: EmployeeOption[];
  lead?: CrmLeadRow;
}) {
  return (
    <>
      <div className="row">
        <EmployeePicker
          namePrefix="bd"
          employees={employees}
          label="Nama BD"
          required
          defaultId={lead?.bd_id}
          defaultManual={lead && !lead.bd_id ? lead.nama_bd : undefined}
        />
        <div>
          <label>Brand / Merchant / POI *</label>
          <input
            name="brand"
            required
            placeholder="Contoh: Hotel Mercure Ubud, Cafe Kenangan"
            defaultValue={lead?.brand ?? ""}
          />
        </div>
      </div>

      <KategoriJenisUsaha
        defaultKategori={lead?.kategori_brand}
        defaultJenis={lead?.jenis_usaha}
      />

      <div className="row">
        <div>
          <label>Source</label>
          <select name="source" defaultValue={lead?.source ?? ""}>
            <option value="">— pilih source —</option>
            {CRM_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Wilayah (Provinsi)</label>
          <select name="wilayah" defaultValue={lead?.wilayah ?? ""}>
            <option value="">— pilih provinsi —</option>
            {WILAYAH.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div>
          <label>Nama &amp; Posisi PIC</label>
          <input
            name="nama_pic"
            placeholder="Contoh: Budi (Marketing)"
            defaultValue={lead?.nama_pic ?? ""}
          />
        </div>
        <div>
          <label>Kontak PIC (HP)</label>
          <input
            name="kontak_pic"
            placeholder="08xx atau 62xx — disimpan sebagai 62xx"
            defaultValue={lead?.kontak_pic ?? ""}
          />
        </div>
      </div>

      <label>Website / Akun Sosmed</label>
      <input
        name="website_socmed"
        placeholder="https://instagram.com/brand"
        defaultValue={lead?.website_socmed ?? ""}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// 1. FORMS LEADS MASUK
// ---------------------------------------------------------------------------
export function FormsLeadsMasuk({ employees }: { employees: EmployeeOption[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createCrmLead,
    null
  );
  // key bertambah setiap sukses -> form di-remount sehingga field kosong lagi
  // dan BD berikutnya bisa langsung input lead baru.
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (state?.ok) setFormKey((k) => k + 1);
  }, [state]);

  return (
    <form action={action} key={formKey}>
      <Msg state={state} />
      <p className="section-sub">
        Tanggal scouting, ID lead (<span className="mono">CRM-…</span>), dan status awal
        <b> Leads</b> diisi otomatis oleh sistem.
      </p>
      <LeadFields employees={employees} />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan Leads"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// 2. UPDATE STATUS
// ---------------------------------------------------------------------------
// Blok Benefit / Nominal / Kontrak / Notes hanya aktif untuk status Dealing &
// Renewal — persis toggleBenefitField() pada web app lama.
function UpdateStatusFields({ lead }: { lead: CrmLeadRow }) {
  const targets = CRM_STATUS_NEXT[lead.status as CrmStatus] ?? [];
  const [status, setStatus] = useState<string>(targets[0] ?? lead.status);
  const isDeal = DEAL_STATUSES.includes(status as CrmStatus);

  const benefitIsPreset =
    !!lead.benefit_dealing && (BENEFIT_DEALING as readonly string[]).includes(lead.benefit_dealing);
  const [benefit, setBenefit] = useState<string>(
    lead.benefit_dealing ? (benefitIsPreset ? lead.benefit_dealing : MANUAL) : ""
  );

  const [mulai, setMulai] = useState(lead.tanggal_mulai_kontrak ?? "");
  const [akhir, setAkhir] = useState(lead.tanggal_akhir_kontrak ?? "");
  const totalHari = useMemo(() => {
    if (!mulai || !akhir) return 0;
    const ms = new Date(akhir).getTime() - new Date(mulai).getTime();
    if (Number.isNaN(ms) || ms < 0) return 0;
    return Math.round(ms / 86_400_000) + 1;
  }, [mulai, akhir]);

  if (targets.length === 0) {
    return (
      <p className="muted">
        Tidak ada transisi status yang tersedia dari <b>{lead.status}</b>.
      </p>
    );
  }

  return (
    <>
      <div className="row">
        <div>
          <label>Status Baru *</label>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} required>
            {targets.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="hint">
            Dari <b>{lead.status}</b>. Alur normal: Leads → Approaching → Follow Up →
            Dealing/Rejected.
          </div>
        </div>
        <div>
          <label>Approach Via</label>
          <select name="approach_via" defaultValue={lead.approach_via ?? ""}>
            <option value="">— pilih media approach —</option>
            {APPROACH_VIA.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label>Hasil Approach</label>
      <select name="hasil_approach" defaultValue={lead.hasil_approach ?? ""}>
        <option value="">— pilih respon merchant —</option>
        {HASIL_APPROACH.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>

      {isDeal && (
        <div className="subcard">
          <h3>Data Dealing &amp; Kontrak</h3>
          <label>Benefit Dealing *</label>
          <select
            name="benefit_dealing"
            value={benefit}
            onChange={(e) => setBenefit(e.target.value)}
            required
          >
            <option value="" disabled>
              — pilih benefit dealing —
            </option>
            {BENEFIT_DEALING.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
            <option value={MANUAL}>Input Manual (Kustom)…</option>
          </select>
          {benefit === MANUAL && (
            <input
              name="benefit_dealing_manual"
              placeholder="Ketik benefit kustom"
              defaultValue={benefitIsPreset ? "" : lead.benefit_dealing ?? ""}
              required
            />
          )}

          <label>Nominal Bayar *</label>
          <input
            name="nominal_bayar"
            type="number"
            min={0}
            step={1}
            defaultValue={lead.nominal_bayar ?? 0}
            required
          />
          <div className="hint">Dealing gratis / barter value: isi 0.</div>

          <div className="row" style={{ marginTop: 12 }}>
            <div>
              <label>Tanggal Awal Kontrak (opsional)</label>
              <input
                name="tanggal_mulai_kontrak"
                type="date"
                value={mulai}
                onChange={(e) => setMulai(e.target.value)}
              />
            </div>
            <div>
              <label>Tanggal Akhir Kontrak (opsional)</label>
              <input
                name="tanggal_akhir_kontrak"
                type="date"
                value={akhir}
                onChange={(e) => setAkhir(e.target.value)}
              />
            </div>
          </div>
          <div className="hint">
            Total durasi: <b>{totalHari}</b> hari. Isi keduanya atau kosongkan keduanya.
          </div>

          <label style={{ marginTop: 12 }}>Notes (opsional)</label>
          <textarea
            name="notes_kontrak"
            rows={3}
            placeholder="Catatan tambahan kontrak / dealing"
            defaultValue={lead.notes_kontrak ?? ""}
          />
        </div>
      )}
    </>
  );
}

// Modal Update Status per baris tabel.
export function UpdateStatusModal({ lead }: { lead: CrmLeadRow }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateCrmLeadStatus,
    null
  );
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button className="sm" type="button" onClick={() => setOpen(true)}>
        Update Status
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                Update Status · {lead.brand} {statusBadge(lead.status)}
              </h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                <Msg state={state} />
                <input type="hidden" name="id" value={lead.id} />
                <UpdateStatusFields lead={lead} />
              </div>
              <div className="modal-foot">
                <button type="button" className="ghost2" onClick={() => setOpen(false)}>
                  Batal
                </button>
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Update Status"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// Modal edit data lead (tanpa status).
export function EditLeadModal({
  lead,
  employees,
}: {
  lead: CrmLeadRow;
  employees: EmployeeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateCrmLeadProfile,
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
              <h3>Edit Data Lead{lead.code ? ` · ${lead.code}` : ""}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                <Msg state={state} />
                <input type="hidden" name="id" value={lead.id} />
                <LeadFields employees={employees} lead={lead} />
              </div>
              <div className="modal-foot">
                <button type="button" className="ghost2" onClick={() => setOpen(false)}>
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

function DeleteLeadButton({ lead }: { lead: CrmLeadRow }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    deleteCrmLead,
    null
  );
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Hapus lead "${lead.brand}"? Tindakan ini tidak bisa dibatalkan.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="id" value={lead.id} />
      <button className="sm ghost2" disabled={pending}>
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

// ---------------------------------------------------------------------------
// 3. IMPORT BULK LEADS
// ---------------------------------------------------------------------------
export function ImportBulkLeadsForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    importCrmLeadsBulk,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <label>
        Satu lead per baris — pemisah tab, titik-koma, atau koma. Urutan kolom:
        <span className="mono">
          {" "}
          nama_bd, brand, kategori_brand, wilayah, jenis_usaha, source, nama_pic, kontak_pic,
          website
        </span>
      </label>
      <textarea
        name="bulk"
        rows={7}
        required
        placeholder={
          "Ajeng;Hotel Mercure Ubud;Accommodation;Bali;ACC - Hotel;Event;Budi (Marketing);08123456789;https://instagram.com/mercureubud\n" +
          "Rafli;Cafe Kenangan;Dining;DKI Jakarta;Dining - Café;Referral Partner;Sri;081298765432;"
        }
      />
      <div className="hint">
        Hanya <b>nama_bd</b> dan <b>brand</b> yang wajib. Kategori brand di luar
        Accommodation/Dining/TTD otomatis jadi Accommodation. Semua baris masuk dengan status
        awal <b>Leads</b>.
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Mengimpor…" : "Impor Bulk Leads"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Kartu aksi bertab: Forms Leads Masuk / Import Bulk
// ---------------------------------------------------------------------------
export function LeadActionTabs({ employees }: { employees: EmployeeOption[] }) {
  const [tab, setTab] = useState<"form" | "import">("form");
  return (
    <div className="card">
      <div className="actions-row" style={{ marginBottom: 14 }}>
        <button
          type="button"
          className={tab === "form" ? "sm" : "sm ghost2"}
          onClick={() => setTab("form")}
        >
          Forms Leads Masuk
        </button>
        <button
          type="button"
          className={tab === "import" ? "sm" : "sm ghost2"}
          onClick={() => setTab("import")}
        >
          Import Bulk Leads
        </button>
      </div>
      {tab === "form" ? <FormsLeadsMasuk employees={employees} /> : <ImportBulkLeadsForm />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabel leads + wildcard search & filter status
// ---------------------------------------------------------------------------
export function CrmLeadsTable({
  leads,
  employees,
  trxCountByLead,
  canWrite,
  canDelete,
}: {
  leads: CrmLeadRow[];
  employees: EmployeeOption[];
  trxCountByLead: Record<string, number>;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [bd, setBd] = useState("");

  const bdNames = useMemo(
    () => [...new Set(leads.map((l) => l.nama_bd))].sort((a, b) => a.localeCompare(b)),
    [leads]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (status && l.status !== status) return false;
      if (bd && l.nama_bd !== bd) return false;
      if (!needle) return true;
      return [l.brand, l.code, l.nama_pic, l.kontak_pic, l.wilayah, l.jenis_usaha]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [leads, q, status, bd]);

  return (
    <div className="card">
      <h2>Daftar Leads ({filtered.length} dari {leads.length})</h2>
      <div className="inline-form" style={{ marginBottom: 14 }}>
        <div style={{ flex: "1 1 240px" }}>
          <label>Wildcard search</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Brand, kode, PIC, kontak, wilayah…"
          />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }}>
            <option value="">Semua status</option>
            {CRM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Nama BD</label>
          <select value={bd} onChange={(e) => setBd(e.target.value)} style={{ width: 160 }}>
            <option value="">Semua BD</option>
            {bdNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Brand / POI</th>
              <th>Kategori · Jenis</th>
              <th>BD</th>
              <th>Wilayah</th>
              <th>PIC</th>
              <th>Status</th>
              <th>Dealing</th>
              <th>Update</th>
              {canWrite && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((l) => {
              const trx = trxCountByLead[l.id] ?? 0;
              const isDeal = DEAL_STATUSES.includes(l.status as CrmStatus);
              return (
                <tr key={l.id}>
                  <td className="mono">{l.code ?? "—"}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{l.brand}</div>
                    {l.website_socmed && (
                      <a
                        href={l.website_socmed}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mono"
                      >
                        link
                      </a>
                    )}
                  </td>
                  <td>
                    <span className="badge slate">{l.kategori_brand}</span>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {l.jenis_usaha ?? "—"}
                    </div>
                  </td>
                  <td>{l.nama_bd}</td>
                  <td className="muted">{l.wilayah ?? "—"}</td>
                  <td>
                    {l.nama_pic ?? "—"}
                    <div className="mono">{l.kontak_pic ?? "—"}</div>
                  </td>
                  <td>
                    {statusBadge(l.status)}
                    {l.hasil_approach && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {l.approach_via ? `${l.approach_via} · ` : ""}
                        {l.hasil_approach}
                      </div>
                    )}
                  </td>
                  <td>
                    {isDeal ? (
                      <>
                        <div>{rupiah(l.nominal_bayar)}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {l.benefit_dealing ?? "—"}
                        </div>
                        {trx === 0 ? (
                          <span className="badge amber">belum ada transaksi</span>
                        ) : (
                          <span className="badge green">{trx} transaksi</span>
                        )}
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="muted" style={{ fontSize: 11 }}>
                    {waktuJakarta(l.tanggal_update_status)}
                  </td>
                  {canWrite && (
                    <td>
                      <div className="actions-row">
                        <UpdateStatusModal lead={l} />
                        <EditLeadModal lead={l} employees={employees} />
                        {canDelete && <DeleteLeadButton lead={l} />}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canWrite ? 10 : 9} className="muted">
                  {leads.length === 0
                    ? "Belum ada lead. Gunakan Forms Leads Masuk di atas."
                    : "Tidak ada lead yang cocok dengan filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
