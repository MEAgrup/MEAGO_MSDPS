"use client";

import { useActionState } from "react";
import { activatePortalAccount, type ActivationResult } from "@/lib/actions/activation";

export function ActivationForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ActivationResult | null, FormData>(
    activatePortalAccount,
    null
  );
  return (
    <form action={action}>
      {state && !state.ok && <div className="err">{state.message}</div>}
      <input type="hidden" name="t" value={token} />
      <label>Email</label>
      <input value={email} disabled />
      <label>Buat Password</label>
      <input type="password" name="password" minLength={8} required autoComplete="new-password" />
      <label>Ulangi Password</label>
      <input type="password" name="confirm" minLength={8} required autoComplete="new-password" />
      <button type="submit" disabled={pending} style={{ width: "100%" }}>
        {pending ? "Mengaktifkan…" : "Aktifkan & Masuk"}
      </button>
      <p className="hint">Minimal 8 karakter. Link ini hanya bisa dipakai sekali.</p>
    </form>
  );
}
