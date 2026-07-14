import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { durasi, num, rupiah, tanggal } from "@/lib/format";
import {
  PickupBriefButton,
  CreateCreatorForm,
  UpdatePaymentForm,
  CreateBookingForm,
  BookingStatusForm,
  BookingGmvForm,
  CreatePayoutForm,
} from "./forms";

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
  work_time_seconds: number;
  timer_started_at: string | null;
};

// Waktu kerja brief: akumulasi + segmen berjalan (snapshot saat render).
function waktuKerja(b: Brief): string {
  let sec = Number(b.work_time_seconds);
  if (b.timer_started_at) {
    sec += Math.max(0, (Date.now() - new Date(b.timer_started_at).getTime()) / 1000);
  }
  return durasi(sec);
}

type Creator = {
  id: string;
  code: string | null;
  name_handle: string;
  platforms: string[];
  niche: string;
  source_pool: string;
  payment_details: string | null;
  total_videos_delivered: number;
  total_live_hours: number;
  total_gmv: number;
};
type Booking = {
  id: string;
  code: string | null;
  brief_id: string;
  creator_id: string;
  deliverable_type: string;
  agreed_rate: number;
  hours_logged: number | null;
  status: string;
  due_date: string;
  delivery_proof: string | null;
  gmv_generated: number | null;
  payout_id: string | null;
};

const BKG_BADGE: Record<string, string> = {
  "[Sourcing/Negotiation]": "slate",
  "[Booked]": "amber",
  "[In Production]": "amber",
  "[Delivered]": "green",
  "[Cancelled]": "red",
};

