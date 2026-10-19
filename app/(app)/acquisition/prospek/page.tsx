import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { ProspectList, type Prospect, type LinkedCreator } from "./prospect-list";

// Prospek Kreator (migrasi 0371): pendaftar meago.id & sumber lain SEBELUM
// binding. Bukan akun — akses portal hanya untuk yang [Bound] (migrasi 0372).
export default async function ProspekKreatorPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || div === "Acquisition" || div === "CreatorManagement";
  if (!canView) redirect("/dashboard");
  const canWrite = mgmt || div === "Acquisition";
  const canAssignAny = mgmt || (div === "Acquisition" && me?.rank === "lead");

  const supabase = await getCachedClient();
  const [{ data: rows }, { data: emps }] = await Promise.all([
    supabase
      .from("creator_prospects")
      .select(
        "id, code, nama, tiktok_username, email, phone_normalized, followers_range, niche, kota, " +
          "tiktok_go_status, binding_lain, usia_18, source, cta_id, attribution, status, owner_id, " +
          "matched_mcn_creator_id, existing_bound, rejected_reason, rejected_note, acquisition_id, created_at"
      )
      .order("created_at", { ascending: false }),
    supabase.from("employees").select("id, full_name, division, active"),
  ]);

  const prospects = (rows as Prospect[] | null) ?? [];
  const matchedIds = [...new Set(prospects.map((p) => p.matched_mcn_creator_id).filter((v): v is string => !!v))];
  const { data: creatorsRaw } = matchedIds.length
    ? await supabase
        .from("mcn_creators")
        .select("id, code, name, binding_status, auth_user_id")
        .in("id", matchedIds)
    : { data: [] };
  const creators: Record<string, LinkedCreator> = Object.fromEntries(
    ((creatorsRaw as (LinkedCreator & { id: string })[] | null) ?? []).map((c) => [c.id, c])
  );

  const empName: Record<string, string> = Object.fromEntries((emps ?? []).map((e) => [e.id, e.full_name]));
  const acqOptions = (emps ?? [])
    .filter((e) => e.division === "Acquisition" && e.active !== false)
    .map((e) => ({ id: e.id as string, full_name: e.full_name as string }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const count = (s: string) => prospects.filter((p) => p.status === s).length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Prospek Kreator</h1>
          <p className="page-sub">
            Pendaftar dari meago.id (dan sumber lain) sebelum binding. Prospek bukan akun — akses
            Creator Portal hanya untuk yang sudah Bound agency MEAGO!.{" "}
            <Link href="/acquisition">← Akuisisi Kreator</Link>
          </p>
        </div>
      </div>

      <div className="stats">
        {["[Baru]", "[Dihubungi]", "[Proses Binding]", "[Bound]", "[Tidak Respon]", "[Ditolak]"].map((s) => (
          <div className="stat" key={s}>
            <div className="k">{s.replace(/[[\]]/g, "")}</div>
            <div className="v">{count(s)}</div>
          </div>
        ))}
      </div>

      <ProspectList
        prospects={prospects}
        creators={creators}
        empName={empName}
        acqOptions={acqOptions}
        myId={me?.id ?? ""}
        canWrite={canWrite}
        canAssignAny={canAssignAny}
      />
    </>
  );
}
