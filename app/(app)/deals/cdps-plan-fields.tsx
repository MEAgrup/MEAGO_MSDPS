"use client";

// Editor rencana layanan CDPS (migrasi 0377) — dipakai di form "Daftarkan
// Transaksi" (DealIntakeFields, withCdpsPlan) dan modal "Layanan CDPS" per
// baris deal (table.tsx). Mengirim dua field ke server action:
//   cdps_tidak_perlu  — "on" bila dicentang
//   cdps_lines_json   — array baris sebagai SATU string JSON (React 19/Next 15
//                       membuang name/value submitter, BUILD_PLAN.md:46)
// Validasi akhir di lib/bridge/plan.ts (server) — di sini hanya bentuk.

import { useState } from "react";
import { BRIDGE_JENIS, type BridgeJenis } from "@/lib/bridge/plan";

export type CdpsPlanValue = {
  tidak_perlu: boolean;
  lines: {
    jenis: string;
    qty: number | string | null;
    catatan: string | null;
    alasan_non_roster: string | null;
    nilai_cross_charge: number | string | null;
  }[];
};

type LineDraft = {
  jenis: BridgeJenis;
  qty: string;
  catatan: string;
  alasan_non_roster: string;
  nilai_cross_charge: string;
};

const emptyLine = (): LineDraft => ({
  jenis: "Account",
  qty: "1",
  catatan: "",
  alasan_non_roster: "",
  nilai_cross_charge: "",
});

function toDraft(l: CdpsPlanValue["lines"][number]): LineDraft {
  const jenis = (BRIDGE_JENIS as readonly string[]).includes(l.jenis) ? (l.jenis as BridgeJenis) : "Account";
  return {
    jenis,
    qty: l.qty === null || l.qty === undefined ? "" : String(l.qty),
    catatan: l.catatan ?? "",
    alasan_non_roster: l.alasan_non_roster ?? "",
    nilai_cross_charge:
      l.nilai_cross_charge === null || l.nilai_cross_charge === undefined ? "" : String(l.nilai_cross_charge),
  };
}

// Referensi harga resmi paket MEAGO (dokumen "Merchant Existing TikTok GO
// Package — Sept"), murni untuk BANTU BD/CM mengetik `nilai_cross_charge`
// per baris — TIDAK mengisi apa pun otomatis. Alokasi ke satu/lebih baris
// jenis tetap keputusan manusia: satu fee paket sering membundel Live +
// Content, jadi tidak ada pemecahan mekanis yang aman ditebak di sini.
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
        Bukan pengisi otomatis — cek nilai deal ini terhadap harga resmi di bawah, lalu ketik alokasinya
        sendiri di kolom &quot;Nilai cross-charge&quot; per baris. Satu fee paket sering membundel Live +
        Content, jadi porsi tiap baris jenis tetap keputusan BD/CM.
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

export function CdpsPlanFields({ initial }: { initial?: CdpsPlanValue | null }) {
  const [tidakPerlu, setTidakPerlu] = useState<boolean>(initial?.tidak_perlu ?? false);
  const [rows, setRows] = useState<LineDraft[]>(
    initial && !initial.tidak_perlu && initial.lines.length > 0 ? initial.lines.map(toDraft) : [emptyLine()]
  );

  function updateRow(i: number, patch: Partial<LineDraft>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  return (
    <fieldset className="cdps-plan">
      <legend>Layanan CDPS (MEA Agency) *</legend>
      <p className="hint">
        Begitu Finance memverifikasi pembayaran — <b>DP pun cukup</b> — layanan di bawah otomatis
        diteruskan ke CDPS sebagai satu order, lengkap dengan info persentase pembayaran klien. Tidak bisa
        diubah lagi setelah diteruskan.
      </p>
      <label className="checkbox-inline">
        <input
          type="checkbox"
          name="cdps_tidak_perlu"
          checked={tidakPerlu}
          onChange={(e) => setTidakPerlu(e.target.checked)}
        />{" "}
        Tidak perlu CDPS (seluruh pekerjaan deal ini dikerjakan MEAGO sendiri)
      </label>
      {!tidakPerlu && (
        <>
          <input type="hidden" name="cdps_lines_json" value={JSON.stringify(rows)} />
          <MeagoPriceReference />
          {rows.map((r, i) => (
            <div key={i} className="bridge-line-row">
              <select value={r.jenis} onChange={(e) => updateRow(i, { jenis: e.target.value as BridgeJenis })}>
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
          <button type="button" className="sm ghost2" onClick={() => setRows((rs) => [...rs, emptyLine()])}>
            + Tambah Layanan
          </button>
        </>
      )}
    </fieldset>
  );
}
