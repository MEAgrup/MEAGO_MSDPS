import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { num, rupiah, tanggal } from "@/lib/format";
import {
  BriefForwardForm,
  ImportTemplateForm,
  ManualLsrForm,
  ResolveUnmatchedForm,
  GmvAuthForm,
} from "./forms";

type Brief = {
  id: string;
  code: string | null;
  service_id: string;
  deliverable_type: string;
  due_date: string;
  status: string;
  instructions: string | null;
  target_metrics: Record<string, number> | null;
};
type Lsr = {
  id: string;
  code: string | null;
  brief_id: string | null;
  merchant_name_raw: string | null;
  week_number: number;
  gmv: number | null;
  jam_tayang: number | null;
  total_view: number | null;
  total_like: number | null;
  total_komen: number | null;
  total_share: number | null;
  entry_source: string;
  entry_status: string;
};
type Achievement = {
  brief_id: string;
  total_gmv: number;
  total_jam_tayang: number;
  target_gmv: number | null;
  target_jam_tayang: number | null;
  weeks_reported: number;
};
type GmvAuth = {
  id: string;
  merchant_id: string;
  period: string;
  gmv_value: number;
  confidence: string;
  source_note: string | null;
};

const LSR_BADGE: Record<string, string> = {
  "[Lengkap]": "green",
  "[Data Tidak Lengkap]": "amber",
  "[Unmatched]": "red",
};

