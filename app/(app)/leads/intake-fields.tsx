"use client";

import { useState } from "react";
import {
  BRAND_CATEGORIES,
  INTAKE_SOURCES,
  WILAYAH,
  normalizePhone62,
  type BrandCategory,
} from "@/lib/leads/intake";

export type BdOption = { id: string; full_name: string };
export type BusinessTypeOptions = Record<BrandCategory, string[]>;

export type IntakeDefaults = {
  bd_employee_id?: string;
  brand_name?: string;
  brand_category?: BrandCategory | "";
  business_type?: string;
  wilayah?: string;
  source?: string;
  pic_name_position?: string;
  pic_phone?: string;
  web_socmed_link?: string;
};

// Kolom form intake BD, dipakai bersama oleh NewLeadModal ("Daftar Lead") dan
// EditLeadModal ("Edit" di kolom Aksi Pool Lead) — satu tempat supaya kedua form
// tidak pernah menyimpang. `idPrefix` menjaga id <datalist> tetap unik kalau ada
// lebih dari satu instance ter-mount sekaligus (form Daftarkan + modal Edit).
export function IntakeFormFields({
  idPrefix,
  bdOptions,
  businessTypeOptions,
  defaults,
}: {
  idPrefix: string;
  bdOptions: BdOption[];
  businessTypeOptions: BusinessTypeOptions;
  defaults?: IntakeDefaults;
}) {
  const [category, setCategory] = useState<BrandCategory | "">(defaults?.brand_category ?? "");
  const [waPhone, setWaPhone] = useState(defaults?.pic_phone ?? "");
  const datalistId = `${idPrefix}-business-type-options`;

  return (
    <>
      <div className="row">
        <div>
          <label>Nama BD *</label>
          <select name="bd_employee_id" defaultValue={defaults?.bd_employee_id ?? ""} required>
            <option value="" disabled>
              Pilih BD…
            </option>
            {bdOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Brand / Merchant / POI *</label>
          <input name="brand_name" defaultValue={defaults?.brand_name ?? ""} required />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Kategori Brand</label>
          <select
            name="brand_category"
            value={category}
            onChange={(e) => setCategory(e.target.value as BrandCategory | "")}
          >
            <option value="">— pilih kategori —</option>
            {BRAND_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Jenis Usaha</label>
          <input
            name="business_type"
            list={datalistId}
            defaultValue={defaults?.business_type ?? ""}
            placeholder={category ? "Pilih dari daftar atau ketik baru…" : "— pilih kategori dulu —"}
            disabled={!category}
          />
          <datalist id={datalistId}>
            {(category ? businessTypeOptions[category] ?? [] : []).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Wilayah (Provinsi)</label>
          <select name="wilayah" defaultValue={defaults?.wilayah ?? ""}>
            <option value="">— pilih wilayah —</option>
            {WILAYAH.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Source</label>
          <select name="source" defaultValue={defaults?.source ?? ""}>
            <option value="">— pilih source —</option>
            {INTAKE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Nama &amp; Posisi PIC</label>
          <input
            name="pic_name_position"
            defaultValue={defaults?.pic_name_position ?? ""}
            placeholder="mis. Budi — Marketing Manager"
          />
        </div>
        <div>
          <label>Kontak PIC (HP / WhatsApp)</label>
          <input
            name="pic_phone"
            inputMode="tel"
            placeholder="628123456789"
            value={waPhone}
            onChange={(e) => setWaPhone(e.target.value)}
            // Diketik bebas (0812…, +62 812…), dirapikan ke awalan 62 saat blur;
            // server + trigger DB menormalkan ulang sebagai otoritasnya.
            onBlur={(e) => setWaPhone(normalizePhone62(e.target.value) ?? "")}
          />
        </div>
      </div>
      <label>Link website / akun sosmed</label>
      <input
        name="web_socmed_link"
        defaultValue={defaults?.web_socmed_link ?? ""}
        placeholder="instagram.com/… atau https://…"
      />
    </>
  );
}
