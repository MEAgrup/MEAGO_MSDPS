"use client";

import { useActionState, useState } from "react";
import { sendPortalAccess, type PortalAccessResult } from "@/lib/actions/portal-access";

// Tombol "Kirim Akses Portal" + modal link aktivasi (WA / salin). Hanya dirender
// untuk prospek yang sudah closing; database tetap menolak bila dipanggil untuk
// yang belum (portal_invite_precheck, migrasi 0372).
export function PortalAccessButton({
  kind,
  sourceId,
  label,
  resend = false,
}: {
  kind: "creator" | "merchant";
  sourceId: string;
  label: string;
  resend?: boolean;
}) {
  const [state, action, pending] = useActionState<PortalAccessResult | null, FormData>(
    sendPortalAccess,
    null
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const title = kind === "creator" ? "Akses Creator Portal" : "Akses Merchant Portal";

  return (
    <>
      <button type="button" className="sm" onClick={() => { setOpen(true); setCopied(false); }}>
        {resend ? "Kirim Ulang Akses" : "Kirim Akses Portal"}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                {title} · {label}
              </h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              {state && !state.ok && <div className="err">{state.message}</div>}
              {state?.ok && state.link ? (
                <>
                  <div className="ok-msg">
                    Link aktivasi sekali pakai, berlaku 72 jam. Kirim lewat WhatsApp — jangan
                    dibagikan ke orang lain.
                  </div>
                  <label>Link aktivasi</label>
                  <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} />
                  <label>Pesan WhatsApp</label>
                  <textarea readOnly rows={kind === "creator" ? 4 : 9} value={state.waText} />
                  {!state.waUrl && (
                    <div className="warn-box">Nomor WhatsApp kosong — salin pesan dan kirim manual.</div>
                  )}
                </>
              ) : (
                <p>
                  {resend
                    ? "Link lama akan dinonaktifkan dan link aktivasi baru dibuat."
                    : "Akun portal akan dibuat (tanpa email otomatis) dan link aktivasi sekali pakai dibuat untuk dikirim via WhatsApp."}
                </p>
              )}
            </div>
            <div className="modal-foot">
              {state?.ok && state.link ? (
                <>
                  <button
                    type="button"
                    className="ghost2"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(state.link ?? "");
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? "Tersalin ✓" : "Salin link"}
                  </button>
                  {state.waUrl && (
                    <button
                      type="button"
                      onClick={() => window.open(state.waUrl ?? "", "_blank", "noopener,noreferrer")}
                    >
                      Kirim via WhatsApp
                    </button>
                  )}
                </>
              ) : (
                <form action={action}>
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="source_id" value={sourceId} />
                  <button type="button" className="ghost2" onClick={() => setOpen(false)} disabled={pending}>
                    Batal
                  </button>{" "}
                  <button type="submit" disabled={pending}>
                    {pending ? "Membuat…" : resend ? "Buat Link Baru" : "Buat Akses"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
