import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { addDays, parseYMD } from "@/lib/mcn/weeks";
import { slotIndicators, type SlotForIndicators } from "@/lib/mcn/indicators";
import {
  AddSlotForm,
  SlotFieldToggle,
  SlotStatusControls,
  DeleteSlotButton,
  VerifySlotForm,
  CopyWeekForm,
  RosterToggleButton,
} from "./forms";

type Creator = { id: string; name: string; code: string | null; owner_cpm_id: string | null };
type Slot = {
  id: string;
  mcn_creator_id: string;
  schedule_date: string;
  start_time: string | null;
  end_time: string | null;
  status: "scheduled" | "tentative" | "off" | "done";
  brand_name: string | null;
  pk_ready: boolean | null;
  product_connected_tap: boolean | null;
  actual_start: string | null;
  actual_end: string | null;
};

const DAY_NAMES = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export default async function McnSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
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
  const canView = mgmt || div === "CreatorManagement" || div === "BizDev";
  if (!canView) redirect("/dashboard");

  // "Hari ini" — new Date() (tanpa argumen) diperbolehkan; format manual ke
  // YYYY-MM-DD pakai komponen lokal (bukan new Date(iso)).
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const dow = now.getDay(); // 0=Minggu..6=Sabtu
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const defaultMonday = addDays(todayStr, diffToMonday);

  const sp = await searchParams;
  const weekParam = sp.week;
  let monday = defaultMonday;
  if (weekParam && parseYMD(weekParam)) monday = weekParam;
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sunday = weekDates[6];
  const prevWeek = addDays(monday, -7);
  const nextWeek = addDays(monday, 7);

  const canManage = (c: Creator) =>
    mgmt || div === "BizDev" || (div === "CreatorManagement" && (me?.rank === "lead" || c.owner_cpm_id === me?.id));

  const { data: rosterRaw } = await supabase
    .from("mcn_creators")
    .select("id, name, code, owner_cpm_id")
    .eq("live_roster", true)
    .order("name", { ascending: true });
  const roster = (rosterRaw as Creator[] | null) ?? [];
  const rosterIds = roster.map((c) => c.id);

  const slotsByCell = new Map<string, Slot[]>();
  if (rosterIds.length > 0) {
    const { data: slotsRaw } = await supabase
      .from("live_schedule_slots")
      .select(
        "id, mcn_creator_id, schedule_date, start_time, end_time, status, brand_name, pk_ready, product_connected_tap, actual_start, actual_end"
      )
      .in("mcn_creator_id", rosterIds)
      .gte("schedule_date", monday)
      .lte("schedule_date", sunday)
      .order("start_time", { ascending: true });
    for (const s of (slotsRaw as Slot[] | null) ?? []) {
      const key = `${s.mcn_creator_id}|${s.schedule_date}`;
      const arr = slotsByCell.get(key) ?? [];
      arr.push(s);
      slotsByCell.set(key, arr);
    }
  }

  // Panel verifikasi: slot scheduled/tentative dengan tanggal <= hari ini (lintas minggu).
  let verifyQuery = supabase
    .from("live_schedule_slots")
    .select(
      "id, mcn_creator_id, schedule_date, start_time, end_time, status, brand_name, pk_ready, product_connected_tap, actual_start, actual_end"
    )
    .in("status", ["scheduled", "tentative"])
    .lte("schedule_date", todayStr)
    .order("schedule_date", { ascending: true });
  if (rosterIds.length > 0) verifyQuery = verifyQuery.in("mcn_creator_id", rosterIds);
  const { data: pendingRaw } = await verifyQuery;
  const pendingSlots = (pendingRaw as Slot[] | null) ?? [];
  const todaySlots = pendingSlots.filter((s) => s.schedule_date === todayStr);
  const overdueSlots = pendingSlots.filter((s) => s.schedule_date < todayStr);

  const creatorName = new Map(roster.map((c) => [c.id, `${c.code ?? "(draft)"} · ${c.name}`]));

  const { data: offRosterRaw } = await supabase
    .from("mcn_creators")
    .select("id, name, code, owner_cpm_id")
    .eq("live_roster", false)
    .order("name", { ascending: true })
    .limit(50);
  const offRoster = (offRosterRaw as Creator[] | null) ?? [];

  return (
    <>
      <h1>Jadwal Live</h1>
      <p className="page-sub">
        Matriks kreator roster × 7 hari (Senin-mulai). Multi-slot per hari diizinkan. Slot{" "}
        <span className="badge slate">done</span> terkunci.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <Link className="btn-ghost sm" href={`/meago/schedule?week=${prevWeek}`}>
          ← {prevWeek}
        </Link>
        <strong>
          {monday} s/d {sunday}
        </strong>
        <Link className="btn-ghost sm" href={`/meago/schedule?week=${nextWeek}`}>
          {nextWeek} →
        </Link>
        {monday !== defaultMonday && (
          <Link className="sm" href={`/meago/schedule?week=${defaultMonday}`}>
            Ke minggu ini ({defaultMonday})
          </Link>
        )}
      </div>

      <div className="card">
        <h2>Verifikasi Hari Ini ({todaySlots.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Kreator</th>
              <th>Tanggal</th>
              <th>Jam</th>
              <th>Merchant</th>
              <th>Verifikasi</th>
            </tr>
          </thead>
          <tbody>
            {todaySlots.map((s) => (
              <tr key={s.id}>
                <td>{creatorName.get(s.mcn_creator_id) ?? "—"}</td>
                <td className="muted">{s.schedule_date}</td>
                <td className="muted">
                  {s.start_time ?? "—"}
                  {s.end_time ? `–${s.end_time}` : ""}
                </td>
                <td className="muted">{s.brand_name ?? "—"}</td>
                <td>
                  <VerifySlotForm slotId={s.id} />
                </td>
              </tr>
            ))}
            {todaySlots.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Tidak ada slot untuk diverifikasi hari ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Terlewat ({overdueSlots.length})</h2>
        <table>
          <thead>
            <tr>
              <th>Kreator</th>
              <th>Tanggal</th>
              <th>Jam</th>
              <th>Merchant</th>
              <th>Verifikasi</th>
            </tr>
          </thead>
          <tbody>
            {overdueSlots.map((s) => (
              <tr key={s.id}>
                <td>{creatorName.get(s.mcn_creator_id) ?? "—"}</td>
                <td className="muted">{s.schedule_date}</td>
                <td className="muted">
                  {s.start_time ?? "—"}
                  {s.end_time ? `–${s.end_time}` : ""}
                </td>
                <td className="muted">{s.brand_name ?? "—"}</td>
                <td>
                  <VerifySlotForm slotId={s.id} />
                </td>
              </tr>
            ))}
            {overdueSlots.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Tidak ada slot terlewat.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Matriks Jadwal</h2>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Kreator</th>
                {weekDates.map((d, i) => (
                  <th key={d}>
                    {DAY_NAMES[i]}
                    <div className="muted" style={{ fontWeight: 400, fontSize: 10 }}>
                      {d}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((c) => {
                const manage = canManage(c);
                return (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    {weekDates.map((d) => {
                      const cell = slotsByCell.get(`${c.id}|${d}`) ?? [];
                      return (
                        <td key={d} style={{ minWidth: 150, verticalAlign: "top" }}>
                          {cell.map((s) => {
                            const flags = slotIndicators(
                              {
                                status: s.status,
                                schedule_date: s.schedule_date,
                                pk_ready: !!s.pk_ready,
                                product_connected_tap: !!s.product_connected_tap,
                              } as SlotForIndicators,
                              todayStr
                            );
                            const locked = s.status === "done";
                            return (
                              <div
                                key={s.id}
                                className="subcard"
                                style={{
                                  marginBottom: 6,
                                  padding: 8,
                                  border: flags.needsVerification
                                    ? "2px solid var(--danger)"
                                    : undefined,
                                }}
                              >
                                <div style={{ fontSize: 12, fontWeight: 600 }}>
                                  {s.start_time ?? "—"}
                                  {s.end_time ? `–${s.end_time}` : ""}
                                </div>
                                <div className="muted" style={{ fontSize: 11 }}>
                                  {s.brand_name ?? "(tanpa merchant)"}
                                </div>
                                <div style={{ marginTop: 4 }}>
                                  <span
                                    className={`badge ${
                                      s.status === "done"
                                        ? "green"
                                        : s.status === "off"
                                          ? "gray"
                                          : s.status === "tentative"
                                            ? "amber"
                                            : "blue"
                                    }`}
                                  >
                                    {s.status}
                                  </span>
                                  {flags.pkMissing && <span className="badge red">PK✘</span>}
                                  {flags.tapMissing && <span className="badge red">TAP✘</span>}
                                </div>
                                {manage && !locked && (
                                  <div style={{ marginTop: 6 }}>
                                    <div className="actions-row">
                                      <SlotFieldToggle
                                        slotId={s.id}
                                        field="pk_ready"
                                        current={!!s.pk_ready}
                                        label="PK"
                                      />
                                      <SlotFieldToggle
                                        slotId={s.id}
                                        field="product_connected_tap"
                                        current={!!s.product_connected_tap}
                                        label="TAP"
                                      />
                                    </div>
                                    <SlotStatusControls slotId={s.id} status={s.status} />
                                    <div style={{ marginTop: 4 }}>
                                      <DeleteSlotButton slotId={s.id} />
                                    </div>
                                  </div>
                                )}
                                {locked && <div className="muted" style={{ fontSize: 11 }}>terkunci (done)</div>}
                              </div>
                            );
                          })}
                          {manage && <AddSlotForm creatorId={c.id} date={d} />}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {roster.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    Belum ada kreator di roster live. Tambahkan dari daftar di bawah.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Copy Week</h2>
        <p className="section-sub">
          Menyalin slot minggu ini ({monday}) ke minggu target dengan offset hari sama. Slot OFF
          dilewati; state (status/PK/TAP/verifikasi) direset.
        </p>
        <CopyWeekForm sourceMonday={monday} />
      </div>

      <div className="card">
        <h2>Kreator Belum di Roster</h2>
        <table>
          <thead>
            <tr>
              <th>Kreator</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {offRoster.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.code ?? "—"} · {c.name}
                </td>
                <td>
                  {canManage(c) ? (
                    <RosterToggleButton creatorId={c.id} liveRoster={false} label="Masukkan ke roster" />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
            {offRoster.length === 0 && (
              <tr>
                <td colSpan={2} className="muted">
                  Semua kreator sudah di roster.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
