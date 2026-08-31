"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createLead,
  importLeadsCsv,
  claimLead,
  type ActionResult,
} from "@/lib/actions/leads";
import { BRAND_CATEGORIES } from "@/lib/leads/intake";
import { IntakeFormFields, type BdOption, type BusinessTypeOptions } from "./intake-fields";

export type { BdOption };

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

// NewLeadModal — popup "Daftar Lead" (tombol di kepala halaman Leads &
// Prospek). Wajib hanya "Nama BD" + "Brand / Merchant / POI"; sisanya
// opsional. Kolom-kolomnya dibagi dengan EditLeadModal lewat
// IntakeFormFields supaya kedua form tidak pernah menyimpang.
export function NewLeadModal({
  bdOptions,
  businessTypeOptions,
}: {
  bdOptions: BdOption[];
  businessTypeOptions: BusinessTypeOptions;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createLead, null);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Daftar Lead
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Daftarkan Lead</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                {state && !state.ok && <div className="err">{state.message}</div>}
                <IntakeFormFields idPrefix="new" bdOptions={bdOptions} businessTypeOptions={businessTypeOptions} />
              </div>
              <div className="modal-foot">
                <button type="button" className="ghost2" onClick={() => setOpen(false)} disabled={pending}>
                  Batal
                </button>
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Daftarkan Lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function ImportCsvForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    importLeadsCsv,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <label>Data CSV — satu lead per baris: nama bd, brand, kategori, wilayah (provinsi)</label>
      <textarea
        name="csv"
        rows={6}
        placeholder={
          "Budi Santoso, Toko Sepatu Jaya, Dining, Jawa Barat\nSiti Aminah, Warung Bu Sri, TTD, Bali"
        }
        required
      />
      <p className="hint">
        Kategori: {BRAND_CATEGORIES.join(", ")}. Nama BD harus sama persis dengan nama karyawan
        BizDev terdaftar; wilayah harus nama provinsi lengkap.
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Mengimpor…" : "Impor Massal"}
      </button>
    </form>
  );
}

export function ClaimButton({ leadId }: { leadId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(claimLead, null);
  return (
    <form action={action} className="actions-row">
      <input type="hidden" name="lead_id" value={leadId} />
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Ambil Lead"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

