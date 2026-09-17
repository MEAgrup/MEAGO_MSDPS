import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { POI_SLA_FLOWS, POI_SLA_FLOW_LABELS, type PoiSlaFlow } from "@/lib/mcn/poi-sop";
import { SlaSettingsTable, type SlaRow } from "./forms";

// Tab "Setting Bizdev & Admin Ops" — role leader dan atasnya dapat mengatur
// step SOP (tambah/edit/hapus) + SLA per step untuk tab POI Accommodation &
// TTD dan POI Dining (migrasi 0364). Konsep "leader" lintas divisi belum ada
// di skema (lihat lib/actions/poi-settings.ts), jadi untuk saat ini dibatasi
// is_director() saja.
export default async function BizdevSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();
  if (!me?.is_director) redirect("/dashboard");

  const supabase = await getCachedClient();
  const { data: rowsRaw } = await supabase
    .from("poi_sop_step_defs")
    .select("id, flow, step_no, task, sla_days, sla_label, is_optional, active")
    .order("flow", { ascending: true })
    .order("step_no", { ascending: true });

  const rows = (rowsRaw as SlaRow[] | null) ?? [];
  const byFlow = new Map<PoiSlaFlow, SlaRow[]>();
  for (const flow of POI_SLA_FLOWS) byFlow.set(flow, []);
  for (const r of rows) {
    const list = byFlow.get(r.flow as PoiSlaFlow);
    if (list) list.push(r);
  }

  return (
    <>
      <h1>Setting Bizdev &amp; Admin Ops</h1>
      <p className="page-sub">
        Atur step SOP (tambah, edit, hapus) dan SLA (jumlah hari / label) per step untuk tab POI Accommodation &amp;
        TTD dan POI Dining. Step baru selalu ditambahkan di akhir urutan dan otomatis muncul di deal/siklus yang
        sudah berjalan. Menghapus step tidak menghilangkan riwayat yang sudah tercatat — step hanya disembunyikan
        dari tampilan & hitungan ke depannya, dan bisa diaktifkan kembali kapan saja.
      </p>

      {POI_SLA_FLOWS.map((flow) => (
        <SlaSettingsTable key={flow} flow={flow} title={POI_SLA_FLOW_LABELS[flow]} rows={byFlow.get(flow) ?? []} />
      ))}
    </>
  );
}
