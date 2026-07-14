"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, me: null };
  const { data: me } = await supabase
    .from("employees")
    .select("id, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  return { supabase, user, me };
}

export async function createCampaign(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };

  const campaign_name = String(formData.get("campaign_name") || "").trim();
  const channel = String(formData.get("channel") || "").trim();
  const start_date = String(formData.get("start_date") || "") || null;
  const is_online = formData.get("is_online") === "on";
  const is_offline = formData.get("is_offline") === "on";
  const owner_id = String(formData.get("owner_id") || "") || me.id;
  // Checkbox defaults checked → launch immediately. Unchecked keeps it [Draft].
  const activate = formData.get("activate") === "on";

  if (!campaign_name || !channel || !start_date) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (!is_online && !is_offline) {
    return { ok: false, message: "Pilih minimal satu jenis: Online atau Offline." };
  }

  // Insert as [Draft] (default), then transition to [Active] via UPDATE so the
  // state machine + audit log record the launch (Draft -> Active).
  const { data: created, error } = await supabase
    .from("campaigns")
    .insert({ campaign_name, channel, start_date, is_online, is_offline, owner_id })
    .select("id")
    .single();
  if (error || !created) {
    return { ok: false, message: `Gagal membuat kampanye: ${error?.message ?? "unknown"}` };
  }

  if (activate) {
    const { error: aErr } = await supabase
      .from("campaigns")
      .update({ status: "[Active]" })
      .eq("id", created.id);
    if (aErr) {
      revalidatePath("/campaigns");
      return {
        ok: true,
        message: `Kampanye "${campaign_name}" dibuat, tapi gagal diaktifkan otomatis (${aErr.message}). Aktifkan manual lewat tombol [Active].`,
      };
    }
    revalidatePath("/campaigns");
    return { ok: true, message: `Kampanye "${campaign_name}" dibuat & langsung [Active].` };
  }

  revalidatePath("/campaigns");
  return { ok: true, message: `Kampanye "${campaign_name}" dibuat sebagai [Draft].` };
}

export async function setCampaignStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const { error } = await supabase.from("campaigns").update({ status: to_status }).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/campaigns");
  return { ok: true, message: `Status kampanye diubah ke ${to_status}.` };
}

export async function upsertMarketingBudget(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const campaign_id = String(formData.get("campaign_id") || "");
  const budget = Number(formData.get("budget") || 0);
  if (!campaign_id || !(budget > 0)) {
    return { ok: false, message: "[budget wajib diisi dan harus lebih dari 0]" };
  }

  const { error } = await supabase
    .from("marketing_performance_records")
    .upsert({ campaign_id, budget }, { onConflict: "campaign_id" });
  if (error) return { ok: false, message: `Gagal menyimpan budget: ${error.message}` };

  revalidatePath("/campaigns");
  return { ok: true, message: "Budget marketing tersimpan; metrik ROAS ter-update." };
}
