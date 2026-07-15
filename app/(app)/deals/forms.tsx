"use client";

import { useActionState, useState } from "react";
import {
  registerDeal,
  importLegacyDeals,
  setPipelineStage,
  type ActionResult,
} from "@/lib/actions/deals";

type Employee = { id: string; full_name: string };
type Merchant = { id: string; code: string | null; nama_toko: string };

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

export function RegisterDealForm({
  employees,
  merchants,
  sourcedByRole,
}: {
  employees: Employee[];
  merchants: Merchant[];
  sourcedByRole: "bd" | "cm";
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    registerDeal,
    null
  );
  const [productRows, setProductRows] = useState<number[]>([0]);

  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Nama Brand * (persis nama tampilan platform)</label>
          <input name="brand_name" required />
        </div>
        <div>
          <label>Shop ID (angka saja, unik)</label>
          <input name="shop_id" inputMode="numeric" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Merchant M4 (opsional)</label>
          <select name="merchant_id" defaultValue="">
            <option value="">— tanpa link merchant —</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.code ?? "—"} · {m.nama_toko}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Niche</label>
          <input name="niche" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Tanggal Exp *</label>
          <input type="date" name="exp_date" required />
        </div>
        <div>
          <label>PIC TAP</label>
          <select name="pic_tap" defaultValue="">
            <option value="">— pilih PIC —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Komisi Kreator (0-100, boleh range mis. 8-12)</label>
          <input name="komisi_kreator" placeholder="mis. 10 atau 8-12" />
        </div>
        <div>
          <label>Komisi MEA (0-100)</label>
          <input name="komisi_mea" placeholder="mis. 5" />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Nama Campaign</label>
          <input name="campaign_name" />
        </div>
        <div>
          <label>Campaign ID</label>
          <input name="campaign_id" />
        </div>
      </div>
      <label>Link Brand</label>
      <input name="brand_link" />
      <input type="hidden" name="sourced_by_role" value={sourcedByRole} />

      <h3 style={{ fontSize: 13, margin: "14px 0 8px" }}>Produk (opsional, mewarisi niche/exp/komisi deal)</h3>
      {productRows.map((rowId) => (
        <div key={rowId} className="row" style={{ marginBottom: 4 }}>
          <div>
            <label>Nama Produk</label>
            <input name={`product_name_${rowId}`} />
          </div>
          <div>
            <label>Product ID</label>
            <input name={`product_id_${rowId}`} />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="sm ghost2"
        style={{ marginBottom: 12 }}
        onClick={() => setProductRows((rows) => [...rows, (rows[rows.length - 1] ?? 0) + 1])}
      >
        + baris produk
      </button>

      <div>
        <button type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Registrasi Deal"}
        </button>
      </div>
    </form>
  );
}

export function ImportLegacyForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    importLegacyDeals,
    null
  );
  return (
    <form action={action}>
      <Msg state={state} />
      <label>Tempel data master deal legacy (header di baris mana pun, pemisah tab/;/,)</label>
      <textarea
        name="data"
        rows={10}
        placeholder={"brand;shop_id;exp;komisi\nToko A;12345;2026-12-31;10"}
        required
      />
      <button type="submit" disabled={pending}>
        {pending ? "Mengimpor…" : "Impor Master Deal"}
      </button>
    </form>
  );
}

export function DealsTabs({
  employees,
  merchants,
  sourcedByRole,
  canImport,
}: {
  employees: Employee[];
  merchants: Merchant[];
  sourcedByRole: "bd" | "cm";
  canImport: boolean;
}) {
  const [tab, setTab] = useState<"register" | "import">("register");
  if (!canImport) {
    return (
      <div className="card">
        <h2>Registrasi Deal</h2>
        <RegisterDealForm employees={employees} merchants={merchants} sourcedByRole={sourcedByRole} />
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
          Registrasi Deal
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
        <RegisterDealForm employees={employees} merchants={merchants} sourcedByRole={sourcedByRole} />
      ) : (
        <ImportLegacyForm />
      )}
    </div>
  );
}

export const PIPELINE_STAGES = ["baru", "nego", "kontrak", "berjalan", "selesai"];

export function PipelineStageSelect({ dealId, current }: { dealId: string; current: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    setPipelineStage,
    null
  );
  return (
    <form action={action} className="inline-form">
      <input type="hidden" name="id" value={dealId} />
      <select name="pipeline_stage" defaultValue={current} style={{ width: 120 }}>
        {PIPELINE_STAGES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}
