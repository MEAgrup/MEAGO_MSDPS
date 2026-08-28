"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  createCrmTransaksi,
  updateCrmTransaksi,
  importCrmTransaksiBulk,
  deleteCrmTransaksi,
  type ActionResult,
} from "@/lib/actions/crm-transaksi";
import {
  BENEFIT_DIBERIKAN,
  BENTUK_KERJASAMA,
  KATEGORI_BRAND,
  KATEGORI_WAJIB_DURASI,
  MANUAL,
  type KategoriBrand,
} from "@/lib/crm/options";
import type { CrmTransaksiRow, EmployeeOption, PoiOption } from "@/lib/crm/types";
import { rupiah, num, tanggal } from "@/lib/format";
import { isoToJakartaInput, waktuJakarta } from "@/lib/crm/waktu";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

// Hanya lead Dealing/Renewal yang boleh dipakai transaksi baru. Form Edit tetap
// menerima daftar penuh supaya transaksi lama tidak "kehilangan" POI-nya kalau
// status leadnya sudah bergeser setelah transaksi dicatat.
export function poiSiapTransaksi(poiOptions: PoiOption[]): PoiOption[] {
  return poiOptions.filter((p) => p.status === "Dealing" || p.status === "Renewal");
}

function EmployeePicker({
  namePrefix,
  employees,
  label,
  value,
  onChange,
  manualDefault,
}: {
  namePrefix: "bd" | "ops";
  employees: EmployeeOption[];
  label: string;
  value: string;
  onChange: (v: string) => void;
  manualDefault?: string;
}) {
  return (
    <div>
      <label>{label} *</label>
      <select
        name={`${namePrefix}_pick`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required
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
      {value === MANUAL && (
        // key = manualDefault: ganti POI (yang ikut mengganti nama BD bawaan) harus
        // memuat ulang input, karena defaultValue tidak ikut berubah pada remount-less
        // render.
        <input
          key={manualDefault ?? ""}
          name={`nama_${namePrefix}_manual`}
          placeholder="Ketik nama manual"
          defaultValue={manualDefault ?? ""}
          required
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FORM PENDATAAN TRANSAKSI (create & edit memakai field yang sama)
// ---------------------------------------------------------------------------
function TransaksiFields({
  poiOptions,
  employees,
  trx,
}: {
  poiOptions: PoiOption[];
  employees: EmployeeOption[];
  trx?: CrmTransaksiRow;
}) {
  const [search, setSearch] = useState("");
  const [leadId, setLeadId] = useState(trx?.crm_lead_id ?? "");

  const [kategori, setKategori] = useState<KategoriBrand>(
    ((KATEGORI_BRAND as readonly string[]).includes(trx?.kategori_poi ?? "")
      ? trx?.kategori_poi
      : "Accommodation") as KategoriBrand
  );
  const [namaPic, setNamaPic] = useState(trx?.nama_pic_poi ?? "");
  const [kontakWa, setKontakWa] = useState(trx?.kontak_wa ?? "");
  const [bdPick, setBdPick] = useState(trx?.bd_id ?? (trx && !trx.bd_id ? MANUAL : ""));
  const [opsPick, setOpsPick] = useState(trx?.ops_id ?? (trx && !trx.ops_id ? MANUAL : ""));

  const [bentuk, setBentuk] = useState(trx?.bentuk_kerjasama ?? "Berbayar");

  const benefitIsPreset =
    !!trx?.benefit_diberikan &&
    (BENEFIT_DIBERIKAN as readonly string[]).includes(trx.benefit_diberikan);
  const [benefit, setBenefit] = useState<string>(
    trx?.benefit_diberikan ? (benefitIsPreset ? trx.benefit_diberikan : MANUAL) : ""
  );

  // POI A-Z ascending (sama dengan web app lama), difilter oleh kotak pencarian.
  const basePoi = trx ? poiOptions : poiSiapTransaksi(poiOptions);
  const filteredPoi = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return basePoi;
    return basePoi.filter(
      (p) =>
        p.brand.toLowerCase().includes(needle) ||
        (p.code ?? "").toLowerCase().includes(needle)
    );
  }, [basePoi, search]);

  // Pilih POI -> kategori, PIC, WA, dan BD terisi otomatis dari data lead.
  function onPoiChange(id: string) {
    setLeadId(id);
    const poi = poiOptions.find((p) => p.id === id);
    if (!poi) return;
    if ((KATEGORI_BRAND as readonly string[]).includes(poi.kategori_brand)) {
      setKategori(poi.kategori_brand as KategoriBrand);
    }
    setNamaPic(poi.nama_pic ?? "");
    setKontakWa(poi.kontak_pic ?? "");
    setBdPick(poi.bd_id ?? MANUAL);
  }

  const selectedPoi = poiOptions.find((p) => p.id === leadId);
  const wajibDurasi = kategori === KATEGORI_WAJIB_DURASI;

  return (
    <>
      <div className="subcard">
        <h3>Informasi Merchant &amp; BD</h3>
        <label>Cari POI / Merchant (status Dealing atau Renewal)</label>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Ketik nama POI / kode lead…"
        />
        <label>Nama POI / Merchant *</label>
        <select
          name="crm_lead_id"
          value={leadId}
          onChange={(e) => onPoiChange(e.target.value)}
          required
        >
          <option value="" disabled>
            — pilih POI ({filteredPoi.length} tersedia) —
          </option>
          {filteredPoi.map((p) => (
            <option key={p.id} value={p.id}>
              {p.brand} ({p.status}) · {p.code ?? "—"}
            </option>
          ))}
        </select>
        <div className="hint">
          ID Merchant = kode lead CRM.{" "}
          {selectedPoi ? (
            <>
              Terpilih: <span className="mono">{selectedPoi.code ?? "—"}</span>
            </>
          ) : (
            "Hanya lead berstatus Dealing/Renewal yang muncul di daftar."
          )}
        </div>

        <div className="row">
          <EmployeePicker
            namePrefix="bd"
            employees={employees}
            label="Nama BD"
            value={bdPick}
            onChange={setBdPick}
            manualDefault={trx && !trx.bd_id ? trx.nama_bd : selectedPoi?.nama_bd}
          />
          <EmployeePicker
            namePrefix="ops"
            employees={employees}
            label="Nama OPS"
            value={opsPick}
            onChange={setOpsPick}
            manualDefault={trx && !trx.ops_id ? trx.nama_ops : undefined}
          />
        </div>

        <label>Kategori POI *</label>
        <select
          name="kategori_poi"
          value={kategori}
          onChange={(e) => setKategori(e.target.value as KategoriBrand)}
          required
        >
          {KATEGORI_BRAND.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      {wajibDurasi && (
        <div className="subcard">
          <h3>Durasi Kerjasama (wajib untuk kategori {KATEGORI_WAJIB_DURASI})</h3>
          <div className="row">
            <div>
              <label>Tanggal Awal Kerjasama *</label>
              <input
                name="durasi_kerjasama_mulai"
                type="date"
                defaultValue={trx?.durasi_kerjasama_mulai ?? ""}
                required
              />
            </div>
            <div>
              <label>Tanggal Akhir Kerjasama *</label>
              <input
                name="durasi_kerjasama_akhir"
                type="date"
                defaultValue={trx?.durasi_kerjasama_akhir ?? ""}
                required
              />
            </div>
          </div>
        </div>
      )}

      <div className="subcard">
        <h3>Kontak PIC POI</h3>
        <div className="row">
          <div>
            <label>Nama PIC POI *</label>
            <input
              name="nama_pic_poi"
              value={namaPic}
              onChange={(e) => setNamaPic(e.target.value)}
              placeholder="Contoh: Pak Budi (Manager)"
              required
            />
          </div>
          <div>
            <label>Nomor WhatsApp *</label>
            <input
              name="kontak_wa"
              value={kontakWa}
              onChange={(e) => setKontakWa(e.target.value)}
              placeholder="081234567890"
              required
            />
            <div className="hint">Otomatis disimpan berawalan 62.</div>
          </div>
        </div>
      </div>

      <div className="subcard">
        <h3>Skema Kerja Sama &amp; Benefit</h3>
        <div className="row">
          <div>
            <label>Bentuk Kerja Sama *</label>
            <select
              name="bentuk_kerjasama"
              value={bentuk}
              onChange={(e) => setBentuk(e.target.value)}
              required
            >
              {BENTUK_KERJASAMA.map((b) => (
                <option key={b} value={b}>
                  {b === "Free" ? "Free / Barter" : b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Nominal Deals {bentuk === "Berbayar" ? "*" : "(otomatis 0)"}</label>
            <input
              name="nominal"
              type="number"
              min={0}
              step={1}
              defaultValue={trx?.nominal ?? ""}
              placeholder="0"
              disabled={bentuk !== "Berbayar"}
              required={bentuk === "Berbayar"}
            />
            <div className="hint">
              {bentuk === "Berbayar"
                ? "Wajib lebih dari 0 untuk kerja sama berbayar."
                : "Free / Barter selalu disimpan sebagai 0."}
            </div>
          </div>
        </div>

        <label>Benefit Diberikan *</label>
        <select
          name="benefit_diberikan"
          value={benefit}
          onChange={(e) => setBenefit(e.target.value)}
          required
        >
          <option value="" disabled>
            — pilih benefit diberikan —
          </option>
          {BENEFIT_DIBERIKAN.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          <option value={MANUAL}>Tambah Benefit Lainnya (Custom)…</option>
        </select>
        {benefit === MANUAL && (
          <input
            name="benefit_diberikan_manual"
            placeholder="Tuliskan benefit custom"
            defaultValue={benefitIsPreset ? "" : trx?.benefit_diberikan ?? ""}
            required
          />
        )}
      </div>

      <div className="subcard">
        <h3>Jadwal Visit &amp; Kebutuhan Creator</h3>
        <div className="row">
          <div>
            <label>Visit Dimulai * (WIB)</label>
            <input
              name="visit_mulai"
              type="datetime-local"
              defaultValue={isoToJakartaInput(trx?.visit_mulai)}
              required
            />
          </div>
          <div>
            <label>Visit Berakhir * (WIB)</label>
            <input
              name="visit_berakhir"
              type="datetime-local"
              defaultValue={isoToJakartaInput(trx?.visit_berakhir)}
              required
            />
          </div>
        </div>
        <div className="row">
          <div>
            <label>Jumlah Kreator *</label>
            <input
              name="jumlah_kreator"
              type="number"
              min={1}
              step={1}
              defaultValue={trx?.jumlah_kreator ?? 1}
              required
            />
          </div>
          <div>
            <label>Jumlah Konten (opsional)</label>
            <input
              name="jumlah_konten"
              type="number"
              min={0}
              step={1}
              defaultValue={trx?.jumlah_konten ?? ""}
              placeholder="0"
            />
          </div>
        </div>
        <label>Total Jam Live (opsional)</label>
        <input
          name="total_jam_live"
          type="number"
          min={0}
          step={0.1}
          defaultValue={trx?.total_jam_live ?? ""}
          placeholder="0"
        />
      </div>

      <div className="subcard">
        <h3>Link Brief &amp; Catatan</h3>
        <label>Link Brief / Brief (opsional)</label>
        <textarea
          name="link_brief"
          rows={2}
          defaultValue={trx?.link_brief ?? ""}
          placeholder="URL Google Drive / Notion, atau ringkasan instruksi brief"
        />
      </div>
    </>
  );
}

export function PendataanTransaksiForm({
  poiOptions,
  employees,
}: {
  poiOptions: PoiOption[];
  employees: EmployeeOption[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createCrmTransaksi,
    null
  );
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    if (state?.ok) setFormKey((k) => k + 1);
  }, [state]);

  if (poiSiapTransaksi(poiOptions).length === 0) {
    return (
      <>
        <Msg state={state} />
        <p className="muted">
          Belum ada lead berstatus <b>Dealing</b> atau <b>Renewal</b>. Update status lead dulu di
          menu Leads &amp; Prospek.
        </p>
      </>
    );
  }

  return (
    <form action={action} key={formKey}>
      <Msg state={state} />
      <p className="section-sub">
        Khusus merchant status Dealing &amp; Renewal. ID transaksi (
        <span className="mono">CRMTRX-…</span>) dan tanggal transaksi diisi otomatis.
      </p>
      <TransaksiFields poiOptions={poiOptions} employees={employees} />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan Transaksi"}
      </button>
    </form>
  );
}

export function EditTransaksiModal({
  trx,
  poiOptions,
  employees,
}: {
  trx: CrmTransaksiRow;
  poiOptions: PoiOption[];
  employees: EmployeeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateCrmTransaksi,
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
              <h3>Edit Transaksi{trx.code ? ` · ${trx.code}` : ""}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                <Msg state={state} />
                <input type="hidden" name="id" value={trx.id} />
                <TransaksiFields poiOptions={poiOptions} employees={employees} trx={trx} />
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

function DeleteTransaksiButton({ trx }: { trx: CrmTransaksiRow }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    deleteCrmTransaksi,
    null
  );
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Hapus transaksi ${trx.code ?? ""} (${trx.nama_poi})?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={trx.id} />
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

export function ImportBulkTransaksiForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    importCrmTransaksiBulk,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <label>
        Satu transaksi per baris, dikunci ke <b>kode lead CRM</b>. Urutan kolom:
        <span className="mono">
          {" "}
          kode_lead, bentuk_kerjasama, nominal, benefit, visit_mulai, visit_berakhir,
          jumlah_kreator, jumlah_konten, link_brief, nama_ops, total_jam_live
        </span>
      </label>
      <textarea
        name="bulk"
        rows={7}
        required
        placeholder={
          "CRM-202608-0001;Berbayar;5000000;Dining - Content Package;2026-09-01T10:00;2026-09-01T15:00;3;6;https://drive.google.com/…;Aliya;2\n" +
          "CRM-202608-0002;Free;0;TTD - Free Ticket;2026-09-05;2026-09-05;2;;;Tammy;"
        }
      />
      <div className="hint">
        <span className="mono">visit_mulai</span> / <span className="mono">visit_berakhir</span>{" "}
        menerima <span className="mono">YYYY-MM-DDTHH:mm</span> atau{" "}
        <span className="mono">YYYY-MM-DD</span> (jam 00:00 WIB). PIC &amp; WhatsApp diambil dari
        data lead. Baris hasil impor ditandai <b>bulk</b> sampai dilengkapi lewat Edit.
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Mengimpor…" : "Impor Bulk Transaksi"}
      </button>
    </form>
  );
}

export function TransaksiActionTabs({
  poiOptions,
  employees,
  canImport,
}: {
  poiOptions: PoiOption[];
  employees: EmployeeOption[];
  canImport: boolean;
}) {
  const [tab, setTab] = useState<"form" | "import">("form");
  return (
    <div className="card">
      {canImport && (
        <div className="actions-row" style={{ marginBottom: 14 }}>
          <button
            type="button"
            className={tab === "form" ? "sm" : "sm ghost2"}
            onClick={() => setTab("form")}
          >
            Pendataan Transaksi
          </button>
          <button
            type="button"
            className={tab === "import" ? "sm" : "sm ghost2"}
            onClick={() => setTab("import")}
          >
            Import Bulk Transaksi
          </button>
        </div>
      )}
      {!canImport && <h2>Pendataan Transaksi</h2>}
      {tab === "form" || !canImport ? (
        <PendataanTransaksiForm poiOptions={poiOptions} employees={employees} />
      ) : (
        <ImportBulkTransaksiForm />
      )}
    </div>
  );
}

export function CrmTransaksiTable({
  rows,
  poiOptions,
  employees,
  canWrite,
  canDelete,
}: {
  rows: CrmTransaksiRow[];
  poiOptions: PoiOption[];
  employees: EmployeeOption[];
  canWrite: boolean;
  canDelete: boolean;
}) {
  const [q, setQ] = useState("");
  const [kategori, setKategori] = useState("");
  const [bentuk, setBentuk] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((t) => {
      if (kategori && t.kategori_poi !== kategori) return false;
      if (bentuk && t.bentuk_kerjasama !== bentuk) return false;
      if (!needle) return true;
      return [t.nama_poi, t.code, t.nama_bd, t.nama_ops, t.nama_pic_poi, t.benefit_diberikan]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [rows, q, kategori, bentuk]);

  return (
    <div className="card">
      <h2>
        Riwayat Transaksi ({filtered.length} dari {rows.length})
      </h2>
      <div className="inline-form" style={{ marginBottom: 14 }}>
        <div style={{ flex: "1 1 240px" }}>
          <label>Wildcard search</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="POI, kode, BD, OPS, benefit…"
          />
        </div>
        <div>
          <label>Kategori POI</label>
          <select
            value={kategori}
            onChange={(e) => setKategori(e.target.value)}
            style={{ width: 160 }}
          >
            <option value="">Semua kategori</option>
            {KATEGORI_BRAND.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Bentuk</label>
          <select value={bentuk} onChange={(e) => setBentuk(e.target.value)} style={{ width: 130 }}>
            <option value="">Semua</option>
            {BENTUK_KERJASAMA.map((b) => (
              <option key={b} value={b}>
                {b}
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
              <th>POI</th>
              <th>BD · OPS</th>
              <th>Kerja Sama</th>
              <th>Benefit</th>
              <th>Visit</th>
              <th className="right">Kreator</th>
              <th className="right">Konten</th>
              <th className="right">Jam Live</th>
              <th>Dicatat</th>
              {canWrite && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t.id}>
                <td className="mono">
                  {t.code ?? "—"}
                  {t.is_bulk_import && <span className="badge amber">bulk</span>}
                </td>
                <td>
                  <div style={{ fontWeight: 600 }}>{t.nama_poi}</div>
                  <span className="badge slate">{t.kategori_poi}</span>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {t.nama_pic_poi} · <span className="mono">{t.kontak_wa}</span>
                  </div>
                  {t.durasi_kerjasama_mulai && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      kerjasama {tanggal(t.durasi_kerjasama_mulai)} –{" "}
                      {tanggal(t.durasi_kerjasama_akhir)}
                    </div>
                  )}
                </td>
                <td>
                  {t.nama_bd}
                  <div className="muted" style={{ fontSize: 11 }}>
                    OPS: {t.nama_ops}
                  </div>
                </td>
                <td>
                  <span className={`badge ${t.bentuk_kerjasama === "Berbayar" ? "green" : "slate"}`}>
                    {t.bentuk_kerjasama}
                  </span>
                  <div>{t.bentuk_kerjasama === "Berbayar" ? rupiah(t.nominal) : "—"}</div>
                </td>
                <td className="muted" style={{ fontSize: 11 }}>
                  {t.benefit_diberikan}
                  {t.link_brief && (
                    <div>
                      <a href={t.link_brief} target="_blank" rel="noopener noreferrer">
                        brief
                      </a>
                    </div>
                  )}
                </td>
                <td className="muted" style={{ fontSize: 11 }}>
                  {waktuJakarta(t.visit_mulai)}
                  <div>s/d {waktuJakarta(t.visit_berakhir)}</div>
                </td>
                <td className="right">{num(t.jumlah_kreator)}</td>
                <td className="right">{t.jumlah_konten === null ? "—" : num(t.jumlah_konten)}</td>
                <td className="right">
                  {t.total_jam_live === null ? "—" : num(t.total_jam_live)}
                </td>
                <td className="muted" style={{ fontSize: 11 }}>
                  {waktuJakarta(t.tanggal_transaksi)}
                </td>
                {canWrite && (
                  <td>
                    <div className="actions-row">
                      <EditTransaksiModal trx={t} poiOptions={poiOptions} employees={employees} />
                      {canDelete && <DeleteTransaksiButton trx={t} />}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={canWrite ? 11 : 10} className="muted">
                  {rows.length === 0
                    ? "Belum ada transaksi tercatat."
                    : "Tidak ada transaksi yang cocok dengan filter."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
