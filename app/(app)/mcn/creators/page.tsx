import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rupiah } from "@/lib/format";
import {
  AddCreatorForm,
  AssignOwnerForm,
  ToggleRosterButton,
  AdsBudgetCapForm,
  CreatorStatusControls,
} from "./forms";

type Creator = {
  id: string;
  code: string | null;
  name: string;
  platform: string;
  status: string;
  niche: string | null;
  jenis_creator: string | null;
  gmv: number | null;
  gmv_live: number | null;
  gmv_video: number | null;
  commission_share: number | null;
  owner_cpm_id: string | null;
  live_roster: boolean;
  ads_budget_cap: number | null;
};

const STATUS_CLASS: Record<string, string> = {
  prospek: "slate",
  binding: "amber",
  aktif: "green",
  nonaktif: "red",
};

export default async function McnCreatorsPage() {
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
  const canView = mgmt || ["CreatorManagement", "BizDev", "Acquisition", "KOL"].includes(div);
  if (!canView) redirect("/dashboard");

  const isCmLeadOrMgmt = mgmt || (div === "CreatorManagement" && me?.rank === "lead");
  const canAddProspect = mgmt || div === "CreatorManagement" || div === "Acquisition";

  const { data: creatorsRaw } = await supabase
    .from("mcn_creators")
    .select(
      "id, code, name, platform, status, niche, jenis_creator, gmv, gmv_live, gmv_video, commission_share, owner_cpm_id, live_roster, ads_budget_cap"
    )
    .order("name", { ascending: true });
  const creators = (creatorsRaw as Creator[] | null) ?? [];

  const { data: emps } = await supabase
    .from("employees")
    .select("id, full_name, division, rank");
  const empList = (emps as { id: string; full_name: string; division: string; rank: string }[] | null) ?? [];
  const empName = new Map(empList.map((e) => [e.id, e.full_name]));
  const cmEmployees = empList
    .filter((e) => e.division === "CreatorManagement")
    .map((e) => ({ id: e.id, full_name: e.full_name }));

  const canWriteRow = (c: Creator) =>
    mgmt || div === "Acquisition" || (div === "CreatorManagement" && (me?.rank === "lead" || c.owner_cpm_id === me?.id));

  return (
    <>
      <h1>Data Kreator MCN</h1>
      <p className="page-sub">
        Master kreator affiliate TikTok — terpisah dari master KOL (M9). GMV ditampilkan rata-rata
        bulanan (auto-fill dari ingest); komisi read-only (sinkron platform).
      </p>

      <div className="card">
        <h2>Master Kreator ({creators.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Nama</th>
                <th>Platform</th>
                <th>Status</th>
                <th>Niche</th>
                <th>Jenis</th>
                <th className="right">GMV/bln</th>
                <th>Komisi</th>
                <th>Owner CM</th>
                <th>Roster Live</th>
                <th>Ads Cap</th>
                <th>Transisi</th>
              </tr>
            </thead>
            <tbody>
              {creators.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code ?? "—"}</td>
                  <td>{c.name}</td>
                  <td className="muted">{c.platform}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[c.status] ?? "gray"}`}>{c.status}</span>
                  </td>
                  <td className="muted">{c.niche ?? "—"}</td>
                  <td className="muted">{c.jenis_creator ?? "—"}</td>
                  <td className="right">{rupiah(c.gmv)}</td>
                  <td className="muted">{c.commission_share !== null ? `${c.commission_share}%` : "—"}</td>
                  <td>
                    {isCmLeadOrMgmt ? (
                      <AssignOwnerForm creatorId={c.id} ownerId={c.owner_cpm_id} cmEmployees={cmEmployees} />
                    ) : (
                      empName.get(c.owner_cpm_id ?? "") ?? <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {canWriteRow(c) ? (
                      <ToggleRosterButton creatorId={c.id} liveRoster={c.live_roster} />
                    ) : c.live_roster ? (
                      <span className="badge green">roster</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    {canWriteRow(c) ? (
                      <AdsBudgetCapForm creatorId={c.id} current={c.ads_budget_cap} />
                    ) : (
                      rupiah(c.ads_budget_cap)
                    )}
                  </td>
                  <td>{canWriteRow(c) ? <CreatorStatusControls creatorId={c.id} status={c.status} /> : "—"}</td>
                </tr>
              ))}
              {creators.length === 0 && (
                <tr>
                  <td colSpan={12} className="muted">
                    Belum ada kreator terdaftar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canAddProspect && (
        <div className="card">
          <h2>Daftarkan Prospek Baru</h2>
          <AddCreatorForm />
        </div>
      )}
    </>
  );
}
