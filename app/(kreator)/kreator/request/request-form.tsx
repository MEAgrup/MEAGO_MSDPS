"use client";

import { useActionState, useMemo, useState } from "react";
import { createPortalRequest, type ActionResult } from "@/lib/actions/portal";
import {
  PORTAL_REQUEST_TYPES,
  MERCHANT_TARGET_TYPES,
  NOMINAL_TYPES,
  requestTypeLabel,
} from "@/lib/mcn/request-types";

export type PortalMerchant = {
  id: string;
  nama_toko: string;
  kota: string | null;
  kategori: string | null;
};

// Filter merchant per kategori jenis (cocokkan lower(kategori) contains — kategori M4
// teks bebas). free_meal→dining; visit→accommodation/things to do.
function filterMerchants(merchants: PortalMerchant[], type: string): PortalMerchant[] {
  const keywords = MERCHANT_TARGET_TYPES[type];
  if (!keywords) return [];
  return merchants.filter((m) => {
    const kat = (m.kategori ?? "").toLowerCase();
    return keywords.some((k) => kat.includes(k));
  });
}

export function RequestForm({ merchants }: { merchants: PortalMerchant[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    createPortalRequest,
    null
  );
  const [type, setType] = useState<string>(PORTAL_REQUEST_TYPES[0]);
  const [merchantSel, setMerchantSel] = useState<string>("");

  const isMerchantTarget = type in MERCHANT_TARGET_TYPES;
  const isNominal = NOMINAL_TYPES.includes(type);
  const options = useMemo(
    () => (isMerchantTarget ? filterMerchants(merchants, type) : []),
    [merchants, type, isMerchantTarget]
  );
  const showBrandText = isMerchantTarget && merchantSel === "__other__";

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 460 }}>
      {state && (
        <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>
      )}

      <label>
        Jenis request
        <select
          name="type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setMerchantSel("");
          }}
        >
          {PORTAL_REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>
              {requestTypeLabel(t)}
            </option>
          ))}
        </select>
      </label>

      {isMerchantTarget && (
        <label>
          Merchant tujuan
          <select
            name="target_merchant_id"
            value={merchantSel}
            onChange={(e) => setMerchantSel(e.target.value)}
          >
            <option value="">— pilih merchant —</option>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nama_toko}
                {m.kota ? ` — ${m.kota}` : ""}
              </option>
            ))}
            <option value="__other__">Lainnya (belum terdaftar)</option>
          </select>
        </label>
      )}

      {showBrandText && (
        <label>
          Nama brand / merchant (teks bebas)
          <input name="target_brand" placeholder="mis. Kopi Nako Dago" />
        </label>
      )}

      {isNominal && (
        <label>
          Nominal (rupiah)
          <input name="nominal" inputMode="numeric" placeholder="mis. 1.500.000" />
        </label>
      )}

      <label>
        Detail (opsional)
        <textarea name="detail" rows={3} placeholder="Keterangan tambahan…" />
      </label>

      <button type="submit" disabled={pending} style={{ alignSelf: "flex-start" }}>
        {pending ? "Mengajukan…" : "Ajukan Request"}
      </button>
    </form>
  );
}
