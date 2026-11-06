import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { rupiah, tanggal } from "@/lib/format";
import { todayJakartaYMD } from "@/lib/mcn/project-status";
import { addDays, parseYMD } from "@/lib/mcn/weeks";
import {
  computeAcquisitionStats,
  type AcqIn,
  type CreatorIn,
  type ProspectIn,
} from "@/lib/mcn/acquisition-stats";

// Dashboard Performa Akuisisi (laporan Siti, ACC Yohan 2026-11-06).
// Scouting / Binding / CR / GMV — tim & individu, filter periode, PIC, sumber lead.
// Definisi metrik ada di lib/mcn/acquisition-stats.ts & docs/DECISIONS.md.

const LEAD_SOURCES = ["inbound", "outbound", "platform"] as const;

function pct(v: number | null) {
  return v === null ? "—" : `${v.toLocaleString("id-ID")}%`;
}

export default async function AcquisitionDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ dari?: string; sampai?: string; pic?: string; sumber?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();
  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  if (!(mgmt || div === "Acquisition" || div === "CreatorManagement")) redirect("/dashboard");

  const sp = await searchParams;
  const today = todayJakartaYMD();
  const monthStart = `${today.slice(0, 8)}01`;
  let from = sp.dari && parseYMD(sp.dari) ? sp.dari : monthStart;
  let to = sp.sampai && parseYMD(sp.sampai) ? sp.sampai : today;
  if (from > to) [from, to] = [to, from];
  const pic = sp.pic || null;
  const sumber = sp.sumber && (LEAD_SOURCES as readonly string[]).includes(sp.sumber) ? sp.sumber : null;

  // Batas waktu WIB untuk kolom timestamptz.
  const tsFrom = `${from}T00:00:00+07:00`;
  const tsToExcl = `${addDays(to, 1)}T00:00:00+07:00`;

  const supabase = await getCachedClient();
  const { data: emps } = await supabase.from("employees").select("id, full_name, division, active");
  const empRows = (emps as { id: string; full_name: string; division: string | null; active: boolean | null }[] | null) ?? [];
  const empName = new Map(empRows.map((e) => [e.id, e.full_name]));
  const acqStaff = empRows.filter((e) => e.division === "Acquisition" && e.active !== false);
  const acqStaffIds = acqStaff.map((e) => e.id);

  const [prosRes, creRes, acqRes] = await Promise.all([
    supabase
      .from("creator_prospects")
      .select("owner_id, created_at, matched_mcn_creator_id")
      .gte("created_at", tsFrom)
      .lt("created_at", tsToExcl),
    acqStaffIds.length
      ? supabase
          .from("mcn_creators")
          .select("id, created_by, created_at")
          .in("created_by", acqStaffIds)
          .gte("created_at", tsFrom)
          .lt("created_at", tsToExcl)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("acquisitions")
      .select("specialist_id, binding_date, lead_source, gmv_potential, gmv_post_join")
      .gte("binding_date", from)
      .lte("binding_date", to),
  ]);
  const loadErr = prosRes.error || creRes.error || acqRes.error;

  const prospects = (prosRes.data as ProspectIn[] | null) ?? [];
  const creators = (creRes.data as CreatorIn[] | null) ?? [];
  const acquisitions = (acqRes.data as AcqIn[] | null) ?? [];

  // Kreator yang tertaut ke prospek (prospek bisa dibuat sebelum periode) —
  // sudah dihitung lewat creator_prospects, jangan dihitung dobel.
  const { data: linkedRaw } = creators.length
    ? await supabase
        .from("creator_prospects")
        .select("matched_mcn_creator_id")
        .in("matched_mcn_creator_id", creators.map((c) => c.id))
    : { data: [] };
  const linkedCreatorIds = ((linkedRaw as { matched_mcn_creator_id: string }[] | null) ?? []).map(
    (r) => r.matched_mcn_creator_id
  );

  const { team, people } = computeAcquisitionStats({
    prospects,
    creators,
    acquisitions,
    acqStaffIds,
    linkedCreatorIds,
    from,
    to,
    specialist: pic,
    leadSource: sumber,
  });

  // Opsi filter PIC: staf Acquisition aktif + siapa pun yang muncul di data.
  const picOptions = [...new Set([...acqStaffIds, ...people.map((p) => p.id).filter(Boolean)])]
    .map((id) => ({ id, name: empName.get(id) ?? "(karyawan nonaktif)" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard Akuisisi</h1>
          <p className="page-sub">
            Performa scouting → binding tim Akuisisi, total & per individu.{" "}
            <Link href="/acquisition">← Akuisisi Kreator</Link>
          </p>
        </div>
      </div>

      <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end", margin: "0 0 16px" }}>
        <div>
          <label>Dari</label>
          <input type="date" name="dari" defaultValue={from} />
        </div>
        <div>
          <label>Sampai</label>
          <input type="date" name="sampai" defaultValue={to} />
        </div>
        <div>
          <label>PIC Akuisisi</label>
          <select name="pic" defaultValue={pic ?? ""}>
            <option value="">Semua (tim)</option>
            {picOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Sumber Lead</label>
          <select name="sumber" defaultValue={sumber ?? ""}>
            <option value="">Semua sumber</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button type="submit">Tampilkan</button>
      </form>

      {loadErr && <div className="err">Gagal memuat data: {loadErr.message}</div>}

      <p className="muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
        Periode {tanggal(from)} – {tanggal(to)}
        {pic ? ` · ${empName.get(pic) ?? "PIC"}` : " · seluruh tim"}
        {sumber ? ` · sumber ${sumber} (hanya memfilter Binding & GMV)` : ""}
      </p>
      <div className="stats">
        <div className="stat">
          <div className="k">Scouting</div>
          <div className="v">{team.scouting.toLocaleString("id-ID")}</div>
        </div>
        <div className="stat">
          <div className="k">Binding</div>
          <div className="v">{team.binding.toLocaleString("id-ID")}</div>
        </div>
        <div className="stat">
          <div className="k">CR (Binding ÷ Scouting)</div>
          <div className="v">{pct(team.cr)}</div>
        </div>
        <div className="stat">
          <div className="k">GMV Post-Join</div>
          <div className="v small">{rupiah(team.gmv_actual)}</div>
        </div>
        <div className="stat">
          <div className="k">GMV Potential</div>
          <div className="v small">{rupiah(team.gmv_potential)}</div>
        </div>
      </div>

      <div className="card">
        <h2>Per Individu</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>PIC Akuisisi</th>
                <th className="right">Scouting</th>
                <th className="right">Binding</th>
                <th className="right">CR</th>
                <th className="right">GMV Post-Join</th>
                <th className="right">GMV Potential</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id || "none"}>
                  <td>{p.id ? (empName.get(p.id) ?? "(karyawan nonaktif)") : <span className="muted">Belum ada PIC</span>}</td>
                  <td className="right">{p.scouting.toLocaleString("id-ID")}</td>
                  <td className="right">{p.binding.toLocaleString("id-ID")}</td>
                  <td className="right">{pct(p.cr)}</td>
                  <td className="right">{rupiah(p.gmv_actual)}</td>
                  <td className="right">{rupiah(p.gmv_potential)}</td>
                </tr>
              ))}
              {people.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Belum ada data pada filter ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          <b>Scouting</b> = prospek baru di periode (Prospek Kreator → PIC prospek; &quot;Daftarkan Prospek&quot;
          manual → staf yang mendaftarkan; tidak dihitung dobel). <b>Binding</b> = akuisisi dengan tanggal binding
          di periode. <b>CR</b> = Binding ÷ Scouting periode yang sama. <b>GMV Post-Join</b> terisi setelah
          &quot;Refresh GMV&quot; di halaman Akuisisi; <b>GMV Potential</b> = estimasi Akuisisi saat binding.
        </p>
      </div>
    </>
  );
}