export default async function KolPage() {
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
  const mgmt = !!(me?.is_od || me?.is_director);
  if (!(me?.division === "KOL" || me?.division === "Account" || mgmt)) redirect("/dashboard");
  const isKol = me?.division === "KOL" || mgmt;

  const [{ data: briefs }, { data: creators }, { data: bookings }] = await Promise.all([
    supabase
      .from("briefs")
      .select(
        "id, code, service_id, deliverable_type, quantity_target, due_date, priority, status, completion_pct, work_time_seconds, timer_started_at"
      )
      .eq("assigned_division", "KOL")
      .order("created_at", { ascending: false }),
    supabase
      .from("creators")
      .select(
        "id, code, name_handle, platforms, niche, source_pool, payment_details, total_videos_delivered, total_live_hours, total_gmv"
      )
      .order("code"),
    supabase
      .from("creator_bookings")
      .select(
        "id, code, brief_id, creator_id, deliverable_type, agreed_rate, hours_logged, status, due_date, delivery_proof, gmv_generated, payout_id"
      )
      .order("code"),
  ]);

  const bList = (briefs as Brief[] | null) ?? [];
  const cList = (creators as Creator[] | null) ?? [];
  const kList = (bookings as Booking[] | null) ?? [];

  // Service type menentukan tipe deliverable booking (KOL-Video vs KOL-Live).
  const serviceIds = [...new Set(bList.map((b) => b.service_id))];
  const { data: services } = serviceIds.length
    ? await supabase.from("services").select("id, service_type").in("id", serviceIds)
    : { data: [] as { id: string; service_type: string }[] };
  const svcType = new Map((services ?? []).map((s) => [s.id, s.service_type]));

  const cMap = new Map(cList.map((c) => [c.id, c]));
  const queue = bList.filter((b) => b.status === "[To Do]");
  const active = bList.filter((b) => ["[In Progress]", "[Overdue]"].includes(b.status));
  const done = bList.filter((b) => b.status === "[Completed]");

  // Akumulator milestone payout per creator (lintas merchant, belum dibayar).
  const unpaidVideos = new Map<string, number>();
  const unpaidHours = new Map<string, number>();
  for (const k of kList) {
    if (k.status !== "[Delivered]" || k.payout_id) continue;
    if (k.deliverable_type === "Video") {
      unpaidVideos.set(k.creator_id, (unpaidVideos.get(k.creator_id) ?? 0) + 1);
    } else {
      unpaidHours.set(k.creator_id, (unpaidHours.get(k.creator_id) ?? 0) + Number(k.hours_logged ?? 0));
    }
  }

  return (
    <>
      <h1>KOL / Creator Management</h1>
      <p className="page-sub">
        Creator Master reusable lintas merchant. Booking = unit atomik (1 video / 1 sesi live),
        berhenti di Delivered — tanpa revision cycle. Payout milestone: PYO-Video per 10 video,
        PYO-Live per 5 jam, akumulasi lintas merchant.
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
          <div className="k">Creator Terdaftar</div>
          <div className="v">{cList.length}</div>
        </div>
        <div className="stat">
          <div className="k">Booking Berjalan</div>
          <div className="v">
            {kList.filter((k) => ["[Booked]", "[In Production]"].includes(k.status)).length}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>KOL Brief Queue</h2>
        <table>
          <thead>
            <tr>
              <th>Brief</th>
              <th>Deliverable</th>
              <th>Target</th>
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
                <td>
                  {num(b.quantity_target)}{" "}
                  {svcType.get(b.service_id) === "KOL-Live" ? "jam live" : "video"}
                </td>
                <td>{tanggal(b.due_date)}</td>
                <td>{b.priority}</td>
                <td>{isKol && <PickupBriefButton briefId={b.id} />}</td>
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
        const bk = kList.filter((k) => k.brief_id === b.id);
        const isLive = svcType.get(b.service_id) === "KOL-Live";
        const nonCancelled = bk.filter((k) => k.status !== "[Cancelled]").length;
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
              Target {num(b.quantity_target)} {isLive ? "jam live" : "video"} · SLA{" "}
              {tanggal(b.due_date)} · Completion{" "}
              <strong>{Number(b.completion_pct).toFixed(0)}%</strong>
            </p>

            {bk.map((k) => {
              const c = cMap.get(k.creator_id);
              return (
                <div className="subcard" key={k.id} style={{ marginBottom: 10 }}>
                  <h3>
                    <span className="mono">{k.code}</span> · {c?.name_handle ?? "—"} ·{" "}
                    {k.deliverable_type}{" "}
                    <span className={`badge ${BKG_BADGE[k.status] ?? "gray"}`}>{k.status}</span>
                    <span className="badge gray">{rupiah(k.agreed_rate)}</span>
                    {k.hours_logged != null && k.deliverable_type === "Live Session" && (
                      <span className="badge gray">{num(k.hours_logged)} jam</span>
                    )}
                    {k.payout_id && <span className="badge green">sudah masuk PYO</span>}
                  </h3>
                  <p className="muted">
                    Due {tanggal(k.due_date)}
                    {k.delivery_proof ? ` · Bukti: ${k.delivery_proof}` : ""}
                    {k.gmv_generated != null ? ` · GMV: ${rupiah(k.gmv_generated)}` : ""}
                  </p>

                  {isKol && (
                    <div className="inline-actions">
                      {k.status === "[Sourcing/Negotiation]" && (
                        <BookingStatusForm
                          bookingId={k.id}
                          toStatus="[Booked]"
                          label="Set Booked (deal)"
                        />
                      )}
                      {k.status === "[Booked]" && (
                        <BookingStatusForm
                          bookingId={k.id}
                          toStatus="[In Production]"
                          label="Mulai produksi"
                        />
                      )}
                      {k.status === "[In Production]" && (
                        <BookingStatusForm
                          bookingId={k.id}
                          toStatus="[Delivered]"
                          label="Set Delivered"
                          withProof
                          withHours={k.deliverable_type === "Live Session"}
                        />
                      )}
                      {["[Sourcing/Negotiation]", "[Booked]", "[In Production]"].includes(
                        k.status
                      ) && (
                        <BookingStatusForm
                          bookingId={k.id}
                          toStatus="[Cancelled]"
                          label="Cancel"
                          notesField="cancellation_reason"
                          danger
                        />
                      )}
                      {k.status === "[Delivered]" && (
                        <BookingGmvForm bookingId={k.id} current={k.gmv_generated} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {isKol && (isLive || nonCancelled < Number(b.quantity_target ?? 0)) && (
              <CreateBookingForm
                briefId={b.id}
                deliverableType={isLive ? "Live Session" : "Video"}
                creators={cList}
              />
            )}
            {!isLive && nonCancelled >= Number(b.quantity_target ?? 0) && (
              <p className="muted">
                Jumlah booking sudah mencapai Target Video Count — penambahan butuh approval SPV di
                Brief.
              </p>
            )}
          </div>
        );
      })}

      <div className="card">
        <h2>Creator Master ({cList.length})</h2>
        <table>
          <thead>
            <tr>
              <th>CRT</th>
              <th>Creator</th>
              <th>Niche</th>
              <th>Pool</th>
              <th className="right">Video</th>
              <th className="right">Jam Live</th>
              <th className="right">GMV Lifetime</th>
              <th>Milestone Payout</th>
            </tr>
          </thead>
          <tbody>
            {cList.map((c) => {
              const uv = unpaidVideos.get(c.id) ?? 0;
              const uh = unpaidHours.get(c.id) ?? 0;
              return (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td>
                    {c.name_handle}
                    <div className="muted">{c.platforms.join(", ")}</div>
                    {!c.payment_details && isKol && <UpdatePaymentForm creatorId={c.id} />}
                    {!c.payment_details && (
                      <span className="badge amber">payment details kosong</span>
                    )}
                  </td>
                  <td>{c.niche}</td>
                  <td className="muted">{c.source_pool}</td>
                  <td className="right">{c.total_videos_delivered}</td>
                  <td className="right">{num(c.total_live_hours)}</td>
                  <td className="right">{rupiah(c.total_gmv)}</td>
                  <td>
                    <div className="muted">
                      belum dibayar: {uv} video · {num(uh)} jam
                    </div>
                    {isKol && uv >= 10 && <CreatePayoutForm creatorId={c.id} payoutType="PYO-Video" />}
                    {isKol && uh >= 5 && <CreatePayoutForm creatorId={c.id} payoutType="PYO-Live" />}
                  </td>
                </tr>
              );
            })}
            {cList.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  Belum ada creator.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {isKol && (
          <div style={{ marginTop: 10 }}>
            <CreateCreatorForm />
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div className="card">
          <h2>Brief Selesai</h2>
          <table>
            <thead>
              <tr>
                <th>Brief</th>
                <th>Deliverable</th>
                <th className="right">Completion</th>
              </tr>
            </thead>
            <tbody>
              {done.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.code}</td>
                  <td>{b.deliverable_type}</td>
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
