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

// ---- Ad Campaign Record (M8) ----
export async function createAdCampaign(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const brief_id = String(formData.get("brief_id") || "");
  const platform = String(formData.get("platform") || "");
  const objective = String(formData.get("objective") || "");
  const currency = String(formData.get("currency") || "IDR");
  const budget_allocated = Number(formData.get("budget_allocated") || 0);
  const creative_ref = String(formData.get("creative_ref") || "").trim();
  if (!brief_id || !platform || !objective) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { error } = await supabase.from("ad_campaign_records").insert({
    brief_id,
    platform,
    objective,
    currency,
    budget_allocated: budget_allocated > 0 ? budget_allocated : null,
    creative_ref: creative_ref || null,
  });
  if (error) return { ok: false, message: `Gagal membuat Campaign Record: ${error.message}` };

  revalidatePath("/ads");
  return { ok: true, message: "Ad Campaign Record dibuat ([Setup In Progress])." };
}

export async function setAdcStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  const revision_notes = String(formData.get("revision_notes") || "").trim();
  const pause_reason = String(formData.get("pause_reason") || "").trim();
  const cancellation_reason = String(formData.get("cancellation_reason") || "").trim();
  const budget_allocated = Number(formData.get("budget_allocated") || 0);
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const patch: Record<string, unknown> = { status: to_status };
  if (revision_notes) patch.revision_notes = revision_notes;
  if (pause_reason) patch.pause_reason = pause_reason;
  if (cancellation_reason) patch.cancellation_reason = cancellation_reason;
  if (budget_allocated > 0) patch.budget_allocated = budget_allocated;

  const { error } = await supabase.from("ad_campaign_records").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/ads");
  return { ok: true, message: `Status campaign diubah ke ${to_status}.` };
}

// ---- Weekly Performance Entry (M8) ----
export async function createWpe(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const campaign_record_id = String(formData.get("campaign_record_id") || "");
  const week_number = Number(formData.get("week_number") || 0);
  const entry_type = String(formData.get("entry_type") || "[Weekly]");
  const spend = Number(formData.get("spend") || 0);
  const impressions = Number(formData.get("impressions") || 0);
  const clicks = Number(formData.get("clicks") || 0);
  const conversions = String(formData.get("conversions") || "").trim();
  const gmv = String(formData.get("gmv_generated") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!campaign_record_id || !(week_number > 0)) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (!conversions && !gmv) {
    return { ok: false, message: "[Conversions atau GMV Generated wajib diisi]" };
  }

  const { error } = await supabase.from("weekly_performance_entries").insert({
    campaign_record_id,
    week_number,
    entry_type,
    spend,
    impressions,
    clicks,
    conversions: conversions ? Number(conversions) : null,
    gmv_generated: gmv ? Number(gmv) : null,
    notes: notes || null,
  });
  if (error) return { ok: false, message: `Gagal menyimpan WPE: ${error.message}` };

  revalidatePath("/ads");
  return { ok: true, message: `WPE minggu ke-${week_number} tersimpan (ROAS/CTR dihitung otomatis).` };
}
