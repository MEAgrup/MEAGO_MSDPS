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

// registerCampaignParticipation — form "Daftar" di /kreator/campaign (v_portal_campaigns
// sudah memfilter hanya campaign yang layak untuk kreator sesi ini). Gerbang
// campaign aktif + kelayakan tetap otoritas final di DB (trigger
// campaign_participant_eligibility_guard, migrasi 0343) — pesan errornya
// diteruskan apa adanya kalau ditolak (mis. race antara kreator melihat daftar
// dan campaign berubah stage).
export async function registerCampaignParticipation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const { data: creator } = await supabase.from("mcn_creators").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!creator) return { ok: false, message: "Akun ini bukan akun kreator." };

  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!deal_id) return { ok: false, message: "Campaign tidak valid." };

  const { error } = await supabase.from("campaign_participants").insert({ deal_id, mcn_creator_id: creator.id });
  if (error) return { ok: false, message: `Gagal mendaftar: ${error.message}` };

  revalidatePath("/kreator/campaign");
  return { ok: true, message: "Pendaftaran campaign tercatat — menunggu kurasi tim." };
}

// withdrawCampaignParticipation — kreator batalkan pendaftaran sendiri, atau
// staff membatalkan atas nama kreator. Wewenang tetap digerbang trigger
// campaign_participants_curation_guard (migrasi 0343).
export async function withdrawCampaignParticipation(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const participant_id = String(formData.get("participant_id") || "").trim();
  if (!participant_id) return { ok: false, message: "Data tidak valid." };

  const { error } = await supabase.from("campaign_participants").update({ status: "withdrawn" }).eq("id", participant_id);
  if (error) return { ok: false, message: `Gagal membatalkan pendaftaran: ${error.message}` };

  revalidatePath("/kreator/campaign");
  revalidatePath("/meago/campaigns");
  return { ok: true, message: "Pendaftaran dibatalkan." };
}

// curateCampaignParticipant — approve/reject oleh tim operasional, dipakai
// panel "Pendaftar" di /meago/campaigns/[id]. Kuota (approved < creator_quota)
// & wewenang (BizDev/CampaignSpecialist/Account/mgmt) tetap gerbang DB
// (trigger campaign_participants_curation_guard, migrasi 0343) — pesan error
// DB (mis. "kuota sudah penuh") diteruskan apa adanya.
export async function curateCampaignParticipant(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const participant_id = String(formData.get("participant_id") || "").trim();
  const decision = String(formData.get("decision") || "").trim();
  const deal_id = String(formData.get("deal_id") || "").trim();
  const rejection_reason = String(formData.get("rejection_reason") || "").trim();

  if (!participant_id || (decision !== "approved" && decision !== "rejected")) {
    return { ok: false, message: "Keputusan tidak valid." };
  }
  if (decision === "rejected" && !rejection_reason) {
    return { ok: false, message: "[alasan penolakan wajib diisi]" };
  }

  const { error } = await supabase
    .from("campaign_participants")
    .update({ status: decision, rejection_reason: decision === "rejected" ? rejection_reason : null })
    .eq("id", participant_id);
  if (error) return { ok: false, message: `Gagal menyimpan keputusan: ${error.message}` };

  if (deal_id) revalidatePath(`/meago/campaigns/${deal_id}`);
  return { ok: true, message: `Pendaftar ${decision === "approved" ? "disetujui" : "ditolak"}.` };
}
