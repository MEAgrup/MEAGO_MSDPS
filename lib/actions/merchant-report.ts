"use server";

// Laporan Performa Merchant (migrasi 0381). Upload export "Content Analysis ›
// Video List" → tiktok_post_snapshots, logo merchant, insight hasil edit BD,
// parameter skenario/KPI. Gerbang wewenang ada di DB (is_merchant_report_staff,
// RLS, RPC); pengecekan di sini hanya supaya pesan errornya jelas.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminEnv, ADMIN_ENV_MESSAGE } from "@/lib/supabase/admin";
import { readWorkbookBuffer } from "@/lib/merchant-report/read-xlsx";
import { parseVideoListWorkbook, type MonthBatch } from "@/lib/merchant-report/video-list";
import { INSIGHT_KEYS } from "@/lib/merchant-report/insights";

export type ActionResult = { ok: boolean; message: string };

const UPLOAD_BUCKET = "merchant-report-uploads";
const LOGO_BUCKET = "merchant-logos";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;

async function staffCtx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, ok: false as const };
  const { data } = await supabase.rpc("is_merchant_report_staff");
  return { supabase, user, ok: data === true };
}

function todayJakarta(): string {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---- 1. Upload data mentah ---------------------------------------------------

/** Signed upload URL — file mentah dikirim browser langsung ke Storage (tanpa batas body server action). */
export async function createMerchantUploadUrl(
  leadId: string,
  fileName: string,
): Promise<{ ok: true; path: string; token: string } | { ok: false; message: string }> {
  const { user, ok } = await staffCtx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };
  if (!ok) return { ok: false, message: "Tidak berwenang mengunggah data laporan merchant." };
  if (!UUID_RE.test(leadId)) return { ok: false, message: "Pilih merchant (lead) dulu." };
  if (!/\.(xlsx|xls|csv)$/i.test(fileName)) return { ok: false, message: "File harus .xlsx / .xls / .csv." };
  if (!hasAdminEnv()) return { ok: false, message: ADMIN_ENV_MESSAGE };
  const path = `${leadId}/${Date.now()}-${user.id.slice(0, 8)}.${fileName.split(".").pop()!.toLowerCase()}`;
  const { data, error } = await createAdminClient().storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, message: `Gagal menyiapkan upload: ${error?.message ?? "tanpa respons"}` };
  return { ok: true, path: data.path, token: data.token };
}

