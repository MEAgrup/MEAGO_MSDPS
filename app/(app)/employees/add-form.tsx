"use client";

import { useActionState, useState, useTransition } from "react";
import {
  createEmployee,
  checkAdminConnection,
  closeLeadOnboardingWindow,
  resetEmployeePassword,
  setLeadOnboardingWindow,
  type ActionResult,
} from "@/lib/actions/employees";
import { DIVISIONS, DIVISION_LABELS, type Division } from "@/lib/divisions";
import {
  isoToWibLocalInput,
  type LeadOnboardingWindow,
} from "@/lib/employee-onboarding";

// Pesan bisa multi-baris (diagnosa env, password sementara) — pertahankan barisnya.
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
        <div className={state.ok ? "ok-msg" : "err"} style={MSG_STYLE}>
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
          <label>Password Awal</label>
          <input name="password" type="text" placeholder="kosongkan = dibuatkan sistem" />
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
        <label>
          <input type="checkbox" name="must_change_password" defaultChecked /> Password ini sementara
          (wajib diganti pemiliknya saat login pertama)
        </label>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Tambah Karyawan"}
      </button>
    </form>
  );
}

// LeadAddEmployeeForm — form SPV/Lead selama jendela onboarding. Sengaja tanpa
// field divisi, level, peran, dan password: keempatnya dipaksa server (dan
// ditolak DB kalau menyimpang), jadi menampilkannya hanya mengundang percobaan
// yang pasti gagal.
export function LeadAddEmployeeForm({ division }: { division: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createEmployee,
    null
  );

  return (
    <form action={formAction}>
      {state && (
        <div className={state.ok ? "ok-msg" : "err"} style={MSG_STYLE}>
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
          <label>Divisi</label>
          <input value={DIVISION_LABELS[division as Division] ?? division} disabled readOnly />
        </div>
        <div>
          <label>Level</label>
          <input value="Staff" disabled readOnly />
        </div>
      </div>
      <button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Tambah Anggota Tim"}
      </button>
    </form>
  );
}

// OnboardingWindowForm — panel OD/Director: buka, persempit, perpanjang, atau
// cabut jendela. Tombol "Cabut sekarang" sengaja terpisah dari form supaya
// pencabutan tidak pernah gagal gara-gara field lain belum valid.
export function OnboardingWindowForm({ window }: { window: LeadOnboardingWindow }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    setLeadOnboardingWindow,
    null
  );
  const [closeResult, setCloseResult] = useState<ActionResult | null>(null);
  const [closing, startClosing] = useTransition();

  const selected = new Set<string>(window.divisions ?? []);

  return (
    <div style={{ borderTop: "1px solid var(--border, #e2e8f0)", paddingTop: 12, marginTop: 12 }}>
      <form action={formAction}>
        {state && (
          <div className={state.ok ? "ok-msg" : "err"} style={MSG_STYLE}>
            {state.message}
          </div>
        )}
        <div className="checks">
          <label>
            <input type="checkbox" name="enabled" defaultChecked={window.enabled} /> Izinkan SPV/Lead
            menambah staff divisinya
          </label>
        </div>
        <div className="row">
          <div>
            <label>Tutup otomatis pada (WIB) *</label>
            <input
              name="closes_at"
              type="datetime-local"
              defaultValue={isoToWibLocalInput(window.closes_at)}
            />
          </div>
          <div>
            <label>Catatan (opsional)</label>
            <input name="note" defaultValue={window.note ?? ""} placeholder="alasan dibuka" />
          </div>
        </div>
        <div>
          <label>Batasi ke divisi tertentu (kosongkan = semua divisi)</label>
          <div className="checks">
            {DIVISIONS.map((d) => (
              <label key={d}>
                <input type="checkbox" name="divisions" value={d} defaultChecked={selected.has(d)} />{" "}
                {DIVISION_LABELS[d]}
              </label>
            ))}
          </div>
        </div>
        <button type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Simpan Pengaturan Jendela"}
        </button>
      </form>

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn-ghost sm"
          disabled={closing}
          onClick={() =>
            startClosing(async () => {
              setCloseResult(await closeLeadOnboardingWindow());
            })
          }
        >
          {closing ? "Mencabut…" : "Cabut akses SPV/Lead sekarang"}
        </button>
        {closeResult && (
          <div className={closeResult.ok ? "ok-msg" : "err"} style={{ ...MSG_STYLE, marginTop: 10 }}>
            {closeResult.message}
          </div>
        )}
      </div>
    </div>
  );
}

// ResetPasswordButton — OD/HR menerbitkan ulang password sementara. Tanpa ini,
// akun yang lupa password hanya bisa ditolong lewat dashboard Supabase: di luar
// sistem, di luar audit, dan di luar jangkauan HR.
export function ResetPasswordButton({ employeeId, name }: { employeeId: string; name: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    resetEmployeePassword,
    null
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="employee_id" value={employeeId} />
      <button
        type="submit"
        className="btn-ghost sm"
        disabled={pending}
        title={`Terbitkan password sementara baru untuk ${name}`}
      >
        {pending ? "…" : "Reset password"}
      </button>
      {state && (
        <div className={state.ok ? "ok-msg" : "err"} style={{ ...MSG_STYLE, marginTop: 8 }}>
          {state.message}
        </div>
      )}
    </form>
  );
}
