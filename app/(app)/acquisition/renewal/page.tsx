import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { tanggal } from "@/lib/format";
import { renewalBadge, todayJakartaYMD, RENEWAL_SOON_DAYS } from "@/lib/mcn/project-status";
import { FollowupModal, statusBadgeClass, statusLabel, type FollowupItem } from "./forms";

type AcqRow = {
  id: string;
  code: string | null;
  mcn_creator_id: string;
  binding_date: string;
  binding_end_date: string | null;
  kreator_kontrak: string | null;
};

type FollowupRow = FollowupItem & { acquisition_id: string };

export default async function RenewalFollowupPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || div === "Acquisition" || div === "CreatorManagement";
  if (!canView) redirect("/dashboard");
  const canWrite = mgmt || div === "Acquisition";

  const supabase = await getCachedClient();
  const today = todayJakartaYMD();

  // Sumber data = tabel acquisitions (binding). Hanya baris yang PUNYA tanggal
  // binding berakhir yang relevan untuk follow up perpanjangan. Urut paling dekat
  // berakhir dulu.
  const { data: acqRaw } = await supabase
    .from("acquisitions")
    .select("id, code, mcn_creator_id, binding_date, binding_end_date, kreator_kontrak")
    .not("binding_end_date", "is", null)
    .order("binding_end_date", { ascending: true });
  const acquisitions = (acqRaw as AcqRow[] | null) ?? [];

  // Resolusi nama kreator: ambil eksplisit berdasarkan id yang direferensikan
  // (bukan list penuh yang ter-cap 1000 baris) — pola sama dengan Daftar Akuisisi.
  const creatorIds = Array.from(new Set(acquisitions.map((a) => a.mcn_creator_id)));
  const creatorMap = new Map<string, { code: string | null; name: string }>();
  if (creatorIds.length > 0) {
    const { data: creatorsRaw } = await supabase
      .from("mcn_creators")
      .select("id, name, code")
      .in("id", creatorIds);
    for (const c of ((creatorsRaw as { id: string; name: string; code: string | null }[] | null) ?? [])) {
      creatorMap.set(c.id, { code: c.code, name: c.name });
    }
  }

  // Riwayat follow up per akuisisi (append-only, terbaru dulu).
  const acqIds = acquisitions.map((a) => a.id);
  const followupMap = new Map<string, FollowupItem[]>();
  if (acqIds.length > 0) {
    const { data: fuRaw } = await supabase
      .from("acquisition_followups")
      .select("id, acquisition_id, followup_date, status, note, created_at")
      .in("acquisition_id", acqIds)
      .order("followup_date", { ascending: false })
      .order("created_at", { ascending: false });
    for (const f of ((fuRaw as FollowupRow[] | null) ?? [])) {
      const arr = followupMap.get(f.acquisition_id) ?? [];
      arr.push({
        id: f.id,
        followup_date: f.followup_date,
        status: f.status,
        note: f.note,
        created_at: f.created_at,
      });
      followupMap.set(f.acquisition_id, arr);
    }
  }

  const creatorName = (id: string) => {
    const c = creatorMap.get(id);
    return c ? `${c.code ?? "—"} · ${c.name}` : "—";
  };

  // Summary: kreator yang kontraknya akan habis dalam <30 hari (belum lewat).
  const soon = acquisitions.filter((a) => {
    const b = renewalBadge(a.binding_end_date, today);
    return b !== null && b.daysLeft >= 0 && b.daysLeft < RENEWAL_SOON_DAYS;
  });
  const soonFollowedUp = soon.filter((a) => (followupMap.get(a.id)?.length ?? 0) > 0).length;
  const soonPending = soon.length - soonFollowedUp;
  const overdue = acquisitions.filter((a) => {
    const b = renewalBadge(a.binding_end_date, today);
    return b !== null && b.daysLeft < 0;
  }).length;

  return (
    <>
      <h1>Follow Up Perpanjangan Kreator</h1>
      <p className="page-sub">
        Kreator dengan kontrak/binding yang mendekati berakhir (sumber: Daftar Akuisisi). Catat
        follow up perpanjangan dan pantau yang akan habis dalam {RENEWAL_SOON_DAYS} hari ke depan.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Akan Habis &lt; {RENEWAL_SOON_DAYS} Hari</div>
          <div className="v">{soon.length}</div>
        </div>
        <div className="stat">
          <div className="k">Sudah Di-follow Up</div>
          <div className="v">{soonFollowedUp}</div>
        </div>
        <div className="stat">
          <div className="k">Belum Di-follow Up</div>
          <div className="v">{soonPending}</div>
        </div>
        <div className="stat">
          <div className="k">Sudah Lewat</div>
          <div className="v">{overdue}</div>
        </div>
      </div>

      <div className="card">
        <h2>Daftar Kreator ({acquisitions.length})</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Kreator</th>
                <th>Kontrak</th>
                <th>Binding Mulai</th>
                <th>Binding Berakhir</th>
                <th>Status</th>
                <th>Follow Up Terakhir</th>
                {canWrite && <th>Aksi</th>}
              </tr>
            </thead>
            <tbody>
              {acquisitions.map((a) => {
                const badge = renewalBadge(a.binding_end_date, today);
                const history = followupMap.get(a.id) ?? [];
                const last = history[0];
                return (
                  <tr key={a.id}>
                    <td className="mono">{a.code ?? "—"}</td>
                    <td>{creatorName(a.mcn_creator_id)}</td>
                    <td className="muted">{a.kreator_kontrak ?? "—"}</td>
                    <td className="muted">{tanggal(a.binding_date)}</td>
                    <td className="muted">{tanggal(a.binding_end_date)}</td>
                    <td>
                      {badge ? <span className={`badge ${badge.cls}`}>{badge.label}</span> : "—"}
                    </td>
                    <td>
                      {last ? (
                        <span className={`badge ${statusBadgeClass(last.status)}`}>
                          {statusLabel(last.status)}
                        </span>
                      ) : (
                        <span className="muted">belum ada</span>
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        <FollowupModal
                          acquisitionId={a.id}
                          creatorLabel={creatorName(a.mcn_creator_id)}
                          bindingEndLabel={tanggal(a.binding_end_date)}
                          history={history}
                          today={today}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
              {acquisitions.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 8 : 7} className="muted">
                    Belum ada kreator dengan tanggal binding berakhir. Isi "Tanggal Binding Berakhir"
                    saat mencatat akuisisi agar muncul di sini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
