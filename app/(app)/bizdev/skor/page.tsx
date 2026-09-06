import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { SkorBoard, type PoinRule, type RealisasiRow, type SummaryRow } from "./skor-board";

// Papan Skor BD — pembaca pertama v_poi_deal_summary & v_poi_deal_realisasi.
// Kedua view sudah ada sejak 0339 dan diperbaiki 0355/0356 (opsi B: poin
// TURUNAN saat dibaca dari poi_sop_progress / poi_dining_cycles), tapi sampai
// halaman ini dibuat tidak dibaca satu baris pun di app/ maupun lib/ — angkanya
// benar tapi tak terlihat siapa pun.
//
// Halaman ini SENGAJA tidak menghitung poin sendiri. Rumusnya hidup di view;
// menyalinnya ke TypeScript akan menciptakan sumber kebenaran kedua yang pasti
// menyimpang begitu app_config.poi.poin_rule diubah. Yang dilakukan di sini
// hanya agregasi lintas kategori dan penerjemahan poin_status jadi bahasa
// manusia — supaya BD tahu APA yang harus dikerjakan agar poinnya naik, bukan
// cuma melihat angka 0.

export default async function PoiSkorPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();

  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || me?.division === "BizDev";
  if (!canView) redirect("/dashboard");

  const supabase = await getCachedClient();

  // Kedua view security_invoker = true, jadi RLS brand_deals/poi_* milik
  // pembaca yang berlaku (BizDev & mgmt boleh SELECT semuanya).
  const [{ data: summaryRaw }, { data: realisasiRaw }, { data: ruleRaw }] = await Promise.all([
    supabase
      .from("v_poi_deal_summary")
      .select(
        "period, bd_id, bd_name, kategori_poi, total_deal, realisasi_visit, poin_sum, kreator_realized_sum, vt_total_sum, gmv_sum, deal_poin_belum_ditentukan"
      ),
    supabase
      .from("v_poi_deal_realisasi")
      .select(
        "deal_id, code, brand_name, period, bd_id, kategori_poi, bentuk_kerjasama, flow, kreator_needed, vt_report_step, kreator_realized, vt_total, total_gmv, cycle_count, cycle_verified_count, vt_report_done, pct_kreator, poin, poin_status"
      ),
    supabase.from("app_config").select("value").eq("key", "poi.poin_rule").maybeSingle(),
  ]);

  // Nama BD hanya ada di summary (view realisasi cuma membawa bd_id). Dipetakan
  // di sini supaya tabel detail tidak menampilkan UUID.
  const summary = (summaryRaw as SummaryRow[] | null) ?? [];
  const bdNameById = new Map<string, string>();
  for (const s of summary) if (s.bd_id) bdNameById.set(s.bd_id, s.bd_name);

  const realisasi = ((realisasiRaw as RealisasiRow[] | null) ?? []).map((r) => ({
    ...r,
    bd_name: (r.bd_id && bdNameById.get(r.bd_id)) ?? "(tanpa BD)",
  }));

  // Default view 0355/0356 dipakai kalau baris config hilang — sama persis
  // dengan default di dalam view, jadi yang ditampilkan tetap aturan yang benar.
  const cfg = (ruleRaw as { value: Partial<PoinRule> } | null)?.value ?? {};
  const rule: PoinRule = {
    full_pct: Number(cfg.full_pct ?? 100),
    full: Number(cfg.full ?? 2),
    half_pct: Number(cfg.half_pct ?? 50),
    half: Number(cfg.half ?? 1),
    low: Number(cfg.low ?? 0.5),
  };

  return (
    <>
      <h1>Papan Skor BD</h1>
      <p className="page-sub">
        Skor POI per BD, dihitung ulang setiap halaman ini dibuka dari bukti SOP yang
        sudah dicentang Ops — bukan dari angka yang disimpan. Deal tanpa{" "}
        <code>kategori_poi</code> tidak ikut diskor.
      </p>

      {summary.length === 0 ? (
        <div className="card">
          <h2>Belum ada deal berkategori POI</h2>
          <p className="muted">
            Skor baru muncul setelah ada transaksi deal yang <code>kategori_poi</code>-nya
            terisi. Lengkapi lewat Merchant Deals.
          </p>
        </div>
      ) : (
        <SkorBoard summary={summary} realisasi={realisasi} rule={rule} />
      )}
    </>
  );
}
