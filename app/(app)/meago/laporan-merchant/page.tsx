// /meago/laporan-merchant — Laporan Performa Merchant (migrasi 0378): daftar
// merchant yang sudah punya data export Video List + bulan ter-upload, upload
// data mentah, dan tautan generate laporan per periode.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getEmployee, getCachedClient } from "@/lib/supabase/server";
import { isMerchantReportStaff } from "@/lib/merchant-report/access";
import { monthLabelLong, addMonths } from "@/lib/merchant-report/metrics";
import { num } from "@/lib/format";
import { MerchantUploadForm, type LeadOption } from "./upload-form";

export const dynamic = "force-dynamic";
// Ingest workbook gabungan (puluhan ribu baris) bisa makan waktu > 10 dtk.
export const maxDuration = 60;

type LeadRow = LeadOption & { brand_category: string | null; logo_path: string | null; n_rows: number };

export default async function MerchantReportIndex() {
  const me = await getEmployee();
  if (!me) redirect("/login");
  if (!isMerchantReportStaff(me)) redirect("/dashboard");

  const supabase = await getCachedClient();
  const { data, error } = await supabase.rpc("merchant_report_leads", { p_only_with_data: false });
  const all = ((data ?? []) as LeadRow[]).map((l) => ({ ...l, months: l.months ?? [] }));
  const withData = all.filter((l) => l.months.length > 0);

  const thisMonth = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
  const recentMonths = Array.from({ length: 12 }, (_, i) => addMonths(thisMonth, -(i + 1)));

  return (
    <>
      <h1>Laporan Performa Merchant</h1>
      <p className="page-sub">
        Laporan bulanan TikTok GO per merchant (model &quot;Analisa Sushi Yay&quot;), dihitung otomatis dari export &quot;Content Analysis › Video
        List&quot;. Pilih merchant lalu periode untuk generate; insight bisa diedit tim BD.
      </p>
      {error && <div className="err">Gagal memuat daftar merchant: {error.message}</div>}

      <div className="card">
        <h2>Merchant dengan data</h2>
        {withData.length === 0 ? (
          <p className="muted">Belum ada data. Upload export Video List di bawah.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Lead</th>
                  <th>Bulan ter-upload</th>
                  <th className="right">Baris post×outlet</th>
                  <th>Laporan</th>
                </tr>
              </thead>
              <tbody>
                {withData.map((l) => {
                  const ms = [...l.months].sort();
                  const from = ms[Math.max(0, ms.length - 2)];
                  const to = ms[ms.length - 1];
                  return (
                    <tr key={l.lead_id}>
                      <td>
                        <b>{l.brand_name}</b>
                        {l.wilayah && <div className="muted">{l.wilayah}</div>}
                      </td>
                      <td className="mono">{l.lead_code}</td>
                      <td>
                        {ms.map((m) => (
                          <span key={m} className="badge slate" style={{ marginRight: 4 }}>
                            {monthLabelLong(m)}
                          </span>
                        ))}
                      </td>
                      <td className="right">{num(l.n_rows)}</td>
                      <td>
                        <Link href={`/meago/laporan-merchant/${l.lead_id}?dari=${from}&sampai=${to}`}>Buka laporan →</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Upload data mentah</h2>
        <MerchantUploadForm
          leads={all.map((l) => ({ lead_id: l.lead_id, lead_code: l.lead_code, brand_name: l.brand_name, wilayah: l.wilayah, months: l.months }))}
          recentMonths={recentMonths}
        />
        <p className="hint" style={{ marginTop: 12 }}>
          Satu brand bisa punya dua lead (mis. wilayah berbeda). Upload ke <b>lead induk</b> saja — data post × outlet yang sama tidak bisa masuk ke dua
          lead (ditolak supaya tidak terhitung ganda).
        </p>
      </div>
    </>
  );
}
