import { getCachedClient } from "@/lib/supabase/server";
import { num, rupiah, tanggal } from "@/lib/format";
import { periodLabel, reportStatusLabel, type GmvMonth, type PortalCycle } from "@/lib/merchant-portal";

type MonthlyReport = { period: string; total_gmv: number | null; gmv_estimated: boolean };

// Laporan GMV: per siklus (poi_dining_cycles) + rekap bulanan + laporan bulanan
// yang sudah siap. Semua lewat RPC merchant_portal_* (hanya data merchant ini).
export default async function MerchantReportsPage() {
  const supabase = await getCachedClient();
  const [{ data: cycRaw }, { data: gmvRaw }, { data: repRaw }] = await Promise.all([
    supabase.rpc("merchant_portal_cycles"),
    supabase.rpc("merchant_portal_gmv_monthly"),
    supabase.rpc("merchant_portal_monthly_reports"),
  ]);
  const cycles = (cycRaw as PortalCycle[] | null) ?? [];
  const months = (gmvRaw as GmvMonth[] | null) ?? [];
  const reports = (repRaw as MonthlyReport[] | null) ?? [];

  return (
    <>
      <h1>Laporan GMV</h1>
      <p className="page-sub">GMV per siklus kampanye dan rekap bulanan.</p>

      <div className="card">
        <h2>GMV per Bulan</h2>
        {months.length === 0 ? (
          <p className="muted">Belum ada data GMV.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Bulan</th>
                  <th className="right">GMV</th>
                  <th>Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m.period}>
                    <td>{periodLabel(m.period)}</td>
                    <td className="right">{rupiah(m.gmv)}</td>
                    <td>
                      <span className={`badge ${m.label === "Estimasi" ? "amber" : m.label === "Terverifikasi" ? "green" : "slate"}`}>
                        {m.label}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Per Siklus</h2>
        {cycles.length === 0 ? (
          <p className="muted">Belum ada siklus kampanye.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Kampanye · Siklus</th>
                  <th>Periode</th>
                  <th className="right">Total GMV</th>
                  <th className="right">Voucher terjual</th>
                  <th className="right">Kreator</th>
                  <th>Laporan</th>
                </tr>
              </thead>
              <tbody>
                {cycles.map((c) => (
                  <tr key={c.cycle_id}>
                    <td>
                      {c.campaign_name ?? "Kampanye"} · #{c.cycle_no}
                    </td>
                    <td>
                      {tanggal(c.period_start)} – {tanggal(c.period_end)}
                    </td>
                    <td className="right">{rupiah(c.total_gmv)}</td>
                    <td className="right">{num(c.actual_vt)}</td>
                    <td className="right">{num(c.actual_kreator)}</td>
                    <td>
                      {c.report_link ? (
                        <a href={c.report_link} target="_blank" rel="noopener noreferrer">
                          Buka laporan
                        </a>
                      ) : (
                        <span className="muted">{reportStatusLabel(c.report_status)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reports.length > 0 && (
        <div className="card">
          <h2>Laporan Bulanan</h2>
          <div style={{ overflowX: "auto" }}>
            <table>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.period}>
                    <td>{periodLabel(r.period)}</td>
                    <td className="right">{rupiah(r.total_gmv)}</td>
                    <td>{r.gmv_estimated && <span className="badge amber">estimasi</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
