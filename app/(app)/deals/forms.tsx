"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { registerDealTransaction, importMasterDealBulk, type ActionResult, type ImportDealRow } from "@/lib/actions/deals";
import { downloadDealImportTemplate, parseDealImportFile } from "@/lib/deals/import-template";
import { DealIntakeFields } from "./intake-fields";
import type { BdOption } from "../leads/intake-fields";
import type { PoolLead } from "../leads/pool";
import type { BrandCategory } from "@/lib/leads/intake";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

// RegisterDealModal — popup "Daftarkan Transaksi", dipakai di dua tempat:
// tab Merchant Deals (tanpa fixedLead, POI dipilih lewat LeadPicker) dan
// section "Notifikasi Brand Dealing" (Leads & Prospek, tombol "Catat
// Transaksi" per baris — fixedLead mengunci & pre-fill POI dari baris itu).
// Sama seperti pola popup UpdateStatusButton (leads/pool.tsx).
export function RegisterDealModal({
  dealingLeads,
  bdOptions,
  benefitOptions,
  nominalHistoryByLead,
  fixedLead,
}: {
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  benefitOptions: string[];
  nominalHistoryByLead?: Record<string, number[]>;
  fixedLead?: PoolLead;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    registerDealTransaction,
    null
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button type="button" className={fixedLead ? "sm ghost2" : undefined} onClick={() => setOpen(true)}>
        {fixedLead ? "Catat Transaksi" : "Daftarkan Transaksi"}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                Daftarkan Transaksi
                {fixedLead ? ` · ${fixedLead.brand_name ?? fixedLead.lead_name}` : ""}
              </h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                {state && !state.ok && <div className="err">{state.message}</div>}
                <DealIntakeFields
                  idPrefix={fixedLead ? `catat-${fixedLead.id}` : "new-deal"}
                  dealingLeads={dealingLeads}
                  bdOptions={bdOptions}
                  benefitOptions={benefitOptions}
                  nominalHistoryByLead={nominalHistoryByLead}
                  defaults={
                    fixedLead
                      ? {
                          lead_id: fixedLead.id,
                          bd_id: fixedLead.bd_employee_id ?? "",
                          kategori_poi: (fixedLead.brand_category as BrandCategory | null) ?? "",
                          pic_name: fixedLead.pic_name_position ?? "",
                          pic_whatsapp: fixedLead.pic_phone ?? "",
                        }
                      : undefined
                  }
                />
              </div>
              <div className="modal-foot">
                <button type="button" className="ghost2" onClick={() => setOpen(false)} disabled={pending}>
                  Batal
                </button>
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Daftarkan Transaksi"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ImportMasterDealForm — "Import Bulking" (tab Merchant Deals): upload file
// .xlsx/.csv (di-parse client-side via SheetJS, lihat lib/deals/import-template.ts),
// dikirim sebagai JSON ke importMasterDealBulk. Baris hasil import sengaja
// belum lengkap (kategori POI/BD/PIC dst kosong) — dilengkapi satu per satu
// lewat tombol "Lengkapi Data" di tabel, sama seperti alur "Daftarkan
// Transaksi" biasa.
export function ImportMasterDealForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(importMasterDealBulk, null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ImportDealRow[] | null>(null);
  const [parseError, setParseError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | null) {
    setParseError("");
    setRows(null);
    setFileName(file?.name ?? "");
    if (!file) return;
    try {
      const parsed = await parseDealImportFile(file);
      if (parsed.length === 0) {
        setParseError("File tidak berisi baris data (cek sheet pertama & header kolom).");
        return;
      }
      setRows(parsed);
    } catch {
      setParseError("Gagal membaca file. Pastikan formatnya .xlsx, .xls, atau .csv.");
    }
  }

  function resetForm() {
    setFileName("");
    setRows(null);
    setParseError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  useEffect(() => {
    if (state?.ok) resetForm();
  }, [state]);

  if (!open) {
    return (
      <button type="button" className="sm ghost2" onClick={() => setOpen(true)}>
        Import Bulking
      </button>
    );
  }

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Import Bulking — Merchant Deals</h3>
          <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="hint">
            1) Download template di bawah (berisi contoh isian + sheet &quot;Panduan&quot; cara mengisi). 2) Isi sheet
            &quot;Data&quot; — satu baris per transaksi, jangan ubah header. 3) Upload file yang sudah diisi di sini.
          </p>
          <button type="button" className="sm ghost2" onClick={downloadDealImportTemplate}>
            Download Template
          </button>

          <div style={{ marginTop: 14 }}>
            <label>File Import (.xlsx, .xls, atau .csv)</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {parseError && <div className="err">{parseError}</div>}
          {rows && (
            <p className="hint">
              {fileName}: {rows.length} baris siap diimpor. Baris yang datanya tidak valid akan dilewati & dilaporkan
              setelah submit (unique ID kosong/duplikat, bentuk kerjasama tidak dikenal, dst).
            </p>
          )}
          {state && <Msg state={state} />}

          <form
            action={action}
            onSubmit={(e) => {
              if (!rows || rows.length === 0) e.preventDefault();
            }}
          >
            <input type="hidden" name="rows" value={rows ? JSON.stringify(rows) : ""} />
            <div className="modal-foot" style={{ padding: "14px 0 0", borderTop: "none" }}>
              <button type="button" className="ghost2" onClick={() => setOpen(false)} disabled={pending}>
                Tutup
              </button>
              <button type="submit" disabled={pending || !rows || rows.length === 0}>
                {pending ? "Mengimpor…" : `Import${rows ? ` ${rows.length} Baris` : ""}`}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// DealsToolbar — pengganti DealsTabs: "Daftarkan Transaksi" kini popup
// (RegisterDealModal), bukan lagi tab yang saling tukar. "Import Bulking"
// (ImportMasterDealForm) hanya tampil untuk yang canImport (mgmt/BizDev).
export function DealsToolbar({
  dealingLeads,
  bdOptions,
  benefitOptions,
  nominalHistoryByLead,
  canImport,
}: {
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  benefitOptions: string[];
  nominalHistoryByLead?: Record<string, number[]>;
  canImport?: boolean;
}) {
  return (
    <div className="card">
      <div className="table-toolbar">
        <h2>Catat Transaksi Baru</h2>
        <div className="actions-row">
          {canImport && <ImportMasterDealForm />}
          <RegisterDealModal
            dealingLeads={dealingLeads}
            bdOptions={bdOptions}
            benefitOptions={benefitOptions}
            nominalHistoryByLead={nominalHistoryByLead}
          />
        </div>
      </div>
    </div>
  );
}
