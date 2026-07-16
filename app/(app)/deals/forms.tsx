"use client";

import type { ReactNode } from "react";
import { useActionState, useState } from "react";
import {
  registerDeal,
  importLegacyDeals,
  setPipelineStage,
  registerPoiDeal,
  updatePoiRealisasi,
  createPoiFinanceAction,
  BENTUK_KERJASAMA_OPTIONS,
  PAYMENT_INTENT_OPTIONS,
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

// ============================================================================
// POI Dealing — venue/POI (TTD/Accomodation/Dining) untuk visit kreator.
// ============================================================================

// RegisterPoiDealForm: field persis urutan Google Form BD. Kategori POI datang
// dari config poi.kategori; benefit dinamis menyesuaikan kategori terpilih dari
// config poi.benefits (client-side, tanpa roundtrip server).
export function RegisterPoiDealForm({
  poiKategori,
  poiBenefits,
}: {
  poiKategori: string[];
  poiBenefits: Record<string, string[]>;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    registerPoiDeal,
    null
  );
  const [kategori, setKategori] = useState(poiKategori[0] ?? "");
  const [bentuk, setBentuk] = useState<(typeof BENTUK_KERJASAMA_OPTIONS)[number]>("Free");
  const benefitOptions = poiBenefits[kategori] ?? [];

  return (
    <form action={action}>
      <Msg state={state} />
      <div className="row">
        <div>
          <label>Kategori POI *</label>
          <select
            name="kategori_poi"
            value={kategori}
            onChange={(e) => setKategori(e.target.value)}
            required
          >
            {poiKategori.length === 0 && <option value="">— belum ada kategori di config —</option>}
            {poiKategori.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Nama POI *</label>
          <input name="nama_poi" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Nama PIC *</label>
          <input name="pic_name" required />
        </div>
        <div>
          <label>No. WhatsApp PIC *</label>
          <input name="pic_whatsapp" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Bentuk Kerjasama *</label>
          <select
            name="bentuk_kerjasama"
            value={bentuk}
            onChange={(e) => setBentuk(e.target.value as (typeof BENTUK_KERJASAMA_OPTIONS)[number])}
            required
          >
            {BENTUK_KERJASAMA_OPTIONS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        {bentuk === "Berbayar" && (
          <div>
            <label>Nominal Harga *</label>
            <input name="nominal_harga" placeholder="mis. 1.500.000" required />
          </div>
        )}
      </div>
      {bentuk === "Berbayar" && (
        <div className="row">
          <div>
            <label>Status Pembayaran</label>
            <select name="payment_intent" defaultValue="Lunas">
              {PAYMENT_INTENT_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <div className="row">
        <div>
          <label>Benefit *</label>
          <select name="benefit" defaultValue="" key={kategori} required>
            <option value="">— pilih benefit —</option>
            {benefitOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Tanggal Visit Mulai *</label>
          <input type="date" name="visit_start_date" required />
        </div>
        <div>
          <label>Jam Visit Mulai *</label>
          <input type="time" name="visit_start_time" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Tanggal Visit Berakhir *</label>
          <input type="date" name="visit_end_date" required />
        </div>
        <div>
          <label>Jam Visit Berakhir *</label>
          <input type="time" name="visit_end_time" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Jumlah Kreator Dibutuhkan *</label>
          <input type="number" name="kreator_needed" min={1} required />
        </div>
        <div>
          <label>Jumlah Konten Dibutuhkan *</label>
          <input type="number" name="konten_needed" min={1} required />
        </div>
      </div>
      <label>Link Brief (opsional)</label>
      <input name="brief_link" />

      <div style={{ marginTop: 12 }}>
        <button type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Input Deal Baru"}
        </button>
      </div>
    </form>
  );
}

// PoiRealisasiForm: form inline per baris — dobel fungsi tampilan (defaultValue
// = nilai realisasi tersimpan) & edit sekaligus.
export function PoiRealisasiForm({
  dealId,
  listingDate,
  visitRealizedDate,
  kreatorRealized,
  videoRealized,
  visitChecked,
}: {
  dealId: string;
  listingDate: string | null;
  visitRealizedDate: string | null;
  kreatorRealized: number | null;
  videoRealized: number | null;
  visitChecked: boolean | null;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updatePoiRealisasi,
    null
  );
  return (
    <form action={action} className="inline-form" style={{ gap: 6 }}>
      <input type="hidden" name="id" value={dealId} />
      <div>
        <label style={{ fontSize: 10 }}>Listing</label>
        <input type="date" name="listing_date" defaultValue={listingDate ?? ""} style={{ width: 132 }} />
      </div>
      <div>
        <label style={{ fontSize: 10 }}>Tgl Visit</label>
        <input
          type="date"
          name="visit_realized_date"
          defaultValue={visitRealizedDate ?? ""}
          style={{ width: 132 }}
        />
      </div>
      <div>
        <label style={{ fontSize: 10 }}>Kreator</label>
        <input
          type="number"
          name="kreator_realized"
          min={0}
          defaultValue={kreatorRealized ?? ""}
          style={{ width: 60 }}
        />
      </div>
      <div>
        <label style={{ fontSize: 10 }}>Video</label>
        <input
          type="number"
          name="video_realized"
          min={0}
          defaultValue={videoRealized ?? ""}
          style={{ width: 60 }}
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
        <input type="checkbox" name="visit_checked" defaultChecked={!!visitChecked} />
        checked
      </label>
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Simpan"}
      </button>
      {state && (
        <span className={state.ok ? "badge green" : "badge red"} title={state.message}>
          {state.ok ? "tersimpan" : "gagal"}
        </span>
      )}
    </form>
  );
}

// CreatePoiFinanceForm: tombol "Buat Transaksi" utk deal Berbayar tanpa transaction_id.
export function CreatePoiFinanceForm({ dealId }: { dealId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createPoiFinanceAction,
    null
  );
  return (
    <form action={action} className="inline-form" style={{ gap: 4, marginTop: 4 }}>
      <input type="hidden" name="id" value={dealId} />
      <select name="payment_intent" defaultValue="Lunas" style={{ width: 140 }}>
        {PAYMENT_INTENT_OPTIONS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Buat Transaksi"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
      {state && state.ok && <span className="badge green">{state.message}</span>}
    </form>
  );
}

// DealsMainTabs: shell TAB level-atas halaman ("Dealing POI" / "Deals Shop (MCN)" /
// "Summary"). Konten tiap tab dirender di page.tsx (server component, bisa memuat
// client component lain seperti form di atas) lalu dilewatkan sbg slot ReactNode —
// menjaga fetch data & role gate tetap di server.
export function DealsMainTabs({
  poi,
  shop,
  summary,
}: {
  poi: ReactNode;
  shop: ReactNode;
  summary: ReactNode;
}) {
  const [tab, setTab] = useState<"poi" | "shop" | "summary">("poi");
  return (
    <>
      <div className="actions-row" style={{ marginBottom: 14 }}>
        <button className={tab === "poi" ? "sm" : "sm ghost2"} type="button" onClick={() => setTab("poi")}>
          Dealing POI
        </button>
        <button className={tab === "shop" ? "sm" : "sm ghost2"} type="button" onClick={() => setTab("shop")}>
          Deals Shop (MCN)
        </button>
        <button
          className={tab === "summary" ? "sm" : "sm ghost2"}
          type="button"
          onClick={() => setTab("summary")}
        >
          Summary
        </button>
      </div>
      {tab === "poi" && poi}
      {tab === "shop" && shop}
      {tab === "summary" && summary}
    </>
  );
}
