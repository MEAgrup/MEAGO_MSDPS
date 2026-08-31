"use client";

import { useActionState } from "react";
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

// Form intake lead BD. Wajib hanya "Nama BD" + "Brand / Merchant / POI";
// sisanya opsional. Kolom-kolomnya dibagi dengan EditLeadModal lewat
// IntakeFormFields supaya kedua form tidak pernah menyimpang.
export function NewLeadForm({
  bdOptions,
  businessTypeOptions,
}: {
  bdOptions: BdOption[];
  businessTypeOptions: BusinessTypeOptions;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createLead, null);

  return (
    <form action={action}>
      <Msg state={state} />
      <IntakeFormFields idPrefix="new" bdOptions={bdOptions} businessTypeOptions={businessTypeOptions} />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Daftarkan Lead"}
      </button>
    </form>
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

