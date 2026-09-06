"use client";

import { useActionState, useEffect, useState } from "react";
import { registerDealTransaction, type ActionResult } from "@/lib/actions/deals";
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

// DealsToolbar — pengganti DealsTabs: "Daftarkan Transaksi" kini popup
// (RegisterDealModal), bukan lagi tab yang saling tukar.
export function DealsToolbar({
  dealingLeads,
  bdOptions,
  benefitOptions,
  nominalHistoryByLead,
}: {
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  benefitOptions: string[];
  nominalHistoryByLead?: Record<string, number[]>;
}) {
  return (
    <div className="card">
      <div className="table-toolbar">
        <h2>Catat Transaksi Baru</h2>
        <RegisterDealModal
          dealingLeads={dealingLeads}
          bdOptions={bdOptions}
          benefitOptions={benefitOptions}
          nominalHistoryByLead={nominalHistoryByLead}
        />
      </div>
    </div>
  );
}
