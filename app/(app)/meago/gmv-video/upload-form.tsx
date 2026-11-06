"use client";

// VideoGmvForm — card "Upload GMV Video Mingguan" di /meago/gmv-video. Pola sama dengan
// IngestForm (../ingest-form.tsx): useActionState + pesan ok/err apa adanya dari server
// action, termasuk ringkasan unmatched/auto-created supaya tidak ada yang senyap.
//
// Tiga metode input (Unggah File / Tempel dari Excel / Unduh Template) semuanya dikirim
// ke server action yang SAMA (runVideoGmvIngest → parseVideoGmvAny). Template dibangun
// dari konstanta parser (buildVideoGmvTemplateSheets) supaya tidak pernah menyimpang.

import { useActionState, useState } from "react";
import * as XLSX from "xlsx";
import { runVideoGmvIngest, type ActionResult } from "@/lib/actions/video-ingest";
import { buildVideoGmvTemplateSheets } from "@/lib/mcn/video-ingest";

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return (
    <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap" }}>
      {state.message}
    </div>
  );
}

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  for (const s of buildVideoGmvTemplateSheets()) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.cells), s.name);
  }
  XLSX.writeFile(wb, "template-gmv-video-mingguan.xlsx");
}

type Mode = "unggah" | "tempel";

export function VideoGmvForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    runVideoGmvIngest,
    null
  );
  const [mode, setMode] = useState<Mode>("unggah");
  return (
    <form action={action}>
      <Msg state={state} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          type="button"
          className={mode === "unggah" ? "sm" : "sm ghost2"}
          onClick={() => setMode("unggah")}
        >
          Unggah File
        </button>
        <button
          type="button"
          className={mode === "tempel" ? "sm" : "sm ghost2"}
          onClick={() => setMode("tempel")}
        >
          Tempel dari Excel
        </button>
        <button type="button" className="sm ghost2" onClick={downloadTemplate}>
          Unduh Template Baku
        </button>
      </div>

      {mode === "unggah" ? (
        <>
          <label>File GMV Video (XLSX/CSV) *</label>
          <input type="file" name="file" accept=".csv,.xlsx,.xls" required />
        </>
      ) : (
        <>
          <label>Periode Mulai *</label>
          <input type="date" name="period_start" required />
          <label>Periode Selesai *</label>
          <input type="date" name="period_end" required />
          <label>Data dari Excel (salin termasuk baris header) *</label>
          <textarea
            name="paste"
            rows={8}
            required
            placeholder={"Blok tabel di Excel (header + isi) → Ctrl+C → tempel di sini.\nKolom: export Content Analysis TikTok GO atau Template Baku MSDPS."}
          />
        </>
      )}
      <label>
        <input type="checkbox" name="force_reprocess" value="1" /> Proses ulang jika file
        duplikat (timpa data periode yang sama)
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Memproses…" : "Upload & Proses"}
      </button>
    </form>
  );
}
