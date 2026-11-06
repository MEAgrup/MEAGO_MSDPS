// /meago/laporan-merchant/[lead_id]?dari=YYYY-MM&sampai=YYYY-MM — Laporan Performa
// Merchant (migrasi 0378). Metrik dihitung dari tiktok_post_snapshots dengan
// lib/merchant-report/metrics.ts (port compute_metrics.py); insight otomatis bisa
// ditimpa teks tersimpan tim BD (merchant_report_notes).
import "./report.css";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getEmployee, getCachedClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminEnv } from "@/lib/supabase/admin";
import { isMerchantReportStaff } from "@/lib/merchant-report/access";
import { loadReport } from "@/lib/merchant-report/load";
import { autoInsights, INSIGHT_KEYS, type InsightKey } from "@/lib/merchant-report/insights";
import { monthLabelLong } from "@/lib/merchant-report/metrics";
import { MerchantReport, periodText } from "./report";
import { ReportRoot } from "./report-client";

export const dynamic = "force-dynamic";

type LeadRow = { lead_id: string; lead_code: string | null; brand_name: string; logo_path: string | null; months: string[] };
const PERIOD_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;

export default async function MerchantReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ lead_id: string }>;
  searchParams: Promise<{ dari?: string; sampai?: string }>;
}) {
  const me = await getEmployee();
  if (!me) redirect("/login");
  if (!isMerchantReportStaff(me)) redirect("/dashboard");

  const { lead_id } = await params;
  const sp = await searchParams;
  const supabase = await getCachedClient();
  const { data: leads, error } = await supabase.rpc("merchant_report_leads", { p_only_with_data: false });
  if (error) throw new Error(error.message);
  const lead = ((leads ?? []) as LeadRow[]).find((l) => l.lead_id === lead_id);
  if (!lead) notFound();

  const months = [...(lead.months ?? [])].sort();
  if (months.length === 0) {
    return (
      <>
        <h1>Laporan {lead.brand_name}</h1>
        <div className="card">
          <p className="muted">Belum ada data export Video List untuk merchant ini.</p>
          <Link href="/meago/laporan-merchant">← Upload data di halaman Laporan Merchant</Link>
        </div>
      </>
    );
  }
  // Default: dua bulan terakhir yang punya data.
  let from = sp.dari && PERIOD_RE.test(sp.dari) ? sp.dari : months[Math.max(0, months.length - 2)];
  let to = sp.sampai && PERIOD_RE.test(sp.sampai) ? sp.sampai : months[months.length - 1];
  if (to < from) [from, to] = [to, from];

  const [loaded, notesRes] = await Promise.all([
    loadReport(supabase, lead_id, from, to),
    supabase
      .from("merchant_report_notes")
      .select("section_key, body")
      .eq("lead_id", lead_id)
      .eq("period_from", `${from}-01`)
      .eq("period_to", `${to}-01`),
  ]);
  const notes: Partial<Record<InsightKey, string>> = {};
  for (const r of (notesRes.data ?? []) as { section_key: string; body: string }[]) {
    if ((INSIGHT_KEYS as string[]).includes(r.section_key)) notes[r.section_key as InsightKey] = r.body;
  }

  let logoUrl: string | null = null;
  if (lead.logo_path && hasAdminEnv()) {
    const { data } = await createAdminClient().storage.from("merchant-logos").createSignedUrl(lead.logo_path, 3600);
    logoUrl = data?.signedUrl ?? null;
  }

  const periodPicker = (
    <form method="get" className="filters-row mr-period no-print" style={{ marginBottom: 12, alignItems: "end", display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Link href="/meago/laporan-merchant" style={{ marginRight: "auto" }}>
        ← Semua merchant
      </Link>
      <label style={{ margin: 0 }}>
        Dari{" "}
        <select name="dari" defaultValue={from} style={{ width: "auto" }}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabelLong(m)}
            </option>
          ))}
        </select>
      </label>
      <label style={{ margin: 0 }}>
        Sampai{" "}
        <select name="sampai" defaultValue={to} style={{ width: "auto" }}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabelLong(m)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" style={{ width: "auto" }}>
        Generate
      </button>
    </form>
  );

  if (!loaded.metrics) {
    return (
      <>
        {periodPicker}
        <div className="card">
          <p className="muted">Tidak ada data valid untuk {periodText([from, to])}.</p>
        </div>
      </>
    );
  }

  return (
    <>
      {periodPicker}
      <ReportRoot leadId={lead_id} from={from} to={to}>
        <MerchantReport
          brand={lead.brand_name}
          leadCode={lead.lead_code}
          logoUrl={logoUrl}
          metrics={loaded.metrics}
          params={loaded.params}
          auto={autoInsights(loaded.metrics, loaded.params)}
          notes={notes}
          missing={loaded.missing}
          generatedAt={new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)}
        />
      </ReportRoot>
    </>
  );
}
