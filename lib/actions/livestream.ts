"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// Pencocokan toleran nama merchant (M10 §4.3): case-insensitive, abaikan
// spasi/tanda baca berlebih.
function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ---- Input manual per minggu (fallback, M10 Rule 4) ----
export async function addLsrManual(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const brief_id = String(formData.get("brief_id") || "");
  const week_number = Number(formData.get("week_number") || 0);
  if (!brief_id || !(week_number > 0)) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  const numOrNull = (k: string) => {
    const v = String(formData.get(k) || "").trim();
    return v === "" ? null : Number(v);
  };

  const row = {
    brief_id,
    week_number,
    gmv: numOrNull("gmv"),
    jam_tayang: numOrNull("jam_tayang"),
    total_view: numOrNull("total_view"),
    total_like: numOrNull("total_like"),
    total_komen: numOrNull("total_komen"),
    total_share: numOrNull("total_share"),
    entry_source: "[Input Manual]",
  };

  // Idempotensi: minggu yang sama = replace (update baris eksisting).
  const { data: existing } = await supabase
    .from("live_stream_results")
    .select("id")
    .eq("brief_id", brief_id)
    .eq("week_number", week_number)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from("live_stream_results").update(row).eq("id", existing.id)
    : await supabase.from("live_stream_results").insert(row);
  if (error) return { ok: false, message: `Gagal menyimpan LSR: ${error.message}` };

  revalidatePath("/livestream");
  return {
    ok: true,
    message: existing
      ? `LSR minggu ke-${week_number} di-replace.`
      : `LSR minggu ke-${week_number} tersimpan.`,
  };
}

// ---- Upload Template Baku MSDPS (M10 §4.3) ----
// Kolom: Nama Merchant | Week | Total GMV | Jam Tayang | Total View | Total Like | Total Komen | Total Share
export async function importLsrTemplate(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const raw = String(formData.get("rows") || "").trim();
  const source_file_ref = String(formData.get("source_file_ref") || "").trim();
  if (!raw) return { ok: false, message: "Tempelkan isi Template Baku terlebih dahulu." };
  if (!source_file_ref) return { ok: false, message: "Referensi file sumber wajib diisi (arsip audit)." };

  // Brief Live Stream aktif + nama merchant-nya (untuk matching toleran).
  const { data: lsBriefs } = await supabase
    .from("briefs")
    .select("id, service_id, status, assigned_division")
    .eq("assigned_division", "LiveStream")
    .in("status", ["[Diteruskan ke Vendor]"]);
  const serviceIds = (lsBriefs ?? []).map((b) => b.service_id);
  const { data: svcRows } = serviceIds.length
    ? await supabase.from("services").select("id, merchant_id").in("id", serviceIds)
    : { data: [] as { id: string; merchant_id: string }[] };
  const merchantIds = [...new Set((svcRows ?? []).map((s) => s.merchant_id))];
  const { data: merchants } = merchantIds.length
    ? await supabase.from("merchants").select("id, nama_toko").in("id", merchantIds)
    : { data: [] as { id: string; nama_toko: string }[] };

  const briefByMerchantName = new Map<string, string>();
  for (const m of merchants ?? []) {
    const svc = (svcRows ?? []).find((s) => s.merchant_id === m.id);
    const brief = (lsBriefs ?? []).find((b) => b.service_id === svc?.id);
    if (brief) briefByMerchantName.set(normalizeName(m.nama_toko), brief.id);
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^nama\s*merchant/i.test(l)); // buang baris header kalau ikut tertempel

  let inserted = 0;
  let replaced = 0;
  let unmatched = 0;
  const errors: string[] = [];

  for (const line of lines) {
    const parts = line.split(/[;\t]|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((s) => s.trim());
    if (parts.length < 8) {
      errors.push(`Baris tidak lengkap: "${line.slice(0, 40)}…"`);
      continue;
    }
    const [nama, week, gmv, jam, view, like, komen, share] = parts;
    const brief_id = briefByMerchantName.get(normalizeName(nama)) ?? null;
    const numOrNull = (v: string) => (v === "" ? null : Number(v.replace(/[^\d.-]/g, "")));

    const row = {
      brief_id,
      merchant_name_raw: nama,
      week_number: Number(week),
      gmv: numOrNull(gmv),
      jam_tayang: numOrNull(jam),
      total_view: numOrNull(view),
      total_like: numOrNull(like),
      total_komen: numOrNull(komen),
      total_share: numOrNull(share),
      entry_source: "[Upload Template]",
      source_file_ref,
    };

    if (brief_id) {
      const { data: existing } = await supabase
        .from("live_stream_results")
        .select("id")
        .eq("brief_id", brief_id)
        .eq("week_number", row.week_number)
        .maybeSingle();
      const { error } = existing
        ? await supabase.from("live_stream_results").update(row).eq("id", existing.id)
        : await supabase.from("live_stream_results").insert(row);
      if (error) errors.push(`${nama} W${week}: ${error.message}`);
      else existing ? replaced++ : inserted++;
    } else {
      const { error } = await supabase.from("live_stream_results").insert(row);
      if (error) errors.push(`${nama} W${week}: ${error.message}`);
      else unmatched++;
    }
  }

  revalidatePath("/livestream");
  const parts = [`${inserted} baris masuk`];
  if (replaced) parts.push(`${replaced} di-replace`);
  if (unmatched) parts.push(`${unmatched} [Unmatched] (resolve manual)`);
  if (errors.length) parts.push(`${errors.length} gagal: ${errors[0]}`);
  return { ok: errors.length === 0, message: parts.join(" · ") };
}

// AM resolve baris [Unmatched] → pilih Brief yang benar (M10 Rule 7).
export async function resolveUnmatched(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const brief_id = String(formData.get("brief_id") || "");
  if (!id || !brief_id) return { ok: false, message: "Pilih Brief tujuan." };

  const { error } = await supabase.from("live_stream_results").update({ brief_id }).eq("id", id);
  if (error) return { ok: false, message: `Gagal me-resolve: ${error.message}` };

  revalidatePath("/livestream");
  return { ok: true, message: "Baris berhasil dipetakan ke Brief." };
}

// ---- GMV otoritatif bulanan (manual + confidence tag) ----
export async function upsertGmvAuthoritative(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const merchant_id = String(formData.get("merchant_id") || "");
  const period = String(formData.get("period") || "").replace("-", ""); // input month YYYY-MM
  const gmv_value = Number(formData.get("gmv_value") || 0);
  const confidence = String(formData.get("confidence") || "");
  const source_note = String(formData.get("source_note") || "").trim();
  if (!merchant_id || !/^\d{6}$/.test(period) || !(gmv_value >= 0) || !confidence) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { data: existing } = await supabase
    .from("merchant_gmv_authoritative")
    .select("id")
    .eq("merchant_id", merchant_id)
    .eq("period", period)
    .maybeSingle();

  const row = { merchant_id, period, gmv_value, confidence, source_note: source_note || null };
  const { error } = existing
    ? await supabase.from("merchant_gmv_authoritative").update(row).eq("id", existing.id)
    : await supabase.from("merchant_gmv_authoritative").insert(row);
  if (error) return { ok: false, message: `Gagal menyimpan GMV: ${error.message}` };

  revalidatePath("/livestream");
  return { ok: true, message: `GMV otoritatif ${period} tersimpan (${confidence}).` };
}
