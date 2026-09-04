"use client";

import { useMemo, useState } from "react";
import { LeadPicker, type PoolLead } from "../leads/pool";
import type { BdOption } from "../leads/intake-fields";
import { BRAND_CATEGORIES, normalizePhone62, type BrandCategory } from "@/lib/leads/intake";
import { OPS_NAMES, BENTUK_KERJASAMA, type BentukKerjasama } from "@/lib/deals/intake";

export type DealIntakeDefaults = {
  lead_id?: string;
  bd_id?: string;
  ops_name?: string;
  kategori_poi?: BrandCategory | "";
  pic_name?: string;
  pic_whatsapp?: string;
  tanggal_mulai_kontrak?: string;
  tanggal_akhir_kontrak?: string;
  bentuk_kerjasama?: BentukKerjasama | "";
  nominal_harga?: number;
  benefit?: string;
  visit_mulai?: string;
  visit_berakhir?: string;
  kreator_needed?: number | "";
  konten_needed?: number | "";
  total_jam_live?: number | "";
  brief_link?: string;
};

// Kolom form "Daftarkan Transaksi" (tab Merchant Deals), dipakai bersama oleh
// RegisterDealModal dan EditDealModal — satu tempat supaya kedua
// form tidak pernah menyimpang. Memilih POI/Merchant otomatis menyarankan
// Nama BD / Kategori POI / PIC / WhatsApp dari data Pool Lead yang sudah ada.
//
// nominalHistoryByLead: nominal transaksi brand_deals yang sudah pernah
// tercatat, dikelompokkan per lead_id — dipakai sebagai saran "Nominal Deals"
// bersama nominal_bayar lead-nya sendiri.
export function DealIntakeFields({
  idPrefix,
  dealingLeads,
  bdOptions,
  benefitOptions,
  nominalHistoryByLead,
  defaults,
}: {
  idPrefix: string;
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  benefitOptions: string[];
  nominalHistoryByLead?: Record<string, number[]>;
  defaults?: DealIntakeDefaults;
}) {
  const [leadId, setLeadId] = useState(defaults?.lead_id ?? "");
  const [bdId, setBdId] = useState(defaults?.bd_id ?? "");
  const [kategori, setKategori] = useState<BrandCategory | "">(defaults?.kategori_poi ?? "");
  const [picName, setPicName] = useState(defaults?.pic_name ?? "");
  const [waNumber, setWaNumber] = useState(defaults?.pic_whatsapp ?? "");
  const [bentuk, setBentuk] = useState<BentukKerjasama | "">(defaults?.bentuk_kerjasama ?? "");
  const [nominal, setNominal] = useState(defaults?.nominal_harga != null ? String(defaults.nominal_harga) : "");
  const benefitDatalistId = `${idPrefix}-benefit-options`;
  const picDatalistId = `${idPrefix}-pic-options`;
  const waDatalistId = `${idPrefix}-wa-options`;
  const nominalDatalistId = `${idPrefix}-nominal-options`;

  // Saran nominal deals SELALU terikat ke POI/Merchant yang sedang dipilih —
  // bukan seluruh nominal yang pernah ada di pipeline (itu cuma bikin BD
  // salah pilih angka milik brand lain). Sumbernya dua: nominal_bayar lead
  // terkait (dicatat BD saat status Dealing/Renewal) + nominal transaksi
  // brand_deals yang sudah pernah tercatat untuk lead yang sama (riwayat,
  // mis. saat Renewal). Sebelum POI dipilih, datalist sengaja kosong.
  const nominalOptions = useMemo(() => {
    if (!leadId) return [];
    const lead = dealingLeads.find((l) => l.id === leadId);
    const values = [
      ...(lead?.nominal_bayar ? [lead.nominal_bayar] : []),
      ...(nominalHistoryByLead?.[leadId] ?? []),
    ].filter((n): n is number => Number.isFinite(n) && n > 0);
    return Array.from(new Set(values)).sort((a, b) => b - a);
  }, [leadId, dealingLeads, nominalHistoryByLead]);

  const selectedLeadLabel = useMemo(() => {
    const lead = dealingLeads.find((l) => l.id === leadId);
    return lead ? (lead.brand_name ?? lead.lead_name) : "";
  }, [leadId, dealingLeads]);

  function onSelectLead(id: string) {
    setLeadId(id);
    const lead = dealingLeads.find((l) => l.id === id);
    if (!lead) return;
    if (lead.bd_employee_id) setBdId(lead.bd_employee_id);
    if (lead.brand_category) setKategori(lead.brand_category as BrandCategory);
    if (lead.pic_name_position) setPicName(lead.pic_name_position);
    if (lead.pic_phone) setWaNumber(lead.pic_phone);
    if (lead.nominal_bayar) setNominal(String(lead.nominal_bayar));
  }

  function onBentukChange(v: BentukKerjasama | "") {
    setBentuk(v);
    if (v === "Free/Barter") setNominal("0");
  }

  return (
    <>
      <label>Nama POI / Merchant (Dealing / Renewal) *</label>
      <LeadPicker leads={dealingLeads} value={leadId} onChange={onSelectLead} />

      <div className="row">
        <div>
          <label>Nama BD *</label>
          <select name="bd_id" value={bdId} onChange={(e) => setBdId(e.target.value)} required>
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
          <label>Nama OPS *</label>
          <select name="ops_name" defaultValue={defaults?.ops_name ?? ""} required>
            <option value="" disabled>
              Pilih OPS…
            </option>
            {OPS_NAMES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div>
          <label>Kategori POI *</label>
          <select
            name="kategori_poi"
            value={kategori}
            onChange={(e) => setKategori(e.target.value as BrandCategory | "")}
            required
          >
            <option value="" disabled>
              Pilih kategori…
            </option>
            {BRAND_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Bentuk Kerja Sama *</label>
          <select
            name="bentuk_kerjasama"
            value={bentuk}
            onChange={(e) => onBentukChange(e.target.value as BentukKerjasama | "")}
            required
          >
            <option value="" disabled>
              Pilih…
            </option>
            {BENTUK_KERJASAMA.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="row">
        <div>
          <label>Nama PIC POI *</label>
          <input
            name="pic_name"
            list={picDatalistId}
            value={picName}
            onChange={(e) => setPicName(e.target.value)}
            required
          />
          <datalist id={picDatalistId}>
            {Array.from(
              new Set(dealingLeads.map((l) => l.pic_name_position).filter((v): v is string => !!v))
            ).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
        <div>
          <label>Nomor WhatsApp *</label>
          <input
            name="pic_whatsapp"
            inputMode="tel"
            list={waDatalistId}
            value={waNumber}
            placeholder="628123456789"
            onChange={(e) => setWaNumber(e.target.value)}
            onBlur={(e) => setWaNumber(normalizePhone62(e.target.value) ?? "")}
            required
          />
          <datalist id={waDatalistId}>
            {Array.from(new Set(dealingLeads.map((l) => l.pic_phone).filter((v): v is string => !!v))).map(
              (v) => (
                <option key={v} value={v} />
              )
            )}
          </datalist>
        </div>
      </div>

      {kategori === "Dining" && (
        <div className="row">
          <div>
            <label>Tanggal Awal Kerjasama *</label>
            <input
              type="date"
              name="tanggal_mulai_kontrak"
              defaultValue={defaults?.tanggal_mulai_kontrak ?? ""}
              required
            />
          </div>
          <div>
            <label>Tanggal Akhir Kerjasama *</label>
            <input
              type="date"
              name="tanggal_akhir_kontrak"
              defaultValue={defaults?.tanggal_akhir_kontrak ?? ""}
              required
            />
          </div>
        </div>
      )}

      <label>Nominal Deals *</label>
      <input
        name="nominal_harga"
        type="number"
        min="0"
        step="1"
        list={nominalDatalistId}
        value={nominal}
        onChange={(e) => setNominal(e.target.value)}
        readOnly={bentuk === "Free/Barter"}
        required
      />
      <datalist id={nominalDatalistId}>
        {nominalOptions.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {bentuk === "Free/Barter" && <p className="hint">Otomatis 0 untuk Free/Barter.</p>}
      {bentuk !== "Free/Barter" && !leadId && (
        <p className="hint">Pilih POI/Merchant dulu untuk melihat saran nominal dari data sebelumnya.</p>
      )}
      {bentuk !== "Free/Barter" && leadId && nominalOptions.length > 0 && (
        <p className="hint">
          Saran nominal dari data sebelumnya milik {selectedLeadLabel || "POI/Merchant ini"} — pilih dari daftar
          atau ketik manual.
        </p>
      )}
      {bentuk !== "Free/Barter" && leadId && nominalOptions.length === 0 && (
        <p className="hint">Belum ada nominal tercatat untuk {selectedLeadLabel || "POI/Merchant ini"} — isi manual.</p>
      )}

      <label>Benefit Diberikan *</label>
      <input name="benefit" list={benefitDatalistId} defaultValue={defaults?.benefit ?? ""} required />
      <datalist id={benefitDatalistId}>
        {benefitOptions.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>

      <div className="row">
        <div>
          <label>Visit Dimulai *</label>
          <input
            type="datetime-local"
            name="visit_mulai"
            defaultValue={defaults?.visit_mulai ?? ""}
            required
          />
        </div>
        <div>
          <label>Visit Berakhir *</label>
          <input
            type="datetime-local"
            name="visit_berakhir"
            defaultValue={defaults?.visit_berakhir ?? ""}
            required
          />
        </div>
      </div>

      <div className="row">
        <div>
          <label>Jumlah Kreator *</label>
          <input
            name="kreator_needed"
            type="number"
            min="0"
            step="1"
            defaultValue={defaults?.kreator_needed ?? ""}
            required
          />
        </div>
        <div>
          <label>Jumlah Konten</label>
          <input name="konten_needed" type="number" min="0" step="1" defaultValue={defaults?.konten_needed ?? ""} />
        </div>
      </div>

      <label>Total Jam Live</label>
      <input name="total_jam_live" type="number" min="0" step="0.5" defaultValue={defaults?.total_jam_live ?? ""} />

      <label>Link Brief / Brief</label>
      <textarea name="brief_link" rows={3} defaultValue={defaults?.brief_link ?? ""} />
    </>
  );
}
