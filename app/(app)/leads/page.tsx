import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tanggal } from "@/lib/format";
import { NewLeadForm, ImportCsvForm, ClaimButton, AttemptControls } from "./forms";

type Lead = {
  id: string;
  code: string | null;
  lead_name: string;
  phone_normalized: string;
  source: string;
  status: string;
  stale: boolean;
  created_at: string;
};

type Attempt = {
  id: string;
  code: string | null;
  parent_lead_id: string;
  owner_id: string;
  status: string;
  won: boolean;
  not_qualified_reason: string | null;
};

const LEAD_STATUS_CLASS: Record<string, string> = {
  "[Pool]": "slate",
  "[Scouted - Aktif]": "blue",
  "[Closed - Success]": "green",
  "[Tidak Berkualitas]": "amber",
  "[Ditolak]": "red",
};

const ATTEMPT_STATUS_CLASS: Record<string, string> = {
  "[Pending Validation]": "slate",
  "[New Lead]": "slate",
  "[Contacted]": "blue",
  "[Qualified]": "blue",
  "[Negotiation]": "amber",
  "[Closed - Success]": "green",
  "[Closed - Lost]": "red",
  "[Closed - Kalah Kompetisi]": "red",
  "[Not Qualified]": "amber",
};

export default async function LeadsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("employees")
    .select("id, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  const isBizDev = me?.division === "BizDev";
  const canRegister = isBizDev || me?.division === "Marketing" || !!me?.is_director;
  const canControl = (ownerId: string) =>
    ownerId === me?.id || (isBizDev && me?.rank === "lead") || !!me?.is_director;

  const { data: leads } = await supabase
    .from("leads")
    .select("id, code, lead_name, phone_normalized, source, status, stale, created_at")
    .order("created_at", { ascending: false });

  const { data: attempts } = await supabase
    .from("prospect_attempts")
    .select("id, code, parent_lead_id, owner_id, status, won, not_qualified_reason")
    .order("created_at", { ascending: false });

  const { data: emps } = await supabase.from("employees").select("id, full_name");
  const empName = new Map<string, string>((emps ?? []).map((e) => [e.id, e.full_name]));

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("id, code, campaign_name")
    .order("created_at", { ascending: false });

  const leadList = (leads as Lead[] | null) ?? [];
  const attList = (attempts as Attempt[] | null) ?? [];
  const attByLead = new Map<string, Attempt[]>();
  for (const a of attList) {
    const arr = attByLead.get(a.parent_lead_id) ?? [];
    arr.push(a);
    attByLead.set(a.parent_lead_id, arr);
  }

  const poolCount = leadList.filter((l) => l.status === "[Pool]").length;
  const myOpen = attList.filter(
    (a) => a.owner_id === me?.id && a.status.startsWith("[") && !a.status.startsWith("[Closed")
  ).length;
  const won = attList.filter((a) => a.won).length;
  const contested = [...attByLead.values()].filter((arr) => arr.length > 1).length;

  return (
    <>
      <h1>Leads &amp; Prospek</h1>
      <p className="page-sub">
        Pool lead dedup by nomor (E.164). Prospek = salinan kerja BizDev; yang pertama closing
        menang, sisanya otomatis [Closed - Kalah Kompetisi].
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Lead</div>
          <div className="v">{leadList.length}</div>
        </div>
        <div className="stat">
          <div className="k">Di Pool</div>
          <div className="v">{poolCount}</div>
        </div>
        <div className="stat">
          <div className="k">Prospek Saya (aktif)</div>
          <div className="v">{myOpen}</div>
        </div>
        <div className="stat">
          <div className="k">Diperebutkan</div>
          <div className="v">{contested}</div>
        </div>
      </div>

      <div className="card">
        <h2>Pool Lead ({leadList.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Nomor</th>
              <th>Sumber</th>
              <th>Status</th>
              <th className="right">Prospek</th>
              {isBizDev && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {leadList.map((l) => {
              const n = attByLead.get(l.id)?.length ?? 0;
              const claimable = l.status === "[Pool]" || l.status === "[Scouted - Aktif]";
              return (
                <tr key={l.id}>
                  <td className="mono">{l.code ?? "—"}</td>
                  <td>
                    {l.lead_name} {l.stale && <span className="badge amber">stale</span>}
                  </td>
                  <td className="mono">{l.phone_normalized}</td>
                  <td className="muted">{l.source}</td>
                  <td>
                    <span className={`badge ${LEAD_STATUS_CLASS[l.status] ?? "gray"}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="right">{n}</td>
                  {isBizDev && (
                    <td>{claimable ? <ClaimButton leadId={l.id} /> : <span className="muted">—</span>}</td>
                  )}
                </tr>
              );
            })}
            {leadList.length === 0 && (
              <tr>
                <td colSpan={isBizDev ? 7 : 6} className="muted">
                  Belum ada lead. Daftarkan atau impor di bawah.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Papan Kompetisi Prospek</h2>
        <p className="section-sub">
          Setiap prospek yang Anda lihat sesuai hak akses. Closing dilakukan di menu Merchant
          (memanggil close_deal).
        </p>
        <table>
          <thead>
            <tr>
              <th>Prospek</th>
              <th>Lead</th>
              <th>Owner (BizDev)</th>
              <th>Status</th>
              <th>Lanjutkan</th>
            </tr>
          </thead>
          <tbody>
            {attList.map((a) => {
              const lead = leadList.find((l) => l.id === a.parent_lead_id);
              return (
                <tr key={a.id}>
                  <td className="mono">{a.code ?? "(pending)"}</td>
                  <td>
                    <span className="mono">{lead?.code ?? "—"}</span> {lead?.lead_name ?? "?"}
                  </td>
                  <td>{empName.get(a.owner_id) ?? "—"}</td>
                  <td>
                    <span className={`badge ${ATTEMPT_STATUS_CLASS[a.status] ?? "gray"}`}>
                      {a.status}
                    </span>
                    {a.not_qualified_reason && (
                      <div className="muted" style={{ fontSize: 11 }}>
                        {a.not_qualified_reason}
                      </div>
                    )}
                  </td>
                  <td>
                    {canControl(a.owner_id) ? (
                      <AttemptControls id={a.id} status={a.status} />
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {attList.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Belum ada prospek. BizDev dapat mengambil lead dari pool di atas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canRegister && (
        <>
          <div className="card">
            <h2>Daftarkan Lead</h2>
            <NewLeadForm campaigns={campaigns ?? []} />
          </div>
          <div className="card">
            <details className="disclose">
              <summary>Impor Massal (CSV)</summary>
              <ImportCsvForm campaigns={campaigns ?? []} />
            </details>
          </div>
        </>
      )}
    </>
  );
}
