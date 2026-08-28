"use client";

import { useActionState } from "react";
import {
  createLead,
  importLeadsCsv,
  claimLead,
  advanceAttempt,
  type ActionResult,
} from "@/lib/actions/leads";
import { IntakeFormFields, type BdOption, type BusinessTypeOptions } from "./intake-fields";

type Campaign = { id: string; code: string | null; campaign_name: string };
export type { BdOption };

const SOURCES = [
  "Scouting", "Leads-Socmed", "Leads-Iklan", "Website", "Referral", "Broadcast",
  "Event", "Kulwa-Webinar", "GO-Program", "Database", "Others",
];

const NQ_REASONS = [
  "[Bukan merchant/seller]", "[Skala terlalu kecil]", "[Tidak ada respon]", "[Lainnya]",
];

const ATTEMPT_NEXT: Record<string, string[]> = {
  "[Pending Validation]": ["[New Lead]"],
  "[New Lead]": ["[Contacted]"],
  "[Contacted]": ["[Qualified]", "[Not Qualified]"],
  "[Qualified]": ["[Negotiation]", "[Not Qualified]"],
  "[Negotiation]": ["[Closed - Lost]"],
};

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

export function ImportCsvForm({ campaigns }: { campaigns: Campaign[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    importLeadsCsv,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <label>Data CSV — satu lead per baris: nama, no_hp, email(opsional)</label>
      <textarea
        name="csv"
        rows={6}
        placeholder={"Toko Sepatu Jaya, 08123456789, jaya@mail.com\nWarung Bu Sri, 081298765432"}
        required
      />
      <div className="row">
        <div>
          <label>Sumber (untuk semua baris) *</label>
          <select name="source" defaultValue="" required>
            <option value="" disabled>
              Pilih sumber…
            </option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Kampanye Asal</label>
          <select name="origin_campaign_id" defaultValue="">
            <option value="">— tidak terkait —</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code ?? "(draft)"} · {c.campaign_name}
              </option>
            ))}
          </select>
        </div>
      </div>
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

// Each transition is its own <form> with a hidden to_status input — the submit
// button's own name/value is NOT reliably delivered to a React 19 Server Action.
function TransitionBtn({ id, to }: { id: string; to: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    advanceAttempt,
    null
  );
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to_status" value={to} />
      <button className={`sm ${to.startsWith("[Closed") ? "ghost2" : ""}`} disabled={pending}>
        {pending ? "…" : to}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          ditolak
        </span>
      )}
    </form>
  );
}

function NotQualifiedBtn({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    advanceAttempt,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to_status" value="[Not Qualified]" />
      <select name="not_qualified_reason" defaultValue="" style={{ width: 160, marginBottom: 0 }}>
        <option value="">alasan NQ…</option>
        {NQ_REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : "[Not Qualified]"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          ditolak
        </span>
      )}
    </form>
  );
}

export function AttemptControls({ id, status }: { id: string; status: string }) {
  const targets = ATTEMPT_NEXT[status] ?? [];
  if (targets.length === 0) return <span className="muted">selesai</span>;
  return (
    <div className="actions-row">
      {targets.map((t) =>
        t === "[Not Qualified]" ? (
          <NotQualifiedBtn key={t} id={id} />
        ) : (
          <TransitionBtn key={t} id={id} to={t} />
        )
      )}
    </div>
  );
}
