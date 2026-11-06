"use client";

// Bagian interaktif laporan merchant (mode tim BD): edit insight per blok,
// kembalikan ke teks otomatis, logo merchant, mode terang/gelap, cetak/PDF,
// parameter skenario & KPI. Data & angka dirender server (report.tsx).

import { createContext, useContext, useState, useTransition, useActionState } from "react";
import { useRouter } from "next/navigation";
import {
  saveReportNote,
  resetReportNotes,
  uploadMerchantLogo,
  removeMerchantLogo,
  saveReportParams,
  type ActionResult,
} from "@/lib/actions/merchant-report";

type Theme = "auto" | "light" | "dark";
type Ctx = { leadId: string; from: string; to: string; editing: boolean; setEditing: (v: boolean) => void; theme: Theme; setTheme: (t: Theme) => void };
const EditCtx = createContext<Ctx | null>(null);
const useEdit = () => {
  const c = useContext(EditCtx);
  if (!c) throw new Error("EditCtx hilang");
  return c;
};

export function ReportRoot({ leadId, from, to, children }: { leadId: string; from: string; to: string; children: React.ReactNode }) {
  const [editing, setEditing] = useState(false);
  const [theme, setTheme] = useState<Theme>("auto");
  return (
    <EditCtx.Provider value={{ leadId, from, to, editing, setEditing, theme, setTheme }}>
      <div className="mr" data-theme={theme === "auto" ? undefined : theme}>
        {children}
      </div>
    </EditCtx.Provider>
  );
}

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <span className={state.ok ? "mr-ok" : "mr-err"}>{state.message}</span>;
}

export function ReportToolbar({ hasLogo, editedCount }: { hasLogo: boolean; editedCount: number }) {
  const { leadId, from, to, editing, setEditing, theme, setTheme } = useEdit();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  const [logoState, logoAction, logoPending] = useActionState<ActionResult | null, FormData>(uploadMerchantLogo, null);
  const [rmState, rmAction] = useActionState<ActionResult | null, FormData>(removeMerchantLogo, null);

  return (
    <div className="mr-toolbar no-print">
      <b>Mode tim BD MEAGO</b>
      <form action={logoAction} className="mr-inline">
        <input type="hidden" name="lead_id" value={leadId} />
        <label className="mr-btn">
          {logoPending ? "Mengunggah…" : hasLogo ? "Ganti logo merchant" : "Upload logo merchant"}
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/svg+xml"
            hidden
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
          />
        </label>
      </form>
      {hasLogo && (
        <form action={rmAction} className="mr-inline">
          <input type="hidden" name="lead_id" value={leadId} />
          <button className="mr-btn ghost" type="submit">Hapus logo</button>
        </form>
      )}
      <button className={`mr-btn${editing ? " on" : ""}`} type="button" onClick={() => setEditing(!editing)}>
        {editing ? "Selesai edit" : "Aktifkan edit insight"}
      </button>
      <button
        className="mr-btn ghost"
        type="button"
        disabled={pending || editedCount === 0}
        onClick={() => {
          if (!confirm("Kembalikan SEMUA insight periode ini ke teks otomatis?")) return;
          start(async () => {
            setMsg(await resetReportNotes(leadId, from, to));
            router.refresh();
          });
        }}
      >
        Kembalikan teks otomatis{editedCount ? ` (${editedCount})` : ""}
      </button>
      <select className="mr-select" value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Mode tampilan">
        <option value="auto">Tema: ikut perangkat</option>
        <option value="light">Tema: terang</option>
        <option value="dark">Tema: gelap</option>
      </select>
      <button className="mr-btn ghost" type="button" onClick={() => window.print()}>
        Cetak / PDF
      </button>
      <span className="mr-hint">Logo PNG/JPG/SVG ≤1 MB. Insight tersimpan per merchant &amp; periode, ikut tampil di portal merchant.</span>
      <Msg state={logoState} />
      <Msg state={rmState} />
      <Msg state={msg} />
    </div>
  );
}

