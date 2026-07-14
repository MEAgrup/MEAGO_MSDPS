"use client";

import { useActionState } from "react";
import { createEmployee, type ActionResult } from "@/lib/actions/employees";

const DIVISIONS = [
  "Marketing", "BizDev", "Finance", "Account", "Ecommerce", "Ads", "KOL", "LiveStream",
];

export function AddEmployeeForm() {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createEmployee,
    null
  );

  return (
    <form action={formAction}>
      {state && (
        <div className={state.ok ? "badge green" : "err"} style={{ marginBottom: 12, display: "block" }}>
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
              <option key={d} value={d}>{d}</option>
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
