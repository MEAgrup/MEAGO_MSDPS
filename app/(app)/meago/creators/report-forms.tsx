"use client";

import { useActionState } from "react";
import {
  uploadCreatorReport,
  deleteCreatorReport,
  type ActionResult,
} from "@/lib/actions/creator-reports";

type CreatorOpt = { id: string; name: string; code: string | null };

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

// UploadReportForm — kartu "Report Kreator" (portal F.2). FormData wajib pakai input
// type="file" name="file" — uploadCreatorReport (lib/actions/creator-reports.ts) upload
// ke bucket privat creator-reports lalu insert metadata ber-RLS (staff CM scope owner,
// Lead CM lintas, mgmt semua — lihat migrasi 0312).
export function UploadReportForm({ creators }: { creators: CreatorOpt[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    uploadCreatorReport,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Kreator *</label>
          <select name="creator_id" defaultValue="" required>
            <option value="" disabled>
              Pilih kreator…
            </option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? "(draft)"} · {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Judul Report *</label>
          <input name="title" required />
        </div>
      </div>
      <label>File *</label>
      <input type="file" name="file" required />
      <button type="submit" disabled={pending}>
        {pending ? "Mengunggah…" : "Unggah Report"}
      </button>
    </form>
  );
}

// DeleteReportButton — pengunggah / Lead CM / mgmt (RLS delete creator_reports).
export function DeleteReportButton({ reportId }: { reportId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    deleteCreatorReport,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="report_id" value={reportId} />
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : "Hapus"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}
