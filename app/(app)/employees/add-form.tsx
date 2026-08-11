"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createEmployee,
  checkAdminConnection,
  type ActionResult,
} from "@/lib/actions/employees";
import { DIVISIONS, DIVISION_LABELS } from "@/lib/divisions";

// Pesan bisa multi-baris (diagnosa env) — pertahankan barisnya.
const MSG_STYLE = { marginBottom: 12, display: "block", whiteSpace: "pre-line" as const };

// AdminConnectionCheck — jawab satu pertanyaan yang tidak bisa dijawab dari luar
// production: apakah runtime ini benar-benar memegang service-role key yang sah.
// Dipakai saat pembuatan akun gagal tanpa sebab yang jelas.
export function AdminConnectionCheck() {
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        type="button"
        className="btn-ghost sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(await checkAdminConnection());
          })
        }
      >
        {pending ? "Memeriksa…" : "Cek koneksi service-role"}
      </button>
      {result && (
        <div className={result.ok ? "ok-msg" : "err"} style={{ ...MSG_STYLE, marginTop: 10 }}>
          {result.message}
        </div>
      )}
    </div>
  );
}

export function AddEmployeeForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createEmployee,
    null
  );

  return (
    <form action={formAction}>
      {state && (
        <div className={state.ok ? "badge green" : "err"} style={MSG_STYLE}>
          {state.message}
        </div>
      )}
      <div className="row">
        <div>
          <label>Nama Lengkap *</label>
          <input name="full_name" required />
        </div>
        <div>
          <label>Email *</label>
          <input name="email" type="email" placeholder="nama@meago.test" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Password Awal *</label>
          <input name="password" type="text" minLength={8} placeholder="min. 8 karakter" required />
        </div>
        <div>
          <label>Divisi *</label>
          <select name="division" required defaultValue="">
            <option value="" disabled>Pilih divisi…</option>
            {DIVISIONS.map((d) => (
              <option key={d} value={d}>{DIVISION_LABELS[d]}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Level</label>
          <select name="rank" defaultValue="staff">
            <option value="staff">Staff</option>
            <option value="lead">Lead / SPV</option>
          </select>
        </div>
        <div />
      </div>
      <div className="checks">
        <label><input type="checkbox" name="is_od" /> OD (Org Development)</label>
        <label><input type="checkbox" name="is_director" /> Director</label>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Tambah Karyawan"}
      </button>
    </form>
  );
}