export default async function LivestreamPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const mgmt = !!(me?.is_od || me?.is_director);
  if (!(me?.division === "Account" || me?.division === "LiveStream" || mgmt)) {
    redirect("/dashboard");
  }
  const isAm = me?.division === "Account" || mgmt;

  const supabase = await getCachedClient();

  const [{ data: briefs }, { data: lsrs }, { data: achievement }, { data: gmvAuth }, { data: allMerchants }] =
    await Promise.all([
      supabase
        .from("briefs")
        .select(
          "id, code, service_id, deliverable_type, due_date, status, instructions, target_metrics"
        )
        .eq("assigned_division", "LiveStream")
        .order("created_at", { ascending: false }),
      supabase
        .from("live_stream_results")
        .select(
          "id, code, brief_id, merchant_name_raw, week_number, gmv, jam_tayang, total_view, total_like, total_komen, total_share, entry_source, entry_status"
        )
        .order("week_number"),
      supabase
        .from("v_ls_achievement")
        .select("brief_id, total_gmv, total_jam_tayang, target_gmv, target_jam_tayang, weeks_reported"),
      supabase
        .from("merchant_gmv_authoritative")
        .select("id, merchant_id, period, gmv_value, confidence, source_note")
        .order("period", { ascending: false }),
      // Merchant untuk form GMV otoritatif: semua merchant yang visible.
      supabase.from("merchants").select("id, code, nama_toko").order("nama_toko"),
    ]);

  const bList = (briefs as Brief[] | null) ?? [];
  const lList = (lsrs as Lsr[] | null) ?? [];
  const aMap = new Map(((achievement as Achievement[] | null) ?? []).map((a) => [a.brief_id, a]));
  const gList = (gmvAuth as GmvAuth[] | null) ?? [];
  const allM = (allMerchants as { id: string; code: string | null; nama_toko: string }[] | null) ?? [];
  const allMMap = new Map(allM.map((m) => [m.id, m]));

  // Nama merchant per brief (via services) — untuk display + resolve unmatched.
  const serviceIds = [...new Set(bList.map((b) => b.service_id))];
  const { data: services } = serviceIds.length
    ? await supabase.from("services").select("id, merchant_id").in("id", serviceIds)
    : { data: [] as { id: string; merchant_id: string }[] };
  const merchantIds = [...new Set((services ?? []).map((s) => s.merchant_id))];
  const { data: merchants } = merchantIds.length
    ? await supabase.from("merchants").select("id, code, nama_toko").in("id", merchantIds)
    : { data: [] as { id: string; code: string | null; nama_toko: string }[] };
  const svcMerchant = new Map((services ?? []).map((s) => [s.id, s.merchant_id]));
  const mMap = new Map((merchants ?? []).map((m) => [m.id, m]));
  const merchantName = (b: Brief) =>
    mMap.get(svcMerchant.get(b.service_id) ?? "")?.nama_toko ?? "—";

  const pendingForward = bList.filter((b) => b.status === "[Menunggu Forward ke Vendor]");
  const forwarded = bList.filter((b) => b.status === "[Diteruskan ke Vendor]");
  const completed = bList.filter((b) => b.status === "[Completed]");
  const unmatched = lList.filter((l) => l.entry_status === "[Unmatched]");
  const resolveTargets = [...forwarded, ...completed].map((b) => ({
    id: b.id,
    code: b.code,
    merchantName: merchantName(b),
  }));

  return (
    <>
      <h1>Live Stream — Vendor Results Tracker</h1>
      <p className="page-sub">
        Bukan modul eksekusi — tracker hasil vendor. AM meneruskan brief ke vendor, lalu mencatat
        hasil mingguan via upload Template Baku atau input manual. Baris tak cocok = [Unmatched],
        di-resolve AM. Plus GMV otoritatif bulanan per merchant.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Menunggu Forward</div>
          <div className="v">{pendingForward.length}</div>
        </div>
        <div className="stat">
          <div className="k">Di Vendor</div>
          <div className="v">{forwarded.length}</div>
        </div>
        <div className="stat">
          <div className="k">Baris Unmatched</div>
          <div className="v">{unmatched.length}</div>
        </div>
        <div className="stat">
          <div className="k">Brief Selesai</div>
          <div className="v">{completed.length}</div>
        </div>
      </div>

      {pendingForward.length > 0 && (
        <div className="card">
          <h2>Menunggu Forward ke Vendor ({pendingForward.length})</h2>
          <table>
            <thead>
              <tr>
                <th>Brief</th>
                <th>Merchant</th>
                <th>Deliverable</th>
                <th>SLA</th>
                <th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pendingForward.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.code ?? "—"}</td>
                  <td>{merchantName(b)}</td>
                  <td>{b.deliverable_type}</td>
                  <td>{tanggal(b.due_date)}</td>
                  <td>
                    {isAm && (
                      <BriefForwardForm
                        briefId={b.id}
                        toStatus="[Diteruskan ke Vendor]"
                        label="Teruskan ke vendor"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isAm && (
        <div className="card">
          <h2>Upload Template Baku (mingguan)</h2>
          <p className="section-sub">
            Vendor kirim file mentah → normalisasi ke Template Baku → tempel di sini. Matching nama
            merchant toleran (case-insensitive, abaikan spasi/tanda baca). Minggu yang sama akan
            di-replace.
          </p>
          <ImportTemplateForm />
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="card">
          <h2>Baris [Unmatched] — perlu resolve ({unmatched.length})</h2>
          <table>
            <thead>
              <tr>
                <th>LSR</th>
                <th>Nama di file</th>
                <th>Minggu</th>
                <th className="right">GMV</th>
                {isAm && <th>Resolve</th>}
              </tr>
            </thead>
            <tbody>
              {unmatched.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.code}</td>
                  <td>{l.merchant_name_raw ?? "—"}</td>
                  <td>W{l.week_number}</td>
                  <td className="right">{rupiah(l.gmv)}</td>
                  {isAm && (
                    <td>
                      <ResolveUnmatchedForm lsrId={l.id} briefs={resolveTargets} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {[...forwarded, ...completed].map((b) => {
        const rows = lList.filter((l) => l.brief_id === b.id);
        const ach = aMap.get(b.id);
        return (
          <div className="card" key={b.id}>
            <h2>
              <span className="mono">{b.code ?? "—"}</span> · {merchantName(b)}{" "}
              <span className={`badge ${b.status === "[Completed]" ? "green" : "slate"}`}>
                {b.status}
              </span>
            </h2>
            <p className="section-sub">
              {b.deliverable_type} · SLA {tanggal(b.due_date)} · {ach?.weeks_reported ?? 0} minggu
              tercatat
              {ach?.target_gmv != null && (
                <>
                  {" "}
                  · GMV <strong>{rupiah(ach.total_gmv)}</strong> / target {rupiah(ach.target_gmv)} (
                  {ach.target_gmv > 0
                    ? ((Number(ach.total_gmv) / Number(ach.target_gmv)) * 100).toFixed(0)
                    : 0}
                  %)
                </>
              )}
              {ach?.target_jam_tayang != null && (
                <>
                  {" "}
                  · Jam tayang <strong>{num(ach.total_jam_tayang)}</strong> / target{" "}
                  {num(ach.target_jam_tayang)} (
                  {ach.target_jam_tayang > 0
                    ? ((Number(ach.total_jam_tayang) / Number(ach.target_jam_tayang)) * 100).toFixed(0)
                    : 0}
                  %)
                </>
              )}
            </p>

            {rows.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Minggu</th>
                    <th className="right">GMV</th>
                    <th className="right">Jam Tayang</th>
                    <th className="right">View</th>
                    <th className="right">Like</th>
                    <th className="right">Komen</th>
                    <th className="right">Share</th>
                    <th>Sumber</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id}>
                      <td>W{l.week_number}</td>
                      <td className="right">{rupiah(l.gmv)}</td>
                      <td className="right">{num(l.jam_tayang)}</td>
                      <td className="right">{num(l.total_view)}</td>
                      <td className="right">{num(l.total_like)}</td>
                      <td className="right">{num(l.total_komen)}</td>
                      <td className="right">{num(l.total_share)}</td>
                      <td className="muted">{l.entry_source}</td>
                      <td>
                        <span className={`badge ${LSR_BADGE[l.entry_status] ?? "gray"}`}>
                          {l.entry_status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {isAm && b.status === "[Diteruskan ke Vendor]" && (
              <div style={{ marginTop: 10 }}>
                <ManualLsrForm briefId={b.id} />
                <div className="inline-actions" style={{ marginTop: 8 }}>
                  <BriefForwardForm
                    briefId={b.id}
                    toStatus="[Completed]"
                    label="Tandai Brief Completed"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="card">
        <h2>GMV Otoritatif Bulanan (manual + confidence)</h2>
        <p className="section-sub">
          Basis Merchant Health (M13). Entry per merchant per bulan; periode sama akan di-replace.
        </p>
        {isAm && <GmvAuthForm merchants={allM} />}
        {gList.length > 0 && (
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Periode</th>
                <th>Merchant</th>
                <th className="right">GMV</th>
                <th>Confidence</th>
                <th>Sumber</th>
              </tr>
            </thead>
            <tbody>
              {gList.map((g) => (
                <tr key={g.id}>
                  <td className="mono">
                    {g.period.slice(0, 4)}-{g.period.slice(4)}
                  </td>
                  <td>{allMMap.get(g.merchant_id)?.nama_toko ?? "—"}</td>
                  <td className="right">{rupiah(g.gmv_value)}</td>
                  <td>
                    <span
                      className={`badge ${g.confidence === "[GMV Terverifikasi]" ? "green" : "amber"}`}
                    >
                      {g.confidence}
                    </span>
                  </td>
                  <td className="muted">{g.source_note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
