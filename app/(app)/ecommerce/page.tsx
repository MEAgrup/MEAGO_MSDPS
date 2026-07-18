import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { durasi, tanggal } from "@/lib/format";
import { PickupBriefButton, CreateUnitForm, SkuStatusForm, ChecklistForm } from "./forms";

type Brief = {
  id: string;
  code: string | null;
  service_id: string;
  deliverable_type: string;
  quantity_target: number | null;
  due_date: string;
  priority: string;
  status: string;
  completion_pct: number;
  assigned_pic: string | null;
  optimization_scope: string[] | null;
  custom_scope_item: string | null;
  work_time_seconds: number;
  timer_started_at: string | null;
};
type Unit = {
  id: string;
  code: string | null;
  brief_id: string;
  product_ref: string;
  scope_checklist: string[];
  checklist_done: string[];
  status: string;
  revision_count: number;
  revision_notes: string | null;
};

// Waktu kerja brief: akumulasi + segmen berjalan (snapshot saat render).
function waktuKerja(b: Brief): string {
  let sec = Number(b.work_time_seconds);
  if (b.timer_started_at) {
    sec += Math.max(0, (Date.now() - new Date(b.timer_started_at).getTime()) / 1000);
  }
  return durasi(sec);
}

export default async function EcommercePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const mgmt = !!(me?.is_od || me?.is_director);
  if (!(me?.division === "Ecommerce" || me?.division === "Account" || mgmt)) redirect("/dashboard");
  const isEcomStaff = me?.division === "Ecommerce" || mgmt;
  const isAm = me?.division === "Account" || mgmt;

  const supabase = await getCachedClient();
  const [{ data: briefs }, { data: units }] = await Promise.all([
    supabase
      .from("briefs")
      .select(
        "id, code, service_id, deliverable_type, quantity_target, due_date, priority, status, completion_pct, assigned_pic, optimization_scope, custom_scope_item, work_time_seconds, timer_started_at"
      )
      .eq("assigned_division", "Ecommerce")
      .order("created_at", { ascending: false }),
    supabase
      .from("sku_work_units")
      .select(
        "id, code, brief_id, product_ref, scope_checklist, checklist_done, status, revision_count, revision_notes"
      )
      .order("code"),
  ]);

  const bList = (briefs as Brief[] | null) ?? [];
  const uList = (units as Unit[] | null) ?? [];
  const queue = bList.filter((b) => b.status === "[To Do]");
  const active = bList.filter((b) => ["[In Progress]", "[Overdue]"].includes(b.status));
  const done = bList.filter((b) => b.status === "[Completed]");

  return (
    <>
      <h1>E-commerce / SKU Optimization</h1>
      <p className="page-sub">
        Brief meledak jadi SKU Work Unit (1 unit = 1 produk nyata). Timer berjalan OTOMATIS begitu
        brief di-pick-up dan berhenti saat pekerjaan selesai/disubmit. Setelah submit, review dan
        approval dilakukan team Account (AM).
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Queue</div>
          <div className="v">{queue.length}</div>
        </div>
        <div className="stat">
          <div className="k">Brief Aktif</div>
          <div className="v">{active.length}</div>
        </div>
        <div className="stat">
          <div className="k">Unit Menunggu Review AM</div>
          <div className="v">
            {
              uList.filter((u) =>
                ["[Submitted for Review]", "[In Review - AM]"].includes(u.status)
              ).length
            }
          </div>
        </div>
        <div className="stat">
          <div className="k">Brief Selesai</div>
          <div className="v">{done.length}</div>
        </div>
      </div>

      <div className="card">
        <h2>E-commerce Brief Queue</h2>
        <p className="section-sub">
          Pick-up brief langsung menyalakan timer kerja otomatis — tidak ada tombol timer.
        </p>
        <table>
          <thead>
            <tr>
              <th>Brief</th>
              <th>Deliverable</th>
              <th>Target SKU</th>
              <th>SLA</th>
              <th>Prioritas</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((b) => (
              <tr key={b.id}>
                <td className="mono">{b.code ?? "—"}</td>
                <td>{b.deliverable_type}</td>
                <td>{b.quantity_target}</td>
                <td>{tanggal(b.due_date)}</td>
                <td>{b.priority}</td>
                <td>{isEcomStaff && <PickupBriefButton briefId={b.id} />}</td>
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Queue kosong.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {active.map((b) => {
        const bu = uList.filter((u) => u.brief_id === b.id);
        const nonCancelled = bu.filter((u) => u.status !== "[Cancelled]").length;
        return (
          <div className="card" key={b.id}>
            <h2>
              <span className="mono">{b.code ?? "—"}</span> · {b.deliverable_type}{" "}
              <span className="badge slate">{b.status}</span>
              <span className={`badge ${b.timer_started_at ? "green" : "gray"}`}>
                ⏱ {waktuKerja(b)}
                {b.timer_started_at ? " · berjalan" : ""}
              </span>
            </h2>
            <p className="section-sub">
              Target {b.quantity_target} SKU · Scope: {(b.optimization_scope ?? []).join(", ")}
              {b.custom_scope_item ? ` + ${b.custom_scope_item}` : ""} · SLA {tanggal(b.due_date)} ·
              Completion <strong>{Number(b.completion_pct).toFixed(0)}%</strong> ({nonCancelled}/
              {b.quantity_target} unit dibuat)
            </p>

            {bu.map((u) => (
              <div className="subcard" key={u.id} style={{ marginBottom: 10 }}>
                <h3>
                  <span className="mono">{u.code}</span> · {u.product_ref}{" "}
                  <span className="badge slate">{u.status}</span>
                  {u.revision_count > 0 && (
                    <span className={`badge ${u.revision_count >= 3 ? "red" : "amber"}`}>
                      revisi {u.revision_count}
                    </span>
                  )}
                </h3>
                {u.revision_notes &&
                  ["[Revision Requested]", "[In Progress]"].includes(u.status) && (
                    <p className="muted">Catatan revisi (AM): {u.revision_notes}</p>
                  )}

                <div className="inline-actions">
                  {isEcomStaff && u.status === "[To Do]" && (
                    <SkuStatusForm unitId={u.id} toStatus="[In Progress]" label="Mulai kerjakan" />
                  )}
                  {isEcomStaff && u.status === "[Revision Requested]" && (
                    <SkuStatusForm unitId={u.id} toStatus="[In Progress]" label="Kerjakan revisi" />
                  )}
                  {isEcomStaff && u.status === "[In Progress]" && (
                    <>
                      <ChecklistForm
                        unitId={u.id}
                        scope={u.scope_checklist}
                        done={u.checklist_done}
                      />
                      <SkuStatusForm
                        unitId={u.id}
                        toStatus="[Submitted for Review]"
                        label="Submit ke Account"
                      />
                    </>
                  )}
                  {isAm && u.status === "[Submitted for Review]" && (
                    <SkuStatusForm
                      unitId={u.id}
                      toStatus="[In Review - AM]"
                      label="Ambil review (Account)"
                    />
                  )}
                  {isAm && u.status === "[In Review - AM]" && (
                    <>
                      <SkuStatusForm unitId={u.id} toStatus="[Approved]" label="Approve (Account)" />
                      <SkuStatusForm
                        unitId={u.id}
                        toStatus="[Revision Requested]"
                        label="Minta revisi"
                        notesField="revision_notes"
                      />
                    </>
                  )}
                  {isAm &&
                    !["[Approved]", "[Cancelled]"].includes(u.status) && (
                      <SkuStatusForm
                        unitId={u.id}
                        toStatus="[Cancelled]"
                        label="Cancel (SKU delisted)"
                        notesField="cancellation_reason"
                        notesPlaceholder="Alasan (wajib)"
                        danger
                      />
                    )}
                </div>
              </div>
            ))}

            {isEcomStaff && nonCancelled < Number(b.quantity_target ?? 0) && (
              <CreateUnitForm briefId={b.id} />
            )}
            {nonCancelled >= Number(b.quantity_target ?? 0) && (
              <p className="muted">
                Jumlah unit sudah mencapai Target SKU Count — penambahan butuh approval SPV di Brief.
              </p>
            )}
          </div>
        );
      })}

      {done.length > 0 && (
        <div className="card">
          <h2>Brief Selesai</h2>
          <table>
            <thead>
              <tr>
                <th>Brief</th>
                <th>Deliverable</th>
                <th className="right">Waktu Kerja</th>
                <th className="right">Completion</th>
              </tr>
            </thead>
            <tbody>
              {done.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.code}</td>
                  <td>{b.deliverable_type}</td>
                  <td className="right">⏱ {durasi(b.work_time_seconds)}</td>
                  <td className="right">
                    <span className="badge green">{Number(b.completion_pct).toFixed(0)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
