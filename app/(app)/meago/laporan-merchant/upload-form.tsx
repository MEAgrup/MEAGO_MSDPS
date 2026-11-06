"use client";

// Upload export "Content Analysis › Video List" untuk laporan merchant.
// File dikirim browser LANGSUNG ke Storage (signed upload URL) supaya workbook
// gabungan beberapa bulan tidak kena batas body server action/Vercel (±4,5 MB);
// server lalu membaca, mengagregasi, menyimpan, dan menghapus file mentahnya.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createMerchantUploadUrl, runMerchantReportIngest, type ActionResult } from "@/lib/actions/merchant-report";

export type LeadOption = { lead_id: string; lead_code: string | null; brand_name: string; wilayah: string | null; months: string[] };

const label = (l: LeadOption) => `${l.brand_name} — ${l.lead_code ?? "tanpa kode"}${l.wilayah ? ` (${l.wilayah})` : ""}`;

export function MerchantUploadForm({ leads, recentMonths }: { leads: LeadOption[]; recentMonths: string[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [state, setState] = useState<ActionResult | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const lead = useMemo(() => leads.find((l) => label(l) === query) ?? null, [leads, query]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const file = fd.get("file");
    if (!lead) return setState({ ok: false, message: "Pilih merchant dari daftar." });
    if (!(file instanceof File) || file.size === 0) return setState({ ok: false, message: "Pilih file export." });
    setState(null);
    start(async () => {
      setStep("Menyiapkan upload…");
      const url = await createMerchantUploadUrl(lead.lead_id, file.name);
      if (!url.ok) {
        setStep(null);
        return setState({ ok: false, message: url.message });
      }
      setStep(`Mengunggah ${(file.size / 1e6).toFixed(1)} MB…`);
      const up = await createClient().storage.from("merchant-report-uploads").uploadToSignedUrl(url.path, url.token, file);
      if (up.error) {
        setStep(null);
        return setState({ ok: false, message: `Gagal mengunggah: ${up.error.message}` });
      }
      setStep("Memproses (membaca sheet, menjumlahkan baris pecahan, menyimpan)…");
      const data = new FormData();
      data.set("lead_id", lead.lead_id);
      data.set("upload_path", url.path);
      data.set("file_name", file.name);
      data.set("keyword", keyword);
      data.set("month_override", String(fd.get("month_override") || ""));
      const res = await runMerchantReportIngest(null, data);
      setStep(null);
      setState(res);
      if (res.ok) {
        form.reset();
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit}>
      <label>Merchant (lead induk brand) *</label>
      <input
        list="mr-leads"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          const l = leads.find((x) => label(x) === e.target.value);
        }}
        placeholder="Ketik nama brand atau kode LEAD-…"
        required
      />
      <datalist id="mr-leads">
        {leads.map((l) => (
          <option key={l.lead_id} value={label(l)} />
        ))}
      </datalist>
      {lead && lead.months.length > 0 && (
        <p className="hint">Sudah ada data: {[...lead.months].sort().join(", ")}. Upload bulan yang sama akan MENGGANTI data bulan itu.</p>
      )}

      <label>Saring outlet (opsional)</label>
      <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="kosongkan = semua outlet di file" />
      <p className="hint">
        Isi HANYA bila file berisi beberapa merchant: baris yang Location name-nya tidak memuat salah satu kata kunci (pisahkan koma, mis.
        &quot;Sushi Yay, Yay! Grill&quot;) disaring. Kosong = semua outlet dipakai — termasuk sub-brand seperti &quot;Yay! Grill&quot;, sama dengan
        sample yang disetujui. Awalan &quot;Brand - &quot; dari nama outlet dibuang otomatis memakai nama brand lead.
      </p>

      <label>File export (XLSX/CSV) *</label>
      <input type="file" name="file" accept=".xlsx,.xls,.csv" required />
      <p className="hint">
        Boleh workbook gabungan (satu sheet per bulan, mis. &quot;Agus 2026&quot;, &quot;SEPT 2026&quot;, atau kolom <code>month</code>) maupun export
        bulanan (sheet Filter + Data). Hanya baris <i>Valid posts</i> yang dihitung; bulan yang belum selesai, format lama (item_id/poi_id), dan sheet
        dengan Post ID / Location ID rusak ditolak beralasan.
      </p>

      <label>Bulan (hanya bila tidak terbaca dari file)</label>
      <select name="month_override" defaultValue="">
        <option value="">— otomatis dari file —</option>
        {recentMonths.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      <button type="submit" disabled={pending}>
        {pending ? step ?? "Memproses…" : "Upload & Proses"}
      </button>
      {state && (
        <div className={state.ok ? "ok-msg" : "err"} style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>
          {state.message}
        </div>
      )}
    </form>
  );
}
