"use client";

import { useMemo, useState } from "react";
import { rupiah, num } from "@/lib/format";
import { exportRowsToExcel } from "@/lib/xlsx-export";

export type PoinRule = {
  full_pct: number;
  full: number;
  half_pct: number;
  half: number;
  low: number;
};

export type SummaryRow = {
  period: string;
  bd_id: string | null;
  bd_name: string;
  kategori_poi: string;
  total_deal: number;
  realisasi_visit: number;
  poin_sum: number | string;
  kreator_realized_sum: number;
  vt_total_sum: number | string;
  gmv_sum: number | string;
  deal_poin_belum_ditentukan: number;
};

export type RealisasiRow = {
  deal_id: string;
  code: string | null;
  brand_name: string;
  period: string;
  bd_id: string | null;
  kategori_poi: string;
  bentuk_kerjasama: string | null;
  flow: string;
  kreator_needed: number | null;
  vt_report_step: number | null;
  kreator_realized: number | null;
  vt_total: number | string | null;
  total_gmv: number | string | null;
  cycle_count: number;
  cycle_verified_count: number;
  vt_report_done: boolean;
  pct_kreator: number | string | null;
  poin: number | string | null;
  poin_status: string;
};

type RealisasiWithBd = RealisasiRow & { bd_name: string };

