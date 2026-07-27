"use client";

import { useActionState, useEffect, useState } from "react";
import {
  recordFollowup,
  FOLLOWUP_STATUS,
  FOLLOWUP_STATUS_LABEL,
  type ActionResult,
  type FollowupStatus,
} from "@/lib/actions/acquisition-followup";
import { tanggal } from "@/lib/format";

// Satu baris riwayat follow up untuk ditampilkan di modal.
export type FollowupItem = {
  id: string;
  followup_date: string;
  status: string;
  note: string;
  created_at: string;
};

// Warna badge per status follow up.
const STATUS_BADGE: Record<FollowupStatus, string> = {
  menunggu: "slate",
  dihubungi: "blue",
  akan_perpanjang: "green",
  tidak_perpanjang: "red",
};

export function statusBadgeClass(status: string): string {
  return STATUS_BADGE[status as FollowupStatus] ?? "gray";
}

export function statusLabel(status: string): string {
  return FOLLOWUP_STATUS_LABEL[status as FollowupStatus] ?? status;
}

// FollowupModal — tombol "Follow Up" per baris kreator. Modal menampilkan riwayat
// follow up sebelumnya (append-only) + form catat follow up baru (status, tanggal,
// catatan). Submit memanggil recordFollowup; sukses → modal tertutup & tabel
// di-refresh via revalidatePath.
export function FollowupModal({
  acquisitionId,
  creatorLabel,
  bindingEndLabel,
  history,
  today,
}: {
  acquisitionId: string;
  creatorLabel: string;
  bindingEndLabel: string;
  history: FollowupItem[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    recordFollowup,
    null
  );

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button className="sm" type="button" onClick={() => setOpen(true)}>
        Follow Up{history.length > 0 ? ` (${history.length})` : ""}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Follow Up · {creatorLabel}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                Binding berakhir: <strong>{bindingEndLabel}</strong>
              </div>

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>
                Riwayat Follow Up ({history.length})
              </h4>
              {history.length === 0 ? (
                <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
                  Belum ada follow up untuk kreator ini.
                </div>
              ) : (
                <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
                  {history.map((h) => (
                    <div
                      key={h.id}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: "8px 10px",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                        <span className={`badge ${statusBadgeClass(h.status)}`}>
                          {statusLabel(h.status)}
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          {tanggal(h.followup_date)}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{h.note}</div>
                    </div>
                  ))}
                </div>
              )}

              <h4 style={{ margin: "0 0 8px", fontSize: 13 }}>Catat Follow Up Baru</h4>
              <form action={action}>
                {state && !state.ok && <div className="err">{state.message}</div>}
                <input type="hidden" name="acquisition_id" value={acquisitionId} />
                <div className="row">
                  <div>
                    <label>Status *</label>
                    <select name="status" defaultValue="menunggu" required>
                      {FOLLOWUP_STATUS.map((s) => (
                        <option key={s} value={s}>
                          {FOLLOWUP_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label>Tanggal Follow Up *</label>
                    <input type="date" name="followup_date" defaultValue={today} required />
                  </div>
                </div>
                <label>Catatan *</label>
                <textarea name="note" rows={3} required style={{ fontFamily: "inherit" }} />
                <div className="modal-foot" style={{ padding: "12px 0 0", borderTop: "none" }}>
                  <button
                    type="button"
                    className="ghost2"
                    onClick={() => setOpen(false)}
                    disabled={pending}
                  >
                    Tutup
                  </button>
                  <button type="submit" disabled={pending}>
                    {pending ? "Menyimpan…" : "Simpan Follow Up"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
