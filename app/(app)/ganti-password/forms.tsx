"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword, type ActionResult } from "@/lib/actions/auth";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    changePassword,
    null
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form action={action} ref={formRef}>
      <Msg state={state} />
      <label>Password Saat Ini *</label>
      <input type="password" name="current_password" required autoComplete="current-password" />
      <label>Password Baru * (min. 8 karakter)</label>
      <input
        type="password"
        name="new_password"
        required
        minLength={8}
        autoComplete="new-password"
      />
      <label>Konfirmasi Password Baru *</label>
      <input
        type="password"
        name="confirm_password"
        required
        minLength={8}
        autoComplete="new-password"
      />
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Ganti Password"}
      </button>
    </form>
  );
}
