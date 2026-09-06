"use client";

import { useActionState } from "react";
import { updateBankAccount, type ActionResult } from "@/lib/actions/portal";

export function BankAccountForm({
  defaults,
}: {
  defaults: { bank_name: string; bank_account_number: string; bank_account_name: string };
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updateBankAccount, null);

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
      {state && <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>}

      <label>
        Nama Bank
        <input name="bank_name" defaultValue={defaults.bank_name} placeholder="mis. BCA" required />
      </label>
      <label>
        Nomor Rekening
        <input name="bank_account_number" defaultValue={defaults.bank_account_number} required />
      </label>
      <label>
        Nama Pemilik Rekening
        <input name="bank_account_name" defaultValue={defaults.bank_account_name} required />
      </label>

      <button type="submit" disabled={pending} style={{ alignSelf: "flex-start" }}>
        {pending ? "Menyimpan…" : "Simpan Rekening"}
      </button>
    </form>
  );
}