export function EditableInsight({
  k,
  title,
  autoLines,
  savedBody,
  kind = "list",
  className = "mr-callout",
  extra,
}: {
  k: string;
  title: string;
  autoLines: string[];
  savedBody: string | null;
  kind?: "list" | "para";
  className?: string;
  extra?: React.ReactNode;
}) {
  const { leadId, from, to, editing } = useEdit();
  const router = useRouter();
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const lines = savedBody
    ? savedBody.split(/\r?\n/).map((s) => s.replace(/^\s*[-•*]\s+/, "")).filter((s) => s.trim())
    : autoLines;
  const current = draft ?? lines.join("\n");

  const save = (body: string) =>
    start(async () => {
      const r = await saveReportNote(leadId, from, to, k, body);
      setErr(r.ok ? null : r.message);
      if (r.ok) {
        setDraft(null);
        router.refresh();
      }
    });

  return (
    <div className={`${className}${savedBody ? " changed" : ""}`}>
      <b>{title}</b>
      {extra}
      {editing ? (
        <div className="no-print">
          <textarea
            className="mr-textarea"
            rows={Math.max(3, current.split("\n").length + 1)}
            value={current}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`Edit ${title}`}
          />
          <div className="mr-hint">Satu baris = satu poin. Teks polos (tanpa format).</div>
          <div className="mr-inline" style={{ marginTop: 6 }}>
            <button className="mr-btn" type="button" disabled={pending || draft === null} onClick={() => save(current)}>
              {pending ? "Menyimpan…" : "Simpan"}
            </button>
            {savedBody && (
              <button className="mr-btn ghost" type="button" disabled={pending} onClick={() => save("")}>
                Kembalikan otomatis
              </button>
            )}
            {err && <span className="mr-err">{err}</span>}
          </div>
        </div>
      ) : kind === "list" ? (
        <ul>
          {lines.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      ) : (
        lines.map((l, i) => (
          <p key={i} style={{ margin: "4px 0 0" }}>
            {l}
          </p>
        ))
      )}
      {savedBody && <div className="mr-edited">✎ diedit tim BD</div>}
    </div>
  );
}

export function ParamsForm({
  scenario,
  kpi,
}: {
  scenario: Record<string, number[]>;
  kpi: { aov_min: number; red_min: number; conv_min: number; top2_max: number };
}) {
  const { leadId } = useEdit();
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveReportParams, null);
  const names = ["Konservatif", "Moderat", "Agresif"];
  return (
    <details className="mr-card no-print" style={{ marginTop: 12 }}>
      <summary>
        <b>Ubah parameter skenario &amp; target KPI</b> <span className="mr-badge">parameter</span>
      </summary>
      <form action={action} style={{ marginTop: 8 }}>
        <input type="hidden" name="lead_id" value={leadId} />
        <table>
          <thead>
            <tr>
              <th>Skenario</th>
              <th className="num">Bulan +1</th>
              <th className="num">Bulan +2</th>
              <th className="num">Bulan +3</th>
            </tr>
          </thead>
          <tbody>
            {names.map((s) => (
              <tr key={s}>
                <td>{s}</td>
                {[0, 1, 2].map((i) => (
                  <td key={i} className="num">
                    <input className="mr-num" name={`sc_${s}_${i}`} defaultValue={scenario[s]?.[i] ?? ""} inputMode="decimal" required />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mr-params">
          <label>
            KPI AOV minimal (Rp)
            <input className="mr-num" name="kpi_aov_min" defaultValue={kpi.aov_min} inputMode="numeric" required />
          </label>
          <label>
            KPI redemption minimal (%)
            <input className="mr-num" name="kpi_red_min" defaultValue={Math.round(kpi.red_min * 1000) / 10} inputMode="decimal" required />
          </label>
          <label>
            KPI order / 1.000 views minimal
            <input className="mr-num" name="kpi_conv_min" defaultValue={kpi.conv_min} inputMode="decimal" required />
          </label>
          <label>
            KPI share top-2 maksimal (%)
            <input className="mr-num" name="kpi_top2_max" defaultValue={Math.round(kpi.top2_max * 1000) / 10} inputMode="decimal" required />
          </label>
        </div>
        <button className="mr-btn" type="submit" disabled={pending}>
          {pending ? "Menyimpan…" : "Simpan parameter"}
        </button>{" "}
        <Msg state={state} />
      </form>
    </details>
  );
}
