"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { num, rupiah, tanggal } from "@/lib/format";
import {
  updateDealTransaction,
  deleteDealTransaction,
  deleteDealTransactionsBulk,
  approveDealChangeRequest,
  rejectDealChangeRequest,
  cancelDealChangeRequest,
  createPoiFinance,
  type ActionResult,
} from "@/lib/actions/deals";
import { addBridgeLines } from "@/lib/actions/bridge";
import { DealIntakeFields } from "./intake-fields";
import { DealsToolbar } from "./forms";
import type { BdOption } from "../leads/intake-fields";
import type { PoolLead } from "../leads/pool";
import type { BrandCategory } from "@/lib/leads/intake";
import type { BentukKerjasama } from "@/lib/deals/intake";
import { exportRowsToExcel } from "@/lib/xlsx-export";

export type Deal = {
  id: string;
  code: string | null;
  unique_id: string | null;
  brand_name: string;
  lead_id: string | null;
  bd_id: string | null;
  ops_name: string | null;
  kategori_poi: string | null;
  pic_name: string | null;
  pic_whatsapp: string | null;
  tanggal_mulai_kontrak: string | null;
  tanggal_akhir_kontrak: string | null;
  bentuk_kerjasama: string | null;
  nominal_harga: number;
  benefit: string | null;
  visit_start_date: string | null;
  visit_start_time: string | null;
  visit_end_date: string | null;
  visit_end_time: string | null;
  kreator_needed: number | null;
  konten_needed: number | null;
  total_jam_live: number | null;
  brief_link: string | null;
  // B0 (bridge MSDPS→CDPS Fase 1) — null selama nol transaksi Finance dibuat
  // untuk deal ini; begitu terisi, "Buat Transaksi Finance" tidak lagi tampil
  // (create_poi_finance() sendiri menolak dobel: [transaksi untuk deal ini
  // sudah dibuat]).
  transaction_id: string | null;
  created_at: string;
};

