"use client";

import { useActionState, useEffect, useState } from "react";
import { createCampaign, type ActionResult } from "@/lib/actions/go-campaigns";
import { FUNDING_SOURCE_LABEL, CAMPAIGN_TRACK_LABEL } from "@/lib/campaign-budget";

export type AmOption = { id: string; full_name: string };

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

export function CampaignsToolbar({ amOptions }: { amOptions: AmOption[] }) {
  const [open, setOpen] = useState(false);
  const [fundingSource, setFundingSource] = useState("");
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(createCampaign, null);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      setFundingSource("");
    }
  }, [state]);

  return (
    <div className="card">
      <div className="table-toolbar">
        <h2>Buat Campaign</h2>
        <button type="button" onClick={() => setOpen(true)}>
          + Campaign Baru
        </button>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Campaign Baru</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                <Msg state={state} />

                <label>Nama Brand / Campaign *</label>
                <input name="brand_name" required />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label>Funding Source *</label>
                    <select
                      name="funding_source"
                      required
                      value={fundingSource}
                      onChange={(e) => setFundingSource(e.target.value)}
                    >
                      <option value="">— pilih —</option>
                      {Object.entries(FUNDING_SOURCE_LABEL).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Track *</label>
                    <select name="campaign_track" required defaultValue="">
                      <option value="">— pilih —</option>
                      {Object.entries(CAMPAIGN_TRACK_LABEL).map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {fundingSource === "brand" && (
                  <>
                    <label>AM Penerima (Account) *</label>
                    <select name="operational_owner_id" required defaultValue="">
                      <option value="">— pilih AM —</option>
                      {amOptions.map((am) => (
                        <option key={am.id} value={am.id}>
                          {am.full_name}
                        </option>
                      ))}
                    </select>
                  </>
                )}

                <label>Mode Campaign</label>
                <select name="campaign_mode" defaultValue="">
                  <option value="">— tidak ditentukan —</option>
                  <option value="collaboration_package">Creator Package (TikTok Collaboration Package)</option>
                  <option value="others">Lainnya</option>
                </select>

                <label>Target Location ID (TikTok)</label>
                <input name="target_location_id" placeholder="mis. 6558xxxxxxxxxx" />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <label>Base Fee / kreator (Rp) *</label>
                    <input name="base_fee" inputMode="numeric" placeholder="150000" required />
                  </div>
                  <div>
                    <label>Kuota Kreator *</label>
                    <input name="creator_quota" inputMode="numeric" placeholder="20" required />
                  </div>
                  <div>
                    <label>Creator Budget (Rp) *</label>
                    <input name="creator_budget" inputMode="numeric" placeholder="3000000" required />
                  </div>
                </div>

                <label>Ads Budget Rencana (Rp)</label>
                <input name="ads_budget_planned" inputMode="numeric" placeholder="opsional" />

                <label>Alasan Over Budget (isi hanya kalau base fee × kuota melebihi creator budget)</label>
                <input name="over_budget_reason" placeholder="wajib diisi + butuh wewenang Lead ke atas kalau over budget" />

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div>
                    <label>Target GMV (Rp)</label>
                    <input name="target_gmv" inputMode="numeric" placeholder="opsional" />
                  </div>
                  <div>
                    <label>Target Views</label>
                    <input name="target_views" inputMode="numeric" placeholder="opsional" />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <label>Window Post Mulai</label>
                    <input name="post_window_start" type="date" />
                  </div>
                  <div>
                    <label>Window Post Selesai</label>
                    <input name="post_window_end" type="date" />
                  </div>
                  <div>
                    <label>Deadline Submit Bukti</label>
                    <input name="submission_deadline" type="datetime-local" />
                  </div>
                </div>

                <label>
                  <input type="checkbox" name="has_free_meal" style={{ width: "auto", marginRight: 6 }} />
                  Ada free meal
                </label>

                <label>Brief</label>
                <textarea name="brief" rows={3} placeholder="Ringkasan brief campaign" />

                <details className="disclose" style={{ marginTop: 12 }}>
                  <summary>Segmentasi Kelayakan Pendaftar (opsional, dipakai G.2)</summary>
                  <p className="hint">Isi dipisah koma. Follower TIDAK dipakai sebagai filter (keputusan terkunci).</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label>Industry</label>
                      <input name="eligible_industries" placeholder="Dining, Accommodation" />
                    </div>
                    <div>
                      <label>Kota</label>
                      <input name="eligible_cities" placeholder="Jakarta, Bandung" />
                    </div>
                    <div>
                      <label>Level</label>
                      <input name="eligible_levels" placeholder="Silver, Gold" />
                    </div>
                    <div>
                      <label>Jenis Kreator</label>
                      <input name="eligible_creator_types" placeholder="video, live" />
                    </div>
                    <div>
                      <label>Roster Live</label>
                      <input name="eligible_roster_status" placeholder="active" />
                    </div>
                    <div>
                      <label>Status Kontrak</label>
                      <input name="eligible_status_kontrak" placeholder="kontrak" />
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                    <div>
                      <label>Ambang GMV (Rp)</label>
                      <input name="min_gmv" inputMode="numeric" placeholder="opsional" />
                    </div>
                    <div>
                      <label>Metrik GMV</label>
                      <select name="min_gmv_metric" defaultValue="">
                        <option value="">—</option>
                        <option value="gmv">GMV</option>
                        <option value="video_gmv">GMV Video</option>
                      </select>
                    </div>
                    <div>
                      <label>Periode (hari)</label>
                      <input name="min_gmv_period_days" inputMode="numeric" placeholder="30" />
                    </div>
                  </div>
                </details>
              </div>
              <div className="modal-foot">
                <button type="button" className="ghost2" onClick={() => setOpen(false)} disabled={pending}>
                  Batal
                </button>
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Simpan Campaign"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
