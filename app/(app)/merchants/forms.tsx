"use client";

import { useActionState } from "react";
import { closeDeal, type ActionResult } from "@/lib/actions/merchants";
import { INDUSTRIES } from "@/lib/mcn/industries";

type Nego = { attempt_id: string; label: string };

const SERVICE_TYPES = ["KOL-Video", "KOL-Live", "E-commerce", "Ads", "Live Stream"];
const PAYMENT_INTENTS = ["Lunas", "Bayar Sebagian", "Termin", "Bayar di Belakang"];
// Kategori merchant TikTok GO — daftar final 3 industri (keputusan 2026-07-16), sumber
// tunggal di lib/mcn/industries.ts.
const KATEGORI = [...INDUSTRIES];

export function CloseDealForm({ negotiations }: { negotiations: Nego[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(closeDeal, null);

  if (negotiations.length === 0) {
    return (
      <p className="muted">
        Tidak ada prospek di tahap [Negotiation] yang bisa Anda closing. Majukan prospek di menu
        Leads &amp; Prospek terlebih dahulu.
      </p>
    );
  }

  return (
    <form action={action}>
      {state && <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>}
      <label>Prospek yang di-closing *</label>
      <select name="attempt_id" defaultValue="" required>
        <option value="" disabled>
          Pilih prospek [Negotiation]…
        </option>
        {negotiations.map((n) => (
          <option key={n.attempt_id} value={n.attempt_id}>
            {n.label}
          </option>
        ))}
      </select>

      <div className="row">
        <div>
          <label>Nama Toko *</label>
          <input name="nama_toko" required />
        </div>
        <div>
          <label>Kota *</label>
          <input name="kota" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Link Toko *</label>
          <input name="link_toko" placeholder="https://…" required />
        </div>
        <div>
          <label>Kategori *</label>
          <select name="kategori" defaultValue="" required>
            <option value="" disabled>
              Pilih kategori…
            </option>
            {KATEGORI.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>GMV Baseline (Rp) *</label>
          <input name="gmv_baseline" type="number" min={0} step="1000" required />
        </div>
        <div>
          <label>Target GMV (Rp) *</label>
          <input name="target_gmv" type="number" min={0} step="1000" required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Total Fee Disepakati (Rp) *</label>
          <input name="total_fee" type="number" min={1} step="1000" required />
        </div>
        <div>
          <label>Skema Pembayaran *</label>
          <select name="payment_intent" defaultValue="" required>
            <option value="" disabled>
              Pilih skema…
            </option>
            {PAYMENT_INTENTS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label>Layanan yang Dibeli * (à la carte, minimal satu)</label>
      <div className="checks" style={{ flexWrap: "wrap" }}>
        {SERVICE_TYPES.map((s) => (
          <label key={s}>
            <input type="checkbox" name="service_types" value={s} /> {s}
          </label>
        ))}
      </div>

      <button type="submit" disabled={pending}>
        {pending ? "Memproses closing…" : "Closing Deal"}
      </button>
    </form>
  );
}
