import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { durasi, num, tanggal } from "@/lib/format";
import { PickupBriefButton, CreateAdcForm, AdcStatusForm, CreateWpeForm } from "./forms";

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
  platforms: string[] | null;
  budget_total_idr: number | null;
  budget_total_usd: number | null;
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
type Adc = {
  id: string;
  code: string | null;
  brief_id: string;
  platform: string;
  objective: string;
  currency: string;
  budget_allocated: number | null;
  creative_ref: string | null;
  go_live_date: string | null;
  end_date: string | null;
  status: string;
  revision_count: number;
  revision_notes: string | null;
  pause_reason: string | null;
};
type Wpe = {
  id: string;
  campaign_record_id: string;
  week_number: number;
  entry_type: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number | null;
  gmv_generated: number | null;
  roas: number | null;
  ctr: number | null;
  notes: string | null;
};

const ADC_BADGE: Record<string, string> = {
  "[Setup In Progress]": "slate",
  "[Pending Go-Live Approval]": "amber",
  "[Live]": "green",
  "[Optimizing]": "green",
  "[Revision Requested]": "amber",
  "[Paused]": "gray",
  "[Completed]": "green",
  "[Cancelled]": "red",
};

function uang(currency: string, n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${currency === "USD" ? "$" : "Rp"} ${num(n)}`;
}

export default async function AdsPage() {
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
  if (!(me?.division === "Ads" || me?.division === "Account" || mgmt)) redirect("/dashboard");
  const isAdsStaff = me?.division === "Ads" || mgmt;
  const isAdsLead = (me?.division === "Ads" && me?.rank === "lead") || mgmt;
  const isAm = me?.division === "Account" || mgmt;

  const [{ data: briefs }, { data: adcs }, { data: wpes }] = await Promise.all([
    supabase
      .from("briefs")
      .select(
        "id, code, service_id, deliverable_type, quantity_target, due_date, priority, status, completion_pct, platforms, budget_total_idr, budget_total_usd, work_time_seconds, timer_started_at"
      )
      .eq("assigned_division", "Ads")
      .order("created_at", { ascending: false }),
    supabase
      .from("ad_campaign_records")
      .select(
        "id, code, brief_id, platform, objective, currency, budget_allocated, creative_ref, go_live_date, end_date, status, revision_count, revision_notes, pause_reason"
      )
      .order("code"),
    supabase
      .from("weekly_performance_entries")
      .select(
        "id, campaign_record_id, week_number, entry_type, spend, impressions, clicks, conversions, gmv_generated, roas, ctr, notes"
      )
      .order("week_number"),
  ]);

  const bList = (briefs as Brief[] | null) ?? [];
  const aList = (adcs as Adc[] | null) ?? [];
  const wList = (wpes as Wpe[] | null) ?? [];
  const queue = bList.filter((b) => b.status === "[To Do]");
  const active = bList.filter((b) => ["[In Progress]", "[Overdue]"].includes(b.status));
  const done = bList.filter((b) => b.status === "[Completed]");
  const liveCount = aList.filter((a) => ["[Live]", "[Optimizing]"].includes(a.status)).length;
  const pendingGoLive = aList.filter((a) => a.status === "[Pending Go-Live Approval]").length;

  return (
    <>
      <h1>Ads / Campaign Management</h1>
      <p className="page-sub">
        Brief Ads meledak jadi Ad Campaign Record (1 record = 1 campaign di 1 platform). Go-live
        approval oleh Ads Lead. WPE mingguan wajib saat Live/Optimizing; Final Report wajib sebelum
        Completed. Budget dual currency, tanpa auto-convert.
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
          <div className="k">Menunggu Go-Live</div>
          <div className="v">{pendingGoLive}</div>
        </div>
        <div className="stat">
          <div className="k">Campaign Live</div>
          <div className="v">{liveCount}</div>
        </div>
      </div>

      <div className="card">
        <h2>Ads Brief Queue</h2>
        <table>
          <thead>
            <tr>
              <th>Brief</th>
              <th>Deliverable</th>
              <th>Target Campaign</th>
              <th>Budget</th>
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
                <td>{num(b.quantity_target)}</td>
                <td>
                  {b.budget_total_idr ? uang("IDR", b.budget_total_idr) : ""}
                  {b.budget_total_idr && b.budget_total_usd ? " + " : ""}
                  {b.budget_total_usd ? uang("USD", b.budget_total_usd) : ""}
                </td>
                <td>{tanggal(b.due_date)}</td>
                <td>{b.priority}</td>
                <td>{isAdsStaff && <PickupBriefButton briefId={b.id} />}</td>
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  Queue kosong.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {active.map((b) => {
        const ba = aList.filter((a) => a.brief_id === b.id);
        const nonCancelled = ba.filter((a) => a.status !== "[Cancelled]").length;
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
              Target {num(b.quantity_target)} campaign · Platform:{" "}
              {(b.platforms ?? []).join(", ") || "—"} · Budget:{" "}
              {b.budget_total_idr ? uang("IDR", b.budget_total_idr) : ""}
              {b.budget_total_idr && b.budget_total_usd ? " + " : ""}
              {b.budget_total_usd ? uang("USD", b.budget_total_usd) : ""}
              {!b.budget_total_idr && !b.budget_total_usd ? "—" : ""} · SLA {tanggal(b.due_date)} ·
              Completion <strong>{Number(b.completion_pct).toFixed(0)}%</strong>
            </p>

            {ba.map((a) => {
              const aw = wList.filter((w) => w.campaign_record_id === a.id);
              const hasFinal = aw.some((w) => w.entry_type === "[Final Report]");
              const nextWeek =
                aw.filter((w) => w.entry_type === "[Weekly]").reduce((mx, w) => Math.max(mx, w.week_number), 0) + 1;
              return (
                <div className="subcard" key={a.id} style={{ marginBottom: 10 }}>
                  <h3>
                    <span className="mono">{a.code}</span> · {a.platform} · {a.objective}{" "}
                    <span className={`badge ${ADC_BADGE[a.status] ?? "gray"}`}>{a.status}</span>
                    {a.revision_count > 0 && (
                      <span className="badge amber">revisi {a.revision_count}</span>
                    )}
                    <span className="badge gray">
                      {uang(a.currency, a.budget_allocated)} ({a.currency})
                    </span>
                    {a.go_live_date && (
                      <span className="badge gray">live sejak {tanggal(a.go_live_date)}</span>
                    )}
                  </h3>
                  {a.creative_ref && <p className="muted">Creative: {a.creative_ref}</p>}
                  {a.revision_notes && a.status === "[Revision Requested]" && (
                    <p className="muted">Catatan revisi (AM): {a.revision_notes}</p>
                  )}
                  {a.pause_reason && a.status === "[Paused]" && (
                    <p className="muted">Alasan pause: {a.pause_reason}</p>
                  )}

                  <div className="inline-actions">
                    {isAdsStaff && a.status === "[Setup In Progress]" && (
                      <AdcStatusForm
                        adcId={a.id}
                        toStatus="[Pending Go-Live Approval]"
                        label="Submit go-live"
                        withBudget
                      />
                    )}
                    {isAdsLead && a.status === "[Pending Go-Live Approval]" && (
                      <>
                        <AdcStatusForm adcId={a.id} toStatus="[Live]" label="Approve go-live (Lead)" />
                        <AdcStatusForm
                          adcId={a.id}
                          toStatus="[Setup In Progress]"
                          label="Kembalikan ke setup"
                        />
                      </>
                    )}
                    {isAdsStaff && a.status === "[Live]" && (
                      <AdcStatusForm adcId={a.id} toStatus="[Optimizing]" label="Mulai optimasi" />
                    )}
                    {isAdsStaff && a.status === "[Optimizing]" && (
                      <AdcStatusForm adcId={a.id} toStatus="[Live]" label="Kembali ke Live" />
                    )}
                    {isAm && ["[Live]", "[Optimizing]"].includes(a.status) && (
                      <>
                        <AdcStatusForm
                          adcId={a.id}
                          toStatus="[Revision Requested]"
                          label="Minta revisi (AM)"
                          notesField="revision_notes"
                        />
                        <AdcStatusForm
                          adcId={a.id}
                          toStatus="[Paused]"
                          label="Pause"
                          notesField="pause_reason"
                          notesPlaceholder="Alasan pause (wajib)"
                        />
                      </>
                    )}
                    {isAdsStaff && a.status === "[Revision Requested]" && (
                      <AdcStatusForm
                        adcId={a.id}
                        toStatus="[Pending Go-Live Approval]"
                        label="Submit ulang go-live"
                        withBudget
                      />
                    )}
                    {a.status === "[Paused]" && (
                      <AdcStatusForm adcId={a.id} toStatus="[Live]" label="Resume (Live)" />
                    )}
                    {isAdsStaff && a.status === "[Live]" && hasFinal && (
                      <AdcStatusForm adcId={a.id} toStatus="[Completed]" label="Set Completed" />
                    )}
                    {isAm &&
                      ["[Setup In Progress]", "[Live]", "[Paused]"].includes(a.status) && (
                        <AdcStatusForm
                          adcId={a.id}
                          toStatus="[Cancelled]"
                          label="Cancel campaign"
                          notesField="cancellation_reason"
                          notesPlaceholder="Alasan (wajib)"
                          danger
                        />
                      )}
                  </div>

                  {aw.length > 0 && (
                    <table style={{ marginTop: 8 }}>
                      <thead>
                        <tr>
                          <th>Minggu</th>
                          <th>Tipe</th>
                          <th className="right">Spend</th>
                          <th className="right">Impr</th>
                          <th className="right">Clicks</th>
                          <th className="right">CTR%</th>
                          <th className="right">Conv</th>
                          <th className="right">GMV</th>
                          <th className="right">ROAS</th>
                          <th>Catatan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aw.map((w) => (
                          <tr key={w.id}>
                            <td>W{w.week_number}</td>
                            <td>
                              {w.entry_type === "[Final Report]" ? (
                                <span className="badge green">Final</span>
                              ) : (
                                "Weekly"
                              )}
                            </td>
                            <td className="right">{uang(a.currency, w.spend)}</td>
                            <td className="right">{num(w.impressions)}</td>
                            <td className="right">{num(w.clicks)}</td>
                            <td className="right">{w.ctr ?? "—"}</td>
                            <td className="right">{num(w.conversions)}</td>
                            <td className="right">{num(w.gmv_generated)}</td>
                            <td className="right">{w.roas ?? "—"}</td>
                            <td className="muted">{w.notes ?? ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                  {isAdsStaff && ["[Live]", "[Optimizing]"].includes(a.status) && (
                    <div style={{ marginTop: 8 }}>
                      <CreateWpeForm adcId={a.id} nextWeek={nextWeek} />
                      {!hasFinal && <CreateWpeForm adcId={a.id} nextWeek={nextWeek} finalReport />}
                    </div>
                  )}
                </div>
              );
            })}

            {isAdsStaff && nonCancelled < Number(b.quantity_target ?? 0) && (
              <CreateAdcForm briefId={b.id} />
            )}
            {nonCancelled >= Number(b.quantity_target ?? 0) && (
              <p className="muted">
                Jumlah campaign sudah mencapai Target Campaign Count — penambahan butuh approval SPV
                di Brief.
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