// Satu baris antrian approval Director (tabel deal_change_requests, migrasi
// 0349) — BD/CM mengajukan Edit/Lengkapi Data/Hapus, Director yang menerapkan.
export type DealChangeRequest = {
  id: string;
  deal_id: string | null;
  deal_code: string | null;
  deal_brand_name: string;
  action: "update" | "delete";
  payload: Record<string, string> | null;
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

// Baris hasil Import Master Deal tidak pernah mengisi kategori_poi (lihat
// importMasterDeal) — trigger brand_deals_validate mewajibkan seluruh
// field POI begitu kategori_poi terisi, jadi kategori_poi kosong = pasti
// belum dilengkapi manual. Satu kondisi ini cukup jadi penanda "belum lengkap".
function isIncomplete(d: Deal): boolean {
  return !d.kategori_poi;
}

function toDatetimeLocal(date: string | null, time: string | null): string {
  if (!date) return "";
  return `${date}T${(time ?? "00:00").slice(0, 5)}`;
}

function visitLabel(startDate: string | null, startTime: string | null, endDate: string | null, endTime: string | null): string {
  if (!startDate) return "—";
  const start = `${tanggal(startDate)} ${(startTime ?? "").slice(0, 5)}`;
  if (!endDate) return start;
  const end = `${tanggal(endDate)} ${(endTime ?? "").slice(0, 5)}`;
  return `${start} – ${end}`;
}

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

// EditDealModal — tombol "Edit" (atau "Lengkapi Data" untuk baris hasil Import
// Master Deal) per baris. Memakai DealIntakeFields yang sama dengan
// RegisterDealModal supaya field tidak pernah menyimpang.
function DeleteDealButton({
  dealId,
  label,
  needsApproval,
  blocked,
}: {
  dealId: string;
  label: string;
  needsApproval: boolean;
  blocked: boolean;
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteDealTransaction, null);
  return (
    <form
      action={action}
      className="inline-form"
      onSubmit={(e) => {
        const msg = needsApproval
          ? `Ajukan penghapusan deal "${label}" ke Director? Deal baru terhapus setelah di-accept.`
          : `Hapus deal "${label}"? Tindakan ini tidak dapat dibatalkan.`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <input type="hidden" name="deal_id" value={dealId} />
      <button
        className="sm dangerbtn"
        disabled={pending || blocked}
        title={
          blocked
            ? "Masih ada permintaan yang menunggu approval Director untuk deal ini"
            : needsApproval
              ? "Butuh approval Director sebelum deal benar-benar dihapus"
              : undefined
        }
      >
        {pending ? "…" : needsApproval ? "Ajukan Hapus" : "Hapus"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

// CreatePoiFinanceButton (B0, bridge MSDPS→CDPS Fase 1) — sambungan UI ke
// create_poi_finance() (SQL, sudah ada di staging+production, nol pemanggil
// sampai sekarang). Hanya tampil untuk deal Berbayar yang belum punya
// transaction_id — begitu ada, Finance yang mengambil alih lewat /finance
// (verify_payment()), dan barisnya membuka gerbang bridge (D4+D13).
function CreatePoiFinanceButton({ dealId, label }: { dealId: string; label: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createPoiFinance, null);
  return (
    <form
      action={action}
      className="inline-form"
      onSubmit={(e) => {
        if (!confirm(`Buat transaksi Finance untuk "${label}"? Nilainya = nominal harga deal.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="deal_id" value={dealId} />
      <select name="payment_intent" defaultValue="Lunas" className="sm">
        <option value="Lunas">Lunas</option>
        <option value="Bayar Sebagian">Bayar Sebagian</option>
        <option value="Termin">Termin</option>
        <option value="Bayar di Belakang">Bayar di Belakang</option>
      </select>
      <button className="sm" disabled={pending}>
        {pending ? "…" : "Buat Transaksi Finance"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

// Bridge MSDPS→CDPS Fase 1 (B4) — "Teruskan ke CDPS" + status pengiriman.
// Satu order per deal seumur Fase 1 (idempotency_key terkunci ke
// payload_versi=1) — begitu bridgeInfo ada, tombol diganti badge status,
// bukan dibiarkan bisa dipencet lagi.
const BRIDGE_JENIS = ["Account", "Ads", "Creative", "Store Operation", "KOL-Non-Roster", "Live Stream"] as const;
type BridgeJenis = (typeof BRIDGE_JENIS)[number];
type BridgeLineDraft = {
  jenis: BridgeJenis;
  qty: string;
  catatan: string;
  alasan_non_roster: string;
  nilai_cross_charge: string;
};
const emptyBridgeLine = (): BridgeLineDraft => ({
  jenis: "Account",
  qty: "1",
  catatan: "",
  alasan_non_roster: "",
  nilai_cross_charge: "",
});

// Referensi harga resmi paket MEAGO (dokumen "Merchant Existing TikTok GO
// Package — Sept"), murni untuk BANTU BD/CM mengetik `nilai_cross_charge`
// per baris di atas — TIDAK mengisi apa pun otomatis. Alokasi ke satu/lebih
// baris jenis (Account/Ads/Creative/Store Operation/KOL-Non-Roster/Live Stream,
// D2 dibalik 2026-09-12 — lihat docs/BUILD_PLAN.md baris Bridge) tetap
// keputusan manusia: satu fee paket sering membundel Live + Content, jadi
// tidak ada pemecahan mekanis yang aman ditebak di sini.
const MEAGO_PACKAGE_REFERENCE: { nama: string; tiers: string }[] = [
  { nama: "1. Starter Pack", tiers: "Rp 8.000.000 (2 bln, sharing commission 8%)" },
  { nama: "2. Content Package", tiers: "Reguler Rp 15.000.000 · Premium Rp 35.000.000 · Premium+ Rp 75.000.000" },
  { nama: "3. Content + Sharing Commission", tiers: "Reguler Rp 12.000.000 (share 10%) · Premium Rp 25.000.000 (8%) · Premium+ Rp 60.000.000 (8%)" },
  { nama: "4. Content 1 Bulan (Basic)", tiers: "Rp 25.000.000" },
  { nama: "5. Content Package (varian lain)", tiers: "Reguler Rp 37.500.000 · Premium Rp 90.000.000" },
  { nama: "6. Live Non-Exclusive", tiers: "Reguler Rp 6.000.000 · Premium Rp 20.000.000 · Premium+ Rp 36.000.000" },
  { nama: "7. Live Exclusive", tiers: "Reguler Rp 12.000.000 · Premium Rp 36.000.000 · Premium+ Rp 60.000.000" },
  { nama: "8. Live on Brand Account", tiers: "Reguler Rp 17.000.000 · Premium Rp 34.500.000 · Premium+ Rp 52.000.000" },
  { nama: "9. Live Brand + Sharing Commission", tiers: "Reguler Rp 12.000.000 · Premium Rp 18.000.000 · Premium+ Rp 36.000.000" },
  { nama: "10. Live Brand + Creator", tiers: "Reguler Rp 17.280.000 · Premium Rp 51.840.000 · Premium+ Rp 86.400.000" },
  { nama: "11. Bundling Content + Live Non-Exclusive", tiers: "Reguler Rp 14.000.000 · Premium Rp 37.500.000 · Premium+ Rp 80.000.000" },
  { nama: "12. Bundling Content + Live on Brand Account", tiers: "Reguler Rp 46.500.000 · Premium Rp 97.500.000 · Premium+ Rp 181.000.000" },
  { nama: "13. Bundling Super Brand Day / Premium / Premium+", tiers: "SBD Rp 85.000.000 · Premium Rp 145.000.000 · Premium+ Rp 240.000.000" },
  { nama: "14. Bundling Platinum", tiers: "Rp 300.000.000 (1 tahun)" },
  { nama: "15. Bundling Super Brand Day (varian)", tiers: "Rp 300.000.000 (1 bulan)" },
  { nama: "16. MEAGO Growth Program", tiers: "Varian A: 3 bln Rp 19.000.000 / 6 bln Rp 10.000.000 · Varian B: 3 bln Rp 30.000.000 / 6 bln Rp 15.000.000" },
];

function MeagoPriceReference() {
  return (
    <details className="bridge-price-ref">
      <summary>Lihat harga resmi paket MEAGO (referensi cross-charge)</summary>
      <p className="hint">
        Bukan pengisi otomatis — cek nilai deal ini terhadap harga resmi di
        bawah, lalu ketik alokasinya sendiri di kolom &quot;Nilai cross-charge&quot;
        per baris. Fee sering membundel Live (tidak pernah dibridge ke CDPS) +
        Content, jadi porsi yang masuk cross-charge tiap baris jenis tetap
        keputusan BD/CM.
      </p>
      <table className="bridge-price-ref-table">
        <tbody>
          {MEAGO_PACKAGE_REFERENCE.map((p) => (
            <tr key={p.nama}>
              <td>{p.nama}</td>
              <td>{p.tiers}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function BridgeStatusBadge({ info }: { info: { status: string; ord_code: string | null; last_error: string | null } }) {
  if (info.status === "sent") {
    return (
      <span className="badge green mono" title="Diterima antrian CDPS">
        {info.ord_code ?? "ORD-…"}
      </span>
    );
  }
  if (info.status === "dead") {
    return (
      <span className="badge red" title={info.last_error ?? "Gagal permanen — hubungi engineering"}>
        Gagal permanen
      </span>
    );
  }
  if (info.status === "failed") {
    return (
      <span className="badge amber" title={info.last_error ?? "Akan dicoba lagi otomatis"}>
        Gagal, dicoba lagi
      </span>
    );
  }
  return (
    <span className="badge indigo" title="Menunggu delivery job berikutnya">
      Menunggu kirim
    </span>
  );
}

function BridgeLinesModal({
  deal,
  verified,
  bridgeInfo,
}: {
  deal: Deal;
  verified: boolean;
  bridgeInfo?: { status: string; ord_code: string | null; last_error: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BridgeLineDraft[]>([emptyBridgeLine()]);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addBridgeLines, null);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  if (bridgeInfo) return <BridgeStatusBadge info={bridgeInfo} />;

  const blockedReason =
    deal.bentuk_kerjasama !== "Berbayar"
      ? "[deal free/barter tidak dikerjakan CDPS]"
      : !deal.transaction_id
        ? "Belum ada transaksi Finance untuk deal ini"
        : !verified
          ? "Pembayaran belum terverifikasi Finance"
          : null;

  function updateRow(i: number, patch: Partial<BridgeLineDraft>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <>
      <button
        type="button"
        className="sm ghost2"
        disabled={!!blockedReason}
        title={blockedReason ?? "Pilih layanan yang dikerjakan MEA Agency lewat CDPS"}
        onClick={() => setOpen(true)}
      >
        Teruskan ke CDPS
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Teruskan ke CDPS{deal.code ? ` · ${deal.code}` : ""}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                {state && !state.ok && <div className="err">{state.message}</div>}
                <p className="hint">
                  Layanan yang dipilih dikirim ke MEA Agency (CDPS) sebagai satu order — tidak bisa
                  ditambah lagi setelah terkirim.
                </p>
                <input type="hidden" name="deal_id" value={deal.id} />
                <input type="hidden" name="lines_json" value={JSON.stringify(rows)} />
                <MeagoPriceReference />
                {rows.map((r, i) => (
                  <div key={i} className="bridge-line-row">
                    <select
                      value={r.jenis}
                      onChange={(e) => updateRow(i, { jenis: e.target.value as BridgeJenis })}
                    >
                      {BRIDGE_JENIS.map((j) => (
                        <option key={j} value={j}>
                          {j}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      placeholder="qty"
                      value={r.qty}
                      onChange={(e) => updateRow(i, { qty: e.target.value })}
                      style={{ width: 70 }}
                    />
                    <input
                      type="text"
                      placeholder="Catatan"
                      value={r.catatan}
                      onChange={(e) => updateRow(i, { catatan: e.target.value })}
                    />
                    <input
                      type="text"
                      placeholder="Nilai cross-charge (Rp)"
                      value={r.nilai_cross_charge}
                      onChange={(e) => updateRow(i, { nilai_cross_charge: e.target.value })}
                    />
                    {r.jenis === "KOL-Non-Roster" && (
                      <input
                        type="text"
                        placeholder="Alasan non-roster (wajib)"
                        value={r.alasan_non_roster}
                        onChange={(e) => updateRow(i, { alasan_non_roster: e.target.value })}
                      />
                    )}
                    <button
                      type="button"
                      className="sm dangerbtn"
                      disabled={rows.length === 1}
                      onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                    >
                      Hapus
                    </button>
                  </div>
                ))}
                <button type="button" className="sm ghost2" onClick={() => setRows((rs) => [...rs, emptyBridgeLine()])}>
                  + Tambah Layanan
                </button>
              </div>
              <div className="modal-foot">
                <button type="button" onClick={() => setOpen(false)}>
                  Batal
                </button>
                <button disabled={pending}>{pending ? "Mengirim…" : "Teruskan ke CDPS"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function BulkDeleteBar({ ids, needsApproval }: { ids: string[]; needsApproval: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    deleteDealTransactionsBulk,
    null
  );
  return (
    <form
      action={action}
      className="inline-form"
      onSubmit={(e) => {
        const msg = needsApproval
          ? `Ajukan penghapusan ${ids.length} deal terpilih ke Director?`
          : `Hapus ${ids.length} deal terpilih? Tindakan ini tidak dapat dibatalkan.`;
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="deal_ids" value={id} />
      ))}
      <button className="sm dangerbtn" disabled={pending || ids.length === 0}>
        {pending
          ? needsApproval
            ? "Mengirim…"
            : "Menghapus…"
          : needsApproval
            ? `Ajukan Hapus ${ids.length} Terpilih`
            : `Hapus ${ids.length} Terpilih`}
      </button>
      {state && <Msg state={state} />}
    </form>
  );
}

function EditDealModal({
  deal,
  dealingLeads,
  bdOptions,
  benefitOptions,
  nominalHistoryByLead,
  needsApproval,
  blocked,
}: {
  deal: Deal;
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  benefitOptions: string[];
  nominalHistoryByLead?: Record<string, number[]>;
  needsApproval: boolean;
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateDealTransaction,
    null
  );
  const incomplete = isIncomplete(deal);
  // Jalur approval: modal TIDAK ditutup begitu sukses — yang terjadi bukan
  // "tersimpan" tapi "menunggu di-accept Director", dan itu harus terbaca
  // pemohonnya. Jalur Director tetap menutup modal seperti sebelumnya.
  const sentForApproval = needsApproval && state?.ok === true;

  useEffect(() => {
    if (state?.ok && !needsApproval) setOpen(false);
  }, [state, needsApproval]);

  return (
    <>
      <button
        type="button"
        className={incomplete ? "sm" : "sm ghost2"}
        onClick={() => setOpen(true)}
        disabled={blocked}
        title={
          blocked
            ? "Masih ada permintaan yang menunggu approval Director untuk deal ini"
            : needsApproval
              ? "Perubahan dikirim ke Director untuk disetujui"
              : undefined
        }
      >
        {incomplete ? "Lengkapi Data" : "Edit"}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{incomplete ? "Lengkapi Data Transaksi" : "Edit Transaksi"}{deal.code ? ` · ${deal.code}` : ""}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            {sentForApproval ? (
              <>
                <div className="modal-body">
                  <div className="ok-msg">{state!.message}</div>
                </div>
                <div className="modal-foot">
                  <button type="button" onClick={() => setOpen(false)}>
                    Tutup
                  </button>
                </div>
              </>
            ) : (
            <form action={action}>
              <div className="modal-body">
                {state && !state.ok && <div className="err">{state.message}</div>}
                {needsApproval && (
                  <p className="hint">
                    Perubahan ini tidak langsung berlaku — dikirim dulu ke Director untuk di-accept.
                  </p>
                )}
                <input type="hidden" name="deal_id" value={deal.id} />
                <DealIntakeFields
                  idPrefix={`edit-${deal.id}`}
                  dealingLeads={dealingLeads}
                  bdOptions={bdOptions}
                  benefitOptions={benefitOptions}
                  nominalHistoryByLead={nominalHistoryByLead}
                  defaults={{
                    lead_id: deal.lead_id ?? "",
                    bd_id: deal.bd_id ?? "",
                    ops_name: deal.ops_name ?? "",
                    kategori_poi: (deal.kategori_poi as BrandCategory | null) ?? "",
                    pic_name: deal.pic_name ?? "",
                    pic_whatsapp: deal.pic_whatsapp ?? "",
                    tanggal_mulai_kontrak: deal.tanggal_mulai_kontrak ?? "",
                    tanggal_akhir_kontrak: deal.tanggal_akhir_kontrak ?? "",
                    bentuk_kerjasama: (deal.bentuk_kerjasama as BentukKerjasama | null) ?? "",
                    nominal_harga: deal.nominal_harga,
                    benefit: deal.benefit ?? "",
                    visit_mulai: toDatetimeLocal(deal.visit_start_date, deal.visit_start_time),
                    visit_berakhir: toDatetimeLocal(deal.visit_end_date, deal.visit_end_time),
                    kreator_needed: deal.kreator_needed ?? "",
                    konten_needed: deal.konten_needed ?? "",
                    total_jam_live: deal.total_jam_live ?? "",
                    brief_link: deal.brief_link ?? "",
                  }}
                />
              </div>
              <div className="modal-foot">
                <button type="button" className="ghost2" onClick={() => setOpen(false)} disabled={pending}>
                  Batal
                </button>
                <button type="submit" disabled={pending}>
                  {pending
                    ? needsApproval
                      ? "Mengirim…"
                      : "Menyimpan…"
                    : needsApproval
                      ? "Kirim untuk Approval"
                      : "Simpan"}
                </button>
              </div>
            </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Panel approval Director (deal_change_requests, migrasi 0349)
// ---------------------------------------------------------------------------

const CHANGE_FIELD_LABELS: { key: string; label: string }[] = [
  { key: "bd_id", label: "Nama BD" },
  { key: "ops_name", label: "Nama OPS" },
  { key: "kategori_poi", label: "Kategori POI" },
  { key: "bentuk_kerjasama", label: "Bentuk Kerja Sama" },
  { key: "pic_name", label: "Nama PIC" },
  { key: "pic_whatsapp", label: "WhatsApp" },
  { key: "nominal_harga", label: "Nominal Deals" },
  { key: "benefit", label: "Benefit" },
  { key: "tanggal_mulai_kontrak", label: "Tanggal Awal Kerjasama" },
  { key: "tanggal_akhir_kontrak", label: "Tanggal Akhir Kerjasama" },
  { key: "visit_mulai", label: "Visit Dimulai" },
  { key: "visit_berakhir", label: "Visit Berakhir" },
  { key: "kreator_needed", label: "Jumlah Kreator" },
  { key: "konten_needed", label: "Jumlah Konten" },
  { key: "total_jam_live", label: "Total Jam Live" },
  { key: "brief_link", label: "Link Brief" },
];

// Nilai deal SAAT INI dalam bentuk yang sama persis dengan payload form,
// supaya perbandingan "sebelum → sesudah" tidak memunculkan perubahan palsu
// gara-gara beda format.
function currentFormValue(deal: Deal, key: string): string {
  switch (key) {
    case "bd_id":
      return deal.bd_id ?? "";
    case "ops_name":
      return deal.ops_name ?? "";
    case "kategori_poi":
      return deal.kategori_poi ?? "";
    case "bentuk_kerjasama":
      return deal.bentuk_kerjasama ?? "";
    case "pic_name":
      return deal.pic_name ?? "";
    case "pic_whatsapp":
      return deal.pic_whatsapp ?? "";
    case "nominal_harga":
      return String(deal.nominal_harga ?? "");
    case "benefit":
      return deal.benefit ?? "";
    case "tanggal_mulai_kontrak":
      return deal.tanggal_mulai_kontrak ?? "";
    case "tanggal_akhir_kontrak":
      return deal.tanggal_akhir_kontrak ?? "";
    case "visit_mulai":
      return toDatetimeLocal(deal.visit_start_date, deal.visit_start_time);
    case "visit_berakhir":
      return toDatetimeLocal(deal.visit_end_date, deal.visit_end_time);
    case "kreator_needed":
      return deal.kreator_needed != null ? String(deal.kreator_needed) : "";
    case "konten_needed":
      return deal.konten_needed != null ? String(deal.konten_needed) : "";
    case "total_jam_live":
      return deal.total_jam_live != null ? String(deal.total_jam_live) : "";
    case "brief_link":
      return deal.brief_link ?? "";
    default:
      return "";
  }
}

function displayValue(key: string, raw: string, bdNameById: Record<string, string>): string {
  if (!raw) return "—";
  if (key === "bd_id") return bdNameById[raw] ?? raw;
  if (key === "nominal_harga") return rupiah(Number(raw) || 0);
  return raw;
}

function changeRows(
  req: DealChangeRequest,
  deal: Deal | undefined,
  bdNameById: Record<string, string>
): { label: string; from: string; to: string }[] {
  if (req.action !== "update" || !req.payload) return [];
  const payload = req.payload;
  return CHANGE_FIELD_LABELS.flatMap(({ key, label }) => {
    const to = String(payload[key] ?? "");
    const from = deal ? currentFormValue(deal, key) : "";
    if (to === from) return [];
    return [{ label, from: displayValue(key, from, bdNameById), to: displayValue(key, to, bdNameById) }];
  });
}

function ReviewButtons({ requestId }: { requestId: string }) {
  const [approveState, approve, approvePending] = useActionState<ActionResult | null, FormData>(
    approveDealChangeRequest,
    null
  );
  const [rejectState, reject, rejectPending] = useActionState<ActionResult | null, FormData>(
    rejectDealChangeRequest,
    null
  );
  const state = approveState ?? rejectState;
  return (
    <div>
      <div className="actions-row" style={{ justifyContent: "flex-end" }}>
        <form action={approve} className="inline-form">
          <input type="hidden" name="request_id" value={requestId} />
          <button className="sm" disabled={approvePending || rejectPending}>
            {approvePending ? "…" : "Setujui"}
          </button>
        </form>
        <form
          action={reject}
          className="inline-form"
          onSubmit={(e) => {
            if (!confirm("Tolak permintaan perubahan ini?")) e.preventDefault();
          }}
        >
          <input type="hidden" name="request_id" value={requestId} />
          <button className="sm ghost2" disabled={approvePending || rejectPending}>
            {rejectPending ? "…" : "Tolak"}
          </button>
        </form>
      </div>
      {state && !state.ok && <div className="err">{state.message}</div>}
    </div>
  );
}

function CancelRequestButton({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(cancelDealChangeRequest, null);
  return (
    <form
      action={action}
      className="inline-form"
      onSubmit={(e) => {
        if (!confirm("Batalkan permintaan ini?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="request_id" value={requestId} />
      <button className="sm ghost2" disabled={pending}>
        {pending ? "…" : "Batalkan"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

// ChangeRequestsPanel — antrian "Edit/Lengkapi Data & Hapus" yang menunggu
// accept Director. Director melihat semua permintaan + tombol Setujui/Tolak;
// pemohon (BD/CM) hanya melihat permintaannya sendiri (dijaga RLS) dan bisa
// membatalkan selama belum ditinjau.
function ChangeRequestsPanel({
  requests,
  dealById,
  bdNameById,
  empNameById,
  canReview,
}: {
  requests: DealChangeRequest[];
  dealById: Map<string, Deal>;
  bdNameById: Record<string, string>;
  empNameById: Record<string, string>;
  canReview: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const pendingReqs = requests.filter((r) => r.status === "pending");
  const reviewed = requests.filter((r) => r.status !== "pending").slice(0, 20);

  if (pendingReqs.length === 0 && reviewed.length === 0) return null;

  return (
    <div className="card">
      <div className="table-toolbar">
        <h2>
          Persetujuan Perubahan Deal ({pendingReqs.length} menunggu)
        </h2>
        {reviewed.length > 0 && (
          <button type="button" className="sm ghost2" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Sembunyikan Riwayat" : `Riwayat (${reviewed.length})`}
          </button>
        )}
      </div>
      <p className="hint">
        Edit / Lengkapi Data / Hapus dari BizDev &amp; Creator Management baru berlaku setelah di-accept Director.
      </p>

      {pendingReqs.length === 0 ? (
        <p className="muted">Tidak ada permintaan yang menunggu approval.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Deal</th>
                <th>Jenis</th>
                <th>Diajukan</th>
                <th>Perubahan</th>
                <th className="right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pendingReqs.map((r) => {
                const deal = r.deal_id ? dealById.get(r.deal_id) : undefined;
                const rows = changeRows(r, deal, bdNameById);
                return (
                  <tr key={r.id}>
                    <td>
                      {r.deal_brand_name}
                      <div className="mono muted" style={{ fontSize: 11 }}>
                        {r.deal_code ?? "—"}
                      </div>
                    </td>
                    <td>
                      {r.action === "delete" ? (
                        <span className="badge red">Hapus</span>
                      ) : (
                        <span className="badge amber">Edit</span>
                      )}
                    </td>
                    <td className="muted">
                      {empNameById[r.requested_by] ?? "—"}
                      <div style={{ fontSize: 11 }}>{tanggal(r.requested_at)}</div>
                    </td>
                    <td>
                      {r.action === "delete" ? (
                        <span className="muted">Seluruh transaksi dihapus permanen.</span>
                      ) : rows.length === 0 ? (
                        <span className="muted">Tidak ada perbedaan terdeteksi.</span>
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: 16 }}>
                          {rows.map((row) => (
                            <li key={row.label} style={{ fontSize: 12 }}>
                              <strong>{row.label}</strong>: <span className="muted">{row.from}</span> → {row.to}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="right">
                      {canReview ? <ReviewButtons requestId={r.id} /> : <CancelRequestButton requestId={r.id} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showHistory && reviewed.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Deal</th>
                <th>Jenis</th>
                <th>Diajukan</th>
                <th>Ditinjau</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {reviewed.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.deal_brand_name}
                    <div className="mono muted" style={{ fontSize: 11 }}>
                      {r.deal_code ?? "—"}
                    </div>
                  </td>
                  <td className="muted">{r.action === "delete" ? "Hapus" : "Edit"}</td>
                  <td className="muted">{empNameById[r.requested_by] ?? "—"}</td>
                  <td className="muted">
                    {(r.reviewed_by && empNameById[r.reviewed_by]) ?? "—"}
                    <div style={{ fontSize: 11 }}>{r.reviewed_at ? tanggal(r.reviewed_at) : "—"}</div>
                  </td>
                  <td>
                    {r.status === "approved" ? (
                      <span className="badge green">Disetujui</span>
                    ) : (
                      <span className="badge red">Ditolak</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type SortKey = "code" | "poi" | "bd" | "kategori" | "bentuk" | "nominal" | "visit" | "status";
type SortDir = "asc" | "desc";
const PAGE_SIZES = [10, 20, 50] as const;

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className="sortable" onClick={() => onSort(sortKey)}>
      {label} {active === sortKey ? (dir === "asc" ? "▲" : "▼") : ""}
    </th>
  );
}

// DealsBoard — scorecard + toolbar "Daftarkan Transaksi" + "Daftar Deal":
// search wildcard (POI/ID merchant/BD/Benefit), filter BD & tanggal visit,
// sort per kolom, paginasi 10/20/50, penanda "Lengkapi Data" untuk baris
// Import Master Deal yang belum dilengkapi. Scorecard dihitung dari hasil
// filter yang sama dengan tabel, supaya angkanya ikut berubah saat filter
// dipakai (bukan cuma baris tabelnya).
export function DealsBoard({
  deals,
  dealingLeads,
  bdOptions,
  bdNameById,
  benefitOptions,
  nominalHistoryByLead,
  changeRequests = [],
  empNameById = {},
  canRegister,
  canEditDelete,
  canRequestChange = false,
  verifiedByTrxId = {},
  bridgeByDeal = {},
}: {
  deals: Deal[];
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  bdNameById: Record<string, string>;
  benefitOptions: string[];
  nominalHistoryByLead?: Record<string, number[]>;
  changeRequests?: DealChangeRequest[];
  empNameById?: Record<string, string>;
  canRegister: boolean;
  canEditDelete: boolean;
  canRequestChange?: boolean;
  // Bridge MSDPS→CDPS Fase 1 (B4).
  verifiedByTrxId?: Record<string, boolean>;
  bridgeByDeal?: Record<string, { status: string; ord_code: string | null; last_error: string | null }>;
}) {
  const [query, setQuery] = useState("");
  const [bdFilter, setBdFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("visit");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // canAct: tombol Edit/Lengkapi Data & Hapus muncul untuk Director (langsung
  // berlaku) maupun BD/CM (masuk antrian approval Director, migrasi 0349).
  const canAct = canEditDelete || canRequestChange;
  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const pendingRequestByDeal = useMemo(() => {
    const map = new Map<string, DealChangeRequest>();
    for (const r of changeRequests) {
      if (r.status === "pending" && r.deal_id) map.set(r.deal_id, r);
    }
    return map;
  }, [changeRequests]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deals.filter((d) => {
      if (bdFilter && d.bd_id !== bdFilter) return false;
      if (dateFrom && (!d.visit_start_date || d.visit_start_date < dateFrom)) return false;
      if (dateTo && (!d.visit_start_date || d.visit_start_date > dateTo)) return false;
      if (q) {
        const bd = (d.bd_id && bdNameById[d.bd_id]) ?? "";
        const hay = `${d.brand_name} ${d.code ?? ""} ${d.unique_id ?? ""} ${bd} ${d.benefit ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [deals, query, bdFilter, dateFrom, dateTo, bdNameById]);

  const filterActive = !!(query.trim() || bdFilter || dateFrom || dateTo);

  const stats = useMemo(() => {
    const totalTransaksi = filtered.length;
    const belumLengkap = filtered.filter(isIncomplete).length;
    const totalNominalDeals = filtered.reduce((sum, d) => sum + (d.nominal_harga ?? 0), 0);
    const berbayarCount = filtered.filter((d) => d.bentuk_kerjasama === "Berbayar").length;
    const freeBarterCount = filtered.filter((d) => d.bentuk_kerjasama === "Free/Barter").length;
    const skemaTotal = berbayarCount + freeBarterCount;
    const berbayarPct = skemaTotal > 0 ? Math.round((berbayarCount / skemaTotal) * 100) : 0;
    const freeBarterPct = skemaTotal > 0 ? 100 - berbayarPct : 0;
    return { totalTransaksi, belumLengkap, totalNominalDeals, berbayarCount, freeBarterCount, berbayarPct, freeBarterPct };
  }, [filtered]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (d: Deal): string => {
      switch (sortKey) {
        case "code":
          return d.code ?? "";
        case "poi":
          return d.brand_name;
        case "bd":
          return (d.bd_id && bdNameById[d.bd_id]) ?? "";
        case "kategori":
          return d.kategori_poi ?? "";
        case "bentuk":
          return d.bentuk_kerjasama ?? "";
        case "nominal":
          return String(d.nominal_harga).padStart(20, "0");
        case "visit":
          return d.visit_start_date ?? "";
        case "status":
          return isIncomplete(d) ? "0" : "1";
      }
    };
    return [...filtered].sort((a, b) => val(a).localeCompare(val(b)) * dir);
  }, [filtered, sortKey, sortDir, bdNameById]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, pageCount);
  const paginated = sorted.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  function onSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pageIds = paginated.map((d) => d.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAllOnPage() {
    setSelected((s) => {
      const next = new Set(s);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const colCount = 9 + (canAct ? 2 : 0);

  function exportExcel() {
    const rows = sorted.map((d) => ({
      "ID Merchant": d.code ?? "",
      "Unique ID": d.unique_id ?? "",
      "POI / Merchant": d.brand_name,
      BD: (d.bd_id && bdNameById[d.bd_id]) ?? "",
      Kategori: d.kategori_poi ?? "",
      "Bentuk Kerjasama": d.bentuk_kerjasama ?? "",
      Nominal: d.nominal_harga,
      Benefit: d.benefit ?? "",
      "Visit Mulai": d.visit_start_date ?? "",
      "Visit Berakhir": d.visit_end_date ?? "",
      Status: isIncomplete(d) ? "Belum Lengkap" : "Lengkap",
    }));
    exportRowsToExcel("merchant-deals", "Deals", rows);
  }

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="k">Total Transaksi{filterActive ? " (terfilter)" : ""}</div>
          <div className="v">{num(stats.totalTransaksi)}</div>
        </div>
        <div className="stat">
          <div className="k">Total Nominal Deals{filterActive ? " (terfilter)" : ""}</div>
          <div className="v small">{rupiah(stats.totalNominalDeals)}</div>
        </div>
        <div className="stat">
          <div className="k">Belum Lengkap</div>
          <div className="v" style={stats.belumLengkap > 0 ? { color: "#dc2626" } : undefined}>
            {num(stats.belumLengkap)}
          </div>
          {stats.belumLengkap > 0 && (
            <div className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              belum masuk tracker operasional
            </div>
          )}
        </div>
        <div className="stat">
          <div className="k">Skema Berbayar</div>
          <div className="v">
            {num(stats.berbayarCount)}{" "}
            <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
              ({stats.berbayarPct}%)
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="k">Skema Free/Barter</div>
          <div className="v">
            {num(stats.freeBarterCount)}{" "}
            <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
              ({stats.freeBarterPct}%)
            </span>
          </div>
        </div>
      </div>

      {canRegister && (
        <DealsToolbar
          dealingLeads={dealingLeads}
          bdOptions={bdOptions}
          benefitOptions={benefitOptions}
          nominalHistoryByLead={nominalHistoryByLead}
        />
      )}

      {canAct && (
        <ChangeRequestsPanel
          requests={changeRequests}
          dealById={dealById}
          bdNameById={bdNameById}
          empNameById={empNameById}
          canReview={canEditDelete}
        />
      )}

      <div className="card">
      <div className="table-toolbar">
        <h2>Daftar Deal ({sorted.length})</h2>
        <button type="button" className="sm ghost2" onClick={exportExcel} disabled={sorted.length === 0}>
          Export Excel
        </button>
      </div>
      <div className="filters-row">
        <div>
          <label>Cari POI, ID Merchant, BD, atau Benefit</label>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="search..."
          />
        </div>
        <div>
          <label>Nama BD</label>
          <select
            value={bdFilter}
            onChange={(e) => {
              setBdFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">— semua —</option>
            {bdOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Visit Dari Tanggal</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <label>Visit Sampai Tanggal</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {canAct && selected.size > 0 && (
        <div style={{ marginBottom: 12 }}>
          <BulkDeleteBar ids={[...selected]} needsApproval={!canEditDelete} />
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              {canAct && (
                <th>
                  <input type="checkbox" checked={allPageSelected} onChange={toggleAllOnPage} />
                </th>
              )}
              <SortHeader label="ID Merchant" sortKey="code" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="POI / Merchant" sortKey="poi" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="BD" sortKey="bd" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Kategori" sortKey="kategori" active={sortKey} dir={sortDir} onSort={onSort} />
              <th>PIC &amp; WhatsApp</th>
              <SortHeader label="Bentuk" sortKey="bentuk" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Nominal / Benefit" sortKey="nominal" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Visit" sortKey="visit" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Status" sortKey="status" active={sortKey} dir={sortDir} onSort={onSort} />
              {canAct && <th className="right">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {paginated.map((d) => (
              <tr key={d.id}>
                {canAct && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggleOne(d.id)}
                    />
                  </td>
                )}
                <td className="mono">
                  {d.code ?? "—"}
                  {d.unique_id && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {d.unique_id}
                    </div>
                  )}
                </td>
                <td>{d.brand_name}</td>
                <td>{(d.bd_id && bdNameById[d.bd_id]) ?? "—"}</td>
                <td className="muted">{d.kategori_poi ?? "—"}</td>
                <td>
                  {d.pic_name ?? "—"}
                  <div className="mono" style={{ fontSize: 11 }}>
                    {d.pic_whatsapp ?? "—"}
                  </div>
                </td>
                <td className="muted">{d.bentuk_kerjasama ?? "—"}</td>
                <td>
                  {rupiah(d.nominal_harga)}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {d.benefit ?? "—"}
                  </div>
                </td>
                <td className="muted">{visitLabel(d.visit_start_date, d.visit_start_time, d.visit_end_date, d.visit_end_time)}</td>
                <td>
                  {isIncomplete(d) ? (
                    <span className="badge amber">Lengkapi Data</span>
                  ) : (
                    <span className="badge green">Lengkap</span>
                  )}
                  {pendingRequestByDeal.has(d.id) && (
                    <div style={{ marginTop: 4 }}>
                      <span className="badge indigo" title="Menunggu accept Director">
                        {pendingRequestByDeal.get(d.id)!.action === "delete"
                          ? "Menunggu approval hapus"
                          : "Menunggu approval edit"}
                      </span>
                    </div>
                  )}
                </td>
                {canAct && (
                  <td className="right">
                    <div className="actions-row" style={{ justifyContent: "flex-end" }}>
                      <EditDealModal
                        deal={d}
                        dealingLeads={dealingLeads}
                        bdOptions={bdOptions}
                        benefitOptions={benefitOptions}
                        nominalHistoryByLead={nominalHistoryByLead}
                        needsApproval={!canEditDelete}
                        blocked={!canEditDelete && pendingRequestByDeal.has(d.id)}
                      />
                      <DeleteDealButton
                        dealId={d.id}
                        label={d.brand_name}
                        needsApproval={!canEditDelete}
                        blocked={!canEditDelete && pendingRequestByDeal.has(d.id)}
                      />
                      {d.bentuk_kerjasama === "Berbayar" && !d.transaction_id && (
                        <CreatePoiFinanceButton dealId={d.id} label={d.brand_name} />
                      )}
                      {d.bentuk_kerjasama === "Berbayar" && d.transaction_id && (
                        <BridgeLinesModal
                          deal={d}
                          verified={!!verifiedByTrxId[d.transaction_id]}
                          bridgeInfo={bridgeByDeal[d.id]}
                        />
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={colCount} className="muted">
                  Belum ada deal terdaftar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <div>
          Tampilkan{" "}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
              setPage(1);
            }}
            style={{ width: "auto", display: "inline-block", marginBottom: 0 }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>{" "}
          baris
        </div>
        <div className="actions-row">
          <button
            type="button"
            className="sm ghost2"
            disabled={clampedPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹ Sebelumnya
          </button>
          <span className="muted" style={{ alignSelf: "center" }}>
            Halaman {clampedPage} dari {pageCount}
          </span>
          <button
            type="button"
            className="sm ghost2"
            disabled={clampedPage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Selanjutnya ›
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
