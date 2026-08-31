"use client";

import { useActionState, useState } from "react";
import { registerDealTransaction, importMasterDeal, type ActionResult } from "@/lib/actions/deals";
import { DealIntakeFields } from "./intake-fields";
import type { BdOption } from "../leads/intake-fields";
import type { PoolLead } from "../leads/pool";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

// RegisterDealTransactionForm — "Daftarkan Transaksi" (tab Merchant Deals).
// Field-fieldnya dibagi dengan EditDealModal (tabel Daftar Deal) lewat
// DealIntakeFields supaya kedua form tidak pernah menyimpang.
export function RegisterDealTransactionForm({
  dealingLeads,
  bdOptions,
  benefitOptions,
}: {
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  benefitOptions: string[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    registerDealTransaction,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <DealIntakeFields
        idPrefix="new-deal"
        dealingLeads={dealingLeads}
        bdOptions={bdOptions}
        benefitOptions={benefitOptions}
      />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Daftarkan Transaksi"}
      </button>
    </form>
  );
}

export function ImportMasterDealForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(importMasterDeal, null);
  return (
    <form action={action}>
      <Msg state={state} />
      <label>
        Data CSV — satu transaksi per baris: Unique_ID, Bentuk_Kerjasama, Nominal, Benefit_Diberikan,
        Visit_Mulai, Visit_Berakhir, Jumlah_Kreator, Jumlah_Konten, Link_Brief
      </label>
      <textarea
        name="csv"
        rows={8}
        placeholder={
          "DEAL-EXT-0001, Berbayar, 1500000, Dining - Free Meals, 2026-07-01 10:00, 2026-07-01 14:00, 3, 5, https://…"
        }
        required
      />
      <p className="hint">
        • Bentuk Kerjasama: Berbayar atau Free
        <br />
        • Format Tanggal: YYYY-MM-DD (opsional jam, misal: 2026-07-01 10:00)
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Mengimpor…" : "Impor Master Deal"}
      </button>
    </form>
  );
}

export function DealsTabs({
  dealingLeads,
  bdOptions,
  benefitOptions,
  canImport,
}: {
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  benefitOptions: string[];
  canImport: boolean;
}) {
  const [tab, setTab] = useState<"register" | "import">("register");
  if (!canImport) {
    return (
      <div className="card">
        <h2>Daftarkan Transaksi</h2>
        <RegisterDealTransactionForm
          dealingLeads={dealingLeads}
          bdOptions={bdOptions}
          benefitOptions={benefitOptions}
        />
      </div>
    );
  }
  return (
    <div className="card">
      <div className="actions-row" style={{ marginBottom: 14 }}>
        <button
          className={tab === "register" ? "sm" : "sm ghost2"}
          onClick={() => setTab("register")}
          type="button"
        >
          Daftarkan Transaksi
        </button>
        <button
          className={tab === "import" ? "sm" : "sm ghost2"}
          onClick={() => setTab("import")}
          type="button"
        >
          Import Master Deal
        </button>
      </div>
      {tab === "register" ? (
        <RegisterDealTransactionForm
          dealingLeads={dealingLeads}
          bdOptions={bdOptions}
          benefitOptions={benefitOptions}
        />
      ) : (
        <ImportMasterDealForm />
      )}
    </div>
  );
}
