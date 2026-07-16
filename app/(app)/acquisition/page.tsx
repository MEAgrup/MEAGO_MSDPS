import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rupiah, tanggal } from "@/lib/format";
import {
  AddCreatorForm,
  RecordAcquisitionForm,
  RefreshGmvButton,
  HandoffButton,
  RecordReferralForm,
  MarkReferralPaidButton,
} from "./forms";

type Acquisition = {
  id: string;
  code: string | null;
  mcn_creator_id: string;
  specialist_id: string;
  lead_source: string | null;
  binding_date: string;
  commission_share_at_binding: number | null;
  gmv_last_30d: number | null;
  gmv_post_join: number | null;
  gmv_quarter_actual: number | null;
  handoff_done: boolean;
};

type Referral = {
  id: string;
  code: string | null;
  new_creator_id: string;
  referrer_creator_id: string | null;
  referral_source: string;
  commission_status: string;
};

type ProjectSummary = {
  id: string;
  code: string | null;
  name: string;
  creators_cm: number;
  creators_acquisition: number;
  creators_needed: number;
  actual_gmv: number;
  target_gmv: number | null;
  pct_gmv: number | null;
};

export default async function AcquisitionPage() {
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

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || div === "Acquisition" || div === "CreatorManagement";
  if (!canView) redirect("/dashboard");
  const canWrite = mgmt || div === "Acquisition";

  const { data: creatorsRaw } = await supabase
    .from("mcn_creators")
    .select("id, name, code, status, owner_cpm_id, username, niche, city, created_at")
    .order("name", { ascending: true });
  const creators =
    (creatorsRaw as
      | {
          id: string;
          name: string;
          code: string | null;
          status: string;
          owner_cpm_id: string | null;
          username: string | null;
          niche: string | null;
          city: string | null;
          created_at: string;
        }[]
      | null) ?? [];
  const creatorMap = new Map(creators.map((c) => [c.id, c]));
  const prospects = creators.filter((c) => c.status === "prospek").map((c) => ({ id: c.id, code: c.code, name: c.name }));
  const prospectRows = creators
    .filter((c) => c.status === "prospek")
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));

  const { data: acqRaw } = await supabase
    .from("acquisitions")
    .select(
      "id, code, mcn_creator_id, specialist_id, lead_source, binding_date, commission_share_at_binding, gmv_last_30d, gmv_post_join, gmv_quarter_actual, handoff_done"
    )
    .order("binding_date", { ascending: false });
  const acquisitions = (acqRaw as Acquisition[] | null) ?? [];

  const { data: refRaw } = await supabase
    .from("referrals")
    .select("id, code, new_creator_id, referrer_creator_id, referral_source, commission_status")
    .order("created_at", { ascending: false });
  const referrals = (refRaw as Referral[] | null) ?? [];

  const { data: emps } = await supabase.from("employees").select("id, full_name");
  const empName = new Map(((emps as { id: string; full_name: string }[] | null) ?? []).map((e) => [e.id, e.full_name]));

  const { data: projRaw } = await supabase
    .from("v_project_summary")
    .select("id, code, name, creators_cm, creators_acquisition, creators_needed, actual_gmv, target_gmv, pct_gmv")
    .eq("status", "active");
  const projects = (projRaw as ProjectSummary[] | null) ?? [];

  const creatorName = (id: string) => {
    const c = creatorMap.get(id);
    return c ? `${c.code ?? "—"} · ${c.name}` : "—";
  };

  return (
    <>
      <h1>Akuisisi Kreator</h1>
      <p className="page-sub">
        Catat closing/binding kreator baru, referral antar-kreator, dan handoff ke tim CM.
      </p>

      {canWrite && (
        <div className="card">
          <h2>Daftarkan Kreator Baru (Prospek)</h2>
          <AddCreatorForm />
        </div>
      )}

      <div className="card">
        <h2>Prospek Terdaftar ({prospectRows.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Username</th>
                <th>Industry</th>
                <th>Kota</th>
                <th>Tanggal Daftar</th>
              </tr>
            </thead>
            <tbody>
              {prospectRows.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code ?? "—"}</td>
                  <td>{c.name}</td>
                  <td className="mono">{c.username ?? "—"}</td>
                  <td className="muted">{c.niche ?? "—"}</td>
                  <td className="muted">{c.city ?? "—"}</td>
                  <td className="muted">{tanggal(c.created_at)}</td>
                </tr>
              ))}
              {prospectRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    Belum ada prospek.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canWrite && (
        <div className="card">
          <h2>Catat Akuisisi (Binding)</h2>
          <RecordAcquisitionForm prospects={prospects} />
        </div>
      )}

      <div className="card">
        <h2>Daftar Akuisisi ({acquisitions.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Kreator</th>
                <th>Specialist</th>
                <th>Sumber</th>
                <th>Binding</th>
                <th className="right">GMV 30d Pre</th>
                <th className="right">GMV Post-Join</th>
                <th>Handoff</th>
              </tr>
            </thead>
            <tbody>
              {acquisitions.map((a) => {
                const creator = creatorMap.get(a.mcn_creator_id);
                const blocked = !creator?.owner_cpm_id;
                return (
                  <tr key={a.id}>
                    <td className="mono">{a.code ?? "—"}</td>
                    <td>{creatorName(a.mcn_creator_id)}</td>
                    <td className="muted">{empName.get(a.specialist_id) ?? "—"}</td>
                    <td className="muted">{a.lead_source ?? "—"}</td>
                    <td className="muted">{tanggal(a.binding_date)}</td>
                    <td className="right">{rupiah(a.gmv_last_30d)}</td>
                    <td className="right">
                      {rupiah(a.gmv_post_join)}
                      {canWrite && (
                        <div style={{ marginTop: 4 }}>
                          <RefreshGmvButton id={a.id} />
                        </div>
                      )}
                    </td>
                    <td>
                      {a.handoff_done ? (
                        <span className="badge green">selesai</span>
                      ) : canWrite ? (
                        <HandoffButton id={a.id} blocked={blocked} />
                      ) : (
                        <span className="badge amber">pending</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {acquisitions.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Belum ada akuisisi tercatat.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canWrite && (
        <div className="card">
          <h2>Catat Referral</h2>
          <RecordReferralForm creators={creators.map((c) => ({ id: c.id, code: c.code, name: c.name }))} />
        </div>
      )}

      <div className="card">
        <h2>Daftar Referral ({referrals.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Kreator Baru</th>
              <th>Perujuk</th>
              <th>Sumber</th>
              <th>Status Komisi</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {referrals.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.code ?? "—"}</td>
                <td>{creatorName(r.new_creator_id)}</td>
                <td className="muted">{r.referrer_creator_id ? creatorName(r.referrer_creator_id) : "—"}</td>
                <td className="muted">{r.referral_source}</td>
                <td>
                  <span className={`badge ${r.commission_status === "dibayar" ? "green" : "amber"}`}>
                    {r.commission_status}
                  </span>
                </td>
                <td>
                  {r.commission_status === "pending" && (mgmt || me?.rank === "lead") ? (
                    <MarkReferralPaidButton id={r.id} />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {referrals.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Belum ada referral tercatat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Special Project Aktif</h2>
        <table>
          <thead>
            <tr>
              <th>Kode</th>
              <th>Nama</th>
              <th>Kreator (cm/akuisisi/butuh)</th>
              <th className="right">GMV Aktual / Target</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.code ?? "—"}</td>
                <td>{p.name}</td>
                <td className="muted">
                  {p.creators_cm}/{p.creators_acquisition}/{p.creators_needed}
                </td>
                <td className="right">
                  {rupiah(p.actual_gmv)} / {rupiah(p.target_gmv)}
                  {p.pct_gmv !== null && <div style={{ fontSize: 11, color: "#64748b" }}>{p.pct_gmv}%</div>}
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Tidak ada special project aktif.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