export async function runMerchantReportIngest(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, ok } = await staffCtx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };
  if (!ok) return { ok: false, message: "Tidak berwenang mengunggah data laporan merchant." };

  const leadId = String(formData.get("lead_id") || "");
  const path = String(formData.get("upload_path") || "");
  const fileName = String(formData.get("file_name") || "");
  const keyword = String(formData.get("keyword") || "").trim();
  const monthOverride = String(formData.get("month_override") || "").trim();
  if (!UUID_RE.test(leadId)) return { ok: false, message: "Merchant (lead) tidak valid." };
  if (!path.startsWith(`${leadId}/`)) return { ok: false, message: "File upload tidak cocok dengan merchant terpilih." };
  if (monthOverride && !PERIOD_RE.test(monthOverride)) return { ok: false, message: "Bulan pilihan harus YYYY-MM." };
  if (!hasAdminEnv()) return { ok: false, message: ADMIN_ENV_MESSAGE };

  const admin = createAdminClient();
  let sheets;
  try {
    const { data: blob, error } = await admin.storage.from(UPLOAD_BUCKET).download(path);
    if (error || !blob) return { ok: false, message: `File upload tidak ditemukan: ${error?.message ?? ""}` };
    sheets = readWorkbookBuffer(Buffer.from(await blob.arrayBuffer()), fileName);
  } catch (e) {
    return { ok: false, message: `Gagal membaca file: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    // drop-raw: file mentah tidak disimpan setelah dibaca.
    await admin.storage.from(UPLOAD_BUCKET).remove([path]);
  }

  // Nama brand lead dipakai HANYA untuk membuang awalan "Brand - " dari nama outlet.
  // Penyaringan baris hanya bila staf mengisi kata kunci (file multi-merchant).
  const { data: leadRows } = await supabase.rpc("merchant_report_leads", { p_only_with_data: false });
  const brandName = ((leadRows ?? []) as { lead_id: string; brand_name: string }[]).find((l) => l.lead_id === leadId)?.brand_name ?? null;
  const filterKeywords = keyword
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const parsed = parseVideoListWorkbook(sheets, {
    brandKeyword: brandName,
    filterKeywords,
    monthOverride: monthOverride || null,
    today: todayJakarta(),
  });
  const lines = parsed.sheets.map((s) => `${s.ok ? "✓" : "✗"} ${s.sheet}: ${s.message}`);
  if (parsed.batches.length === 0) {
    return { ok: false, message: ["Tidak ada bulan yang bisa diproses.", ...lines].join("\n") };
  }

  const batchId = `MR-${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}`;
  const saved: string[] = [];
  const failed: string[] = [];
  for (const b of parsed.batches) {
    const { data, error } = await supabase.rpc("merchant_report_replace_month", {
      p_lead_id: leadId,
      p_period_start: `${b.period}-01`,
      p_source_format: b.sourceFormat,
      p_batch: batchId,
      p_rows: b.rows,
    });
    if (error) failed.push(`✗ ${b.period}: ${error.message}`);
    else saved.push(`${b.period} (${data} baris)`);
  }

  const latest = [...parsed.batches].reverse().find((b) => saved.some((s) => s.startsWith(b.period)));
  const syncMsg = latest ? await fillCreatorGaps(supabase, latest) : "";

  revalidatePath("/meago/laporan-merchant");
  revalidatePath(`/meago/laporan-merchant/${leadId}`);
  return {
    ok: saved.length > 0,
    message: [
      saved.length ? `Tersimpan: ${saved.join(", ")} — batch ${batchId}.` : "Tidak ada bulan yang tersimpan.",
      ...failed,
      ...lines,
      syncMsg,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

// Isi kota/level mcn_creators yang MASIH KOSONG dari bulan terbaru. Tidak pernah
// menimpa nilai yang ada (Creator Analysis mingguan lebih segar), dan
// binding_status SENGAJA tidak disentuh: perubahan kolom itu mencabut undangan
// portal kreator (trigger 0372) — sumbernya tetap ingest Creator Analysis.
async function fillCreatorGaps(supabase: Awaited<ReturnType<typeof createClient>>, batch: MonthBatch): Promise<string> {
  const info = new Map<string, { city: string | null; level: string | null }>();
  for (const r of [...batch.rows].filter((x) => x.status_valid).sort((a, b) => a.row_seq - b.row_seq)) {
    const cur = info.get(r.creator_username) ?? { city: null, level: null };
    info.set(r.creator_username, { city: r.creator_city?.trim() || cur.city, level: r.creator_level?.trim() || cur.level });
  }
  const names = [...info.keys()];
  const masters: { id: string; username: string; city: string | null; creator_level: string | null }[] = [];
  for (let i = 0; i < names.length; i += 150) {
    const { data, error } = await supabase
      .from("mcn_creators")
      .select("id, username, city, creator_level")
      .in("username", names.slice(i, i + 150));
    if (error) return `Sinkron Data Kreator dilewati: ${error.message}`;
    masters.push(...((data ?? []) as typeof masters));
  }
  const patches = masters
    .map((m) => {
      const v = info.get((m.username ?? "").toLowerCase());
      const patch: Record<string, string> = {};
      if (v?.city && !m.city) patch.city = v.city;
      if (v?.level && !m.creator_level) patch.creator_level = v.level;
      return { id: m.id, patch };
    })
    .filter((p) => Object.keys(p.patch).length > 0);
  let done = 0;
  for (let i = 0; i < patches.length; i += 10) {
    const res = await Promise.all(
      patches.slice(i, i + 10).map((p) => supabase.from("mcn_creators").update(p.patch).eq("id", p.id).select("id")),
    );
    done += res.filter((r) => !r.error && (r.data?.length ?? 0) > 0).length;
  }
  return `Data Kreator: ${masters.length} dari ${names.length} kreator cocok dengan username; ${done} profil kota/level yang kosong dilengkapi${
    patches.length > done ? ` (${patches.length - done} tidak bisa diubah dengan akses Anda)` : ""
  }.`;
}

// ---- 2. Logo merchant --------------------------------------------------------

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg" };

export async function uploadMerchantLogo(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, ok } = await staffCtx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };
  if (!ok) return { ok: false, message: "Tidak berwenang." };
  const leadId = String(formData.get("lead_id") || "");
  const file = formData.get("logo");
  if (!UUID_RE.test(leadId)) return { ok: false, message: "Merchant tidak valid." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Pilih file logo." };
  const ext = LOGO_TYPES[file.type];
  if (!ext) return { ok: false, message: "Logo harus PNG, JPG, atau SVG." };
  if (file.size > 1024 * 1024) return { ok: false, message: "Logo maksimal 1 MB." };
  if (!hasAdminEnv()) return { ok: false, message: ADMIN_ENV_MESSAGE };

  const admin = createAdminClient();
  const { data: old } = await supabase.rpc("merchant_report_leads", { p_only_with_data: false });
  const prevPath = ((old ?? []) as { lead_id: string; logo_path: string | null }[]).find((l) => l.lead_id === leadId)?.logo_path;
  const path = `${leadId}/logo-${Date.now()}.${ext}`;
  const up = await admin.storage.from(LOGO_BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (up.error) return { ok: false, message: `Gagal unggah logo: ${up.error.message}` };
  const { error } = await supabase.rpc("merchant_report_set_logo", { p_lead_id: leadId, p_path: path });
  if (error) {
    await admin.storage.from(LOGO_BUCKET).remove([path]);
    return { ok: false, message: `Gagal menyimpan logo: ${error.message}` };
  }
  if (prevPath && prevPath !== path) await admin.storage.from(LOGO_BUCKET).remove([prevPath]);
  revalidatePath(`/meago/laporan-merchant/${leadId}`);
  revalidatePath("/meago/laporan-merchant");
  return { ok: true, message: "Logo tersimpan." };
}

export async function removeMerchantLogo(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, ok } = await staffCtx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };
  if (!ok) return { ok: false, message: "Tidak berwenang." };
  const leadId = String(formData.get("lead_id") || "");
  if (!UUID_RE.test(leadId)) return { ok: false, message: "Merchant tidak valid." };
  const { data: old } = await supabase.rpc("merchant_report_leads", { p_only_with_data: false });
  const prevPath = ((old ?? []) as { lead_id: string; logo_path: string | null }[]).find((l) => l.lead_id === leadId)?.logo_path;
  const { error } = await supabase.rpc("merchant_report_set_logo", { p_lead_id: leadId, p_path: null });
  if (error) return { ok: false, message: error.message };
  if (prevPath && hasAdminEnv()) await createAdminClient().storage.from(LOGO_BUCKET).remove([prevPath]);
  revalidatePath(`/meago/laporan-merchant/${leadId}`);
  return { ok: true, message: "Logo dihapus — header kembali ke kotak inisial." };
}

// ---- 3. Insight hasil edit ---------------------------------------------------

function notePeriod(from: string, to: string): { from: string; to: string } | null {
  if (!PERIOD_RE.test(from) || !PERIOD_RE.test(to) || to < from) return null;
  return { from: `${from}-01`, to: `${to}-01` };
}

/** body kosong = hapus (kembali ke teks otomatis). */
export async function saveReportNote(leadId: string, from: string, to: string, key: string, body: string): Promise<ActionResult> {
  const { supabase, user, ok } = await staffCtx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };
  if (!ok) return { ok: false, message: "Tidak berwenang mengedit insight." };
  const p = notePeriod(from, to);
  if (!UUID_RE.test(leadId) || !p || !(INSIGHT_KEYS as string[]).includes(key)) return { ok: false, message: "Data insight tidak valid." };
  const text = body.replace(/\r\n/g, "\n").trim();
  if (text.length > 4000) return { ok: false, message: "Insight maksimal 4.000 karakter." };
  const q = text
    ? supabase.from("merchant_report_notes").upsert(
        { lead_id: leadId, period_from: p.from, period_to: p.to, section_key: key, body: text, updated_by: user.id, updated_at: new Date().toISOString() },
        { onConflict: "lead_id,period_from,period_to,section_key" },
      )
    : supabase.from("merchant_report_notes").delete().match({ lead_id: leadId, period_from: p.from, period_to: p.to, section_key: key });
  const { error } = await q;
  if (error) return { ok: false, message: `Gagal menyimpan insight: ${error.message}` };
  revalidatePath(`/meago/laporan-merchant/${leadId}`);
  return { ok: true, message: text ? "Insight tersimpan." : "Insight dikembalikan ke teks otomatis." };
}

export async function resetReportNotes(leadId: string, from: string, to: string): Promise<ActionResult> {
  const { supabase, user, ok } = await staffCtx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };
  if (!ok) return { ok: false, message: "Tidak berwenang." };
  const p = notePeriod(from, to);
  if (!UUID_RE.test(leadId) || !p) return { ok: false, message: "Data tidak valid." };
  const { error } = await supabase.from("merchant_report_notes").delete().match({ lead_id: leadId, period_from: p.from, period_to: p.to });
  if (error) return { ok: false, message: error.message };
  revalidatePath(`/meago/laporan-merchant/${leadId}`);
  return { ok: true, message: "Semua insight periode ini kembali ke teks otomatis." };
}

// ---- 4. Parameter skenario & KPI ---------------------------------------------

const SCEN_NAMES = ["Konservatif", "Moderat", "Agresif"];

export async function saveReportParams(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, ok } = await staffCtx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };
  if (!ok) return { ok: false, message: "Tidak berwenang." };
  const leadId = String(formData.get("lead_id") || "");
  if (!UUID_RE.test(leadId)) return { ok: false, message: "Merchant tidak valid." };
  const num = (k: string) => {
    const v = Number(String(formData.get(k) ?? "").replace(",", "."));
    return Number.isFinite(v) ? v : NaN;
  };
  const scenario: Record<string, number[]> = {};
  for (const s of SCEN_NAMES) {
    const vals = [0, 1, 2].map((i) => num(`sc_${s}_${i}`));
    if (vals.some((v) => Number.isNaN(v) || v < 0 || v > 10)) return { ok: false, message: `Pengali ${s} harus angka 0–10.` };
    scenario[s] = vals;
  }
  const kpi = { aov_min: num("kpi_aov_min"), red_min: num("kpi_red_min") / 100, conv_min: num("kpi_conv_min"), top2_max: num("kpi_top2_max") / 100 };
  if (Object.values(kpi).some((v) => Number.isNaN(v) || v < 0)) return { ok: false, message: "Target KPI harus angka ≥ 0." };
  const { error } = await supabase
    .from("merchant_report_params")
    .upsert({ lead_id: leadId, scenario, kpi, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "lead_id" });
  if (error) return { ok: false, message: `Gagal menyimpan parameter: ${error.message}` };
  revalidatePath(`/meago/laporan-merchant/${leadId}`);
  return { ok: true, message: "Parameter skenario & KPI tersimpan." };
}