// PostgREST mengirim `numeric` sebagai angka, tapi driver/versi tertentu
// mengirimnya sebagai string. Semua kolom numerik view (poin, gmv, pct) lewat
// sini supaya penjumlahan tidak diam-diam berubah jadi rangkaian teks.
function n(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// period berbentuk 'YYYYMM' (to_char created_at). Kalau bentuknya tak terduga,
// tampilkan apa adanya daripada memunculkan "NaN".
function periodLabel(period: string): string {
  const m = /^(\d{4})(\d{2})$/.exec(period);
  if (!m) return period;
  const bulan = BULAN[Number(m[2]) - 1];
  return bulan ? `${bulan} ${m[1]}` : period;
}

const FLOW_LABELS: Record<string, string> = {
  accommodation_ttd: "Accommodation / TTD",
  dining_freebarter: "Dining Free/Barter",
  dining_berbayar: "Dining Berbayar",
};

// Terjemahan poin_status. Nol poin punya dua sebab yang tindak lanjutnya
// berbeda — tanpa dibedakan, BD hanya melihat "0" dan tidak tahu harus apa.
const STATUS_LABELS: Record<string, { label: string; badge: string; saran: string }> = {
  ok: { label: "Diskor", badge: "green", saran: "—" },
  report_vt_belum_selesai: {
    label: "Report VT belum",
    badge: "amber",
    saran: "Selesaikan langkah report pengumpulan VT ke BD",
  },
  jumlah_kreator_belum_diisi: {
    label: "Kreator belum diisi",
    badge: "red",
    saran: "Isi jumlah kreator tercapai (target per deal juga harus terisi)",
  },
};

function statusInfo(status: string) {
  return STATUS_LABELS[status] ?? { label: status, badge: "slate", saran: "—" };
}

// SkorBoard — papan skor BD: filter periode/BD/kategori, ringkasan angka,
// peringkat BD (dari v_poi_deal_summary), dan rincian per deal beserta ALASAN
// sebuah deal belum berpoin (dari v_poi_deal_realisasi).
export function SkorBoard({
  summary,
  realisasi,
  rule,
}: {
  summary: SummaryRow[];
  realisasi: RealisasiWithBd[];
  rule: PoinRule;
}) {
  const periods = useMemo(
    () => Array.from(new Set(summary.map((s) => s.period))).sort((a, b) => b.localeCompare(a)),
    [summary]
  );
  const kategoris = useMemo(
    () => Array.from(new Set(summary.map((s) => s.kategori_poi))).sort(),
    [summary]
  );
  const bdOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const s of summary) seen.set(s.bd_id ?? "", s.bd_name);
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [summary]);

  // Default periode terbaru, bukan "semua": papan skor dipakai per bulan.
  const [period, setPeriod] = useState<string>(periods[0] ?? "");
  const [bd, setBd] = useState<string>("all");
  const [kategori, setKategori] = useState<string>("all");

  const match = (row: { period: string; bd_id: string | null; kategori_poi: string }) =>
    (period === "all" || row.period === period) &&
    (bd === "all" || (row.bd_id ?? "") === bd) &&
    (kategori === "all" || row.kategori_poi === kategori);

  const summaryFiltered = useMemo(() => summary.filter(match), [summary, period, bd, kategori]);
  const dealsFiltered = useMemo(
    () =>
      realisasi.filter(match).sort((a, b) => n(b.poin) - n(a.poin) || a.brand_name.localeCompare(b.brand_name)),
    [realisasi, period, bd, kategori]
  );

  // Peringkat digabung lintas kategori: satu baris summary = satu (periode, BD,
  // kategori), jadi BD yang punya Dining dan Accommodation muncul dua kali.
  const ranking = useMemo(() => {
    const byBd = new Map<
      string,
      { bd_name: string; total_deal: number; realisasi_visit: number; poin: number; kreator: number; gmv: number }
    >();
    for (const s of summaryFiltered) {
      const key = s.bd_id ?? "";
      const cur = byBd.get(key) ?? {
        bd_name: s.bd_name,
        total_deal: 0,
        realisasi_visit: 0,
        poin: 0,
        kreator: 0,
        gmv: 0,
      };
      cur.total_deal += s.total_deal;
      cur.realisasi_visit += s.realisasi_visit;
      cur.poin += n(s.poin_sum);
      cur.kreator += s.kreator_realized_sum;
      cur.gmv += n(s.gmv_sum);
      byBd.set(key, cur);
    }
    return Array.from(byBd.values()).sort((a, b) => b.poin - a.poin || a.bd_name.localeCompare(b.bd_name));
  }, [summaryFiltered]);

  const totals = useMemo(
    () => ({
      poin: summaryFiltered.reduce((a, s) => a + n(s.poin_sum), 0),
      deal: summaryFiltered.reduce((a, s) => a + s.total_deal, 0),
      visit: summaryFiltered.reduce((a, s) => a + s.realisasi_visit, 0),
      kreator: summaryFiltered.reduce((a, s) => a + s.kreator_realized_sum, 0),
      vt: summaryFiltered.reduce((a, s) => a + n(s.vt_total_sum), 0),
      gmv: summaryFiltered.reduce((a, s) => a + n(s.gmv_sum), 0),
      belumDitentukan: summaryFiltered.reduce((a, s) => a + s.deal_poin_belum_ditentukan, 0),
    }),
    [summaryFiltered]
  );

  const blokir = useMemo(
    () => ({
      reportVt: dealsFiltered.filter((d) => d.poin_status === "report_vt_belum_selesai").length,
      kreator: dealsFiltered.filter((d) => d.poin_status === "jumlah_kreator_belum_diisi").length,
    }),
    [dealsFiltered]
  );

  function exportExcel() {
    const rows = dealsFiltered.map((d) => ({
      Periode: periodLabel(d.period),
      "ID Merchant": d.code ?? "",
      "POI / Merchant": d.brand_name,
      BD: d.bd_name,
      Kategori: d.kategori_poi,
      "Bentuk Kerjasama": d.bentuk_kerjasama ?? "",
      Alur: FLOW_LABELS[d.flow] ?? d.flow,
      "Target Kreator": d.kreator_needed ?? "",
      "Kreator Tercapai": d.kreator_realized ?? "",
      "Capaian %": d.pct_kreator === null ? "" : n(d.pct_kreator),
      "Report VT Selesai": d.vt_report_done ? "Ya" : "Belum",
      "Step Report VT": d.vt_report_step ?? "",
      "Siklus (total)": d.cycle_count,
      "Siklus Terverifikasi": d.cycle_verified_count,
      "Actual VT": d.vt_total === null ? "" : n(d.vt_total),
      "Total GMV": d.total_gmv === null ? "" : n(d.total_gmv),
      Poin: n(d.poin),
      "Status Poin": statusInfo(d.poin_status).label,
      "Tindak Lanjut": statusInfo(d.poin_status).saran,
    }));
    exportRowsToExcel("papan-skor-bd", "Skor", rows);
  }

  return (
    <>
      <div className="card">
        <div className="filters-row">
          <div>
            <label>Periode</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {periods.map((p) => (
                <option key={p} value={p}>
                  {periodLabel(p)}
                </option>
              ))}
              <option value="all">Semua Periode</option>
            </select>
          </div>
          <div>
            <label>BD</label>
            <select value={bd} onChange={(e) => setBd(e.target.value)}>
              <option value="all">Semua BD</option>
              {bdOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Kategori POI</label>
            <select value={kategori} onChange={(e) => setKategori(e.target.value)}>
              <option value="all">Semua Kategori</option>
              {kategoris.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Aturan poin berlaku: capaian ≥ {rule.full_pct}% → <strong>{rule.full}</strong> poin · ≥{" "}
          {rule.half_pct}% → <strong>{rule.half}</strong> poin · di bawah itu →{" "}
          <strong>{rule.low}</strong> poin. Dasar capaian adalah{" "}
          <strong>jumlah kreator tercapai vs target per deal</strong>, dibatasi maksimum 100% —
          melebihi target tidak menambah poin. Poin baru dihitung setelah langkah report VT ke BD
          selesai; sebelum itu 0. Diatur di Setting Bizdev &amp; Admin Ops.
        </p>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Poin</div>
          <div className="v">{num(totals.poin)}</div>
        </div>
        <div className="stat">
          <div className="k">Deal Diskor</div>
          <div className="v">{num(totals.deal)}</div>
        </div>
        <div className="stat">
          <div className="k">Report VT Selesai</div>
          <div className="v">
            {num(totals.visit)}
            <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
              {" "}
              / {num(totals.deal)}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="k">Kreator Tercapai</div>
          <div className="v">{num(totals.kreator)}</div>
        </div>
        <div className="stat">
          <div className="k">Actual VT</div>
          <div className="v">{num(totals.vt)}</div>
        </div>
        <div className="stat">
          <div className="k">Total GMV</div>
          <div className="v small">{rupiah(totals.gmv)}</div>
        </div>
      </div>

      {totals.belumDitentukan > 0 && (
        <div className="card" style={{ borderColor: "#fca5a5", background: "#fef2f2" }}>
          <h2 style={{ color: "#b91c1c" }}>
            {totals.belumDitentukan} deal tidak punya aturan skor
          </h2>
          <p className="muted" style={{ margin: 0 }}>
            Sejak migrasi 0356 seluruh alur POI berpoin, jadi angka ini seharusnya 0. Munculnya
            angka di sini berarti ada alur baru yang belum diskor — bukan kelalaian BD.
          </p>
        </div>
      )}

      <div className="card">
        <h2>Peringkat BD ({ranking.length})</h2>
        {ranking.length === 0 ? (
          <p className="muted">Tidak ada data untuk filter ini.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>BD</th>
                <th style={{ textAlign: "right" }}>Deal</th>
                <th style={{ textAlign: "right" }}>Report VT</th>
                <th style={{ textAlign: "right" }}>Kreator</th>
                <th style={{ textAlign: "right" }}>GMV</th>
                <th style={{ textAlign: "right" }}>Poin</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={`${r.bd_name}-${i}`}>
                  <td className="muted">{i + 1}</td>
                  <td>{r.bd_name}</td>
                  <td style={{ textAlign: "right" }}>{num(r.total_deal)}</td>
                  <td style={{ textAlign: "right" }}>
                    {num(r.realisasi_visit)}
                    <span className="muted"> / {num(r.total_deal)}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>{num(r.kreator)}</td>
                  <td style={{ textAlign: "right" }}>{rupiah(r.gmv)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{num(r.poin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="table-toolbar">
          <h2>Rincian per Deal ({dealsFiltered.length})</h2>
          <button type="button" className="sm ghost2" onClick={exportExcel} disabled={dealsFiltered.length === 0}>
            Export Excel
          </button>
        </div>

        {(blokir.reportVt > 0 || blokir.kreator > 0) && (
          <p className="muted" style={{ marginTop: 0 }}>
            Belum berpoin:{" "}
            {blokir.reportVt > 0 && <strong>{blokir.reportVt} menunggu report VT</strong>}
            {blokir.reportVt > 0 && blokir.kreator > 0 && " · "}
            {blokir.kreator > 0 && (
              <strong>{blokir.kreator} jumlah kreatornya belum diisi</strong>
            )}
            . Deal yang jumlah kreatornya kosong bernilai <strong>0 poin</strong>, bukan poin
            terendah — data yang belum diisi tidak diberi nilai.
          </p>
        )}

        {dealsFiltered.length === 0 ? (
          <p className="muted">Tidak ada deal untuk filter ini.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>ID / POI</th>
                <th>BD</th>
                <th>Alur</th>
                <th style={{ textAlign: "right" }}>Kreator</th>
                <th style={{ textAlign: "right" }}>Capaian</th>
                <th>Report VT</th>
                <th style={{ textAlign: "right" }}>VT</th>
                <th style={{ textAlign: "right" }}>GMV</th>
                <th style={{ textAlign: "right" }}>Poin</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dealsFiltered.map((d) => {
                const info = statusInfo(d.poin_status);
                return (
                  <tr key={d.deal_id}>
                    <td>
                      <div>{d.brand_name}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {d.code ?? "—"} · {periodLabel(d.period)}
                      </div>
                    </td>
                    <td>{d.bd_name}</td>
                    <td>
                      <div>{FLOW_LABELS[d.flow] ?? d.flow}</div>
                      {d.flow === "dining_berbayar" && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          {d.cycle_verified_count} dari {d.cycle_count} siklus lapor VT
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {d.kreator_realized === null ? (
                        <span className="muted">belum diisi</span>
                      ) : (
                        num(d.kreator_realized)
                      )}
                      <span className="muted"> / {d.kreator_needed ?? "—"}</span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {d.pct_kreator === null ? <span className="muted">—</span> : `${n(d.pct_kreator)}%`}
                    </td>
                    <td>
                      {d.vt_report_done ? (
                        <span className="badge green">Selesai</span>
                      ) : (
                        <span className="badge gray">Step {d.vt_report_step ?? "—"}</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {d.vt_total === null ? <span className="muted">—</span> : num(n(d.vt_total))}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {d.total_gmv === null ? <span className="muted">—</span> : rupiah(n(d.total_gmv))}
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700 }}>{num(n(d.poin))}</td>
                    <td>
                      <span className={`badge ${info.badge}`}>{info.label}</span>
                      {info.saran !== "—" && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          {info.saran}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          <strong>VT bukan jumlah kreator.</strong> Kolom VT adalah total video dan boleh melebihi
          jumlah kreator (satu kreator bisa membuat lebih dari satu video) — sifatnya informasi,
          bukan dasar skor. Yang diskor adalah kolom Kreator.
        </p>
      </div>
    </>
  );
}
