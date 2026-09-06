"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminEnv, adminKeyWarning, ADMIN_ENV_MESSAGE } from "@/lib/supabase/admin";

export type ActionResult = { ok: boolean; message: string };

async function creatorCtx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, creator: null as { id: string } | null };
  const { data: creator } = await supabase.from("mcn_creators").select("id").eq("auth_user_id", user.id).maybeSingle();
  return { supabase, user, creator };
}

type SupabaseClientLike = Awaited<ReturnType<typeof createClient>>;

async function myApprovedParticipant(supabase: SupabaseClientLike, creatorId: string, dealId: string) {
  const { data } = await supabase
    .from("campaign_participants")
    .select("id, status")
    .eq("deal_id", dealId)
    .eq("mcn_creator_id", creatorId)
    .maybeSingle();
  return data;
}

// uploadProofFile — bucket campaign-proofs TANPA policy storage.objects sama
// sekali (pola creator-reports, 0312) — upload wajib lewat service-role.
// Metadata row (campaign_video_submissions/campaign_live_submissions) tetap
// ditulis lewat client biasa (RLS creator-self sudah cukup untuk itu).
async function uploadProofFile(participantId: string, file: File): Promise<{ path: string } | { error: string }> {
  if (!hasAdminEnv()) return { error: adminKeyWarning() ?? ADMIN_ENV_MESSAGE };
  const admin = createAdminClient();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase().slice(0, 10);
  const path = `${participantId}/${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await admin.storage
    .from("campaign-proofs")
    .upload(path, bytes, { contentType: file.type || "application/octet-stream" });
  if (error) return { error: `Gagal unggah bukti: ${error.message}` };
  return { path };
}

// submitVideoProof — form "Submit Bukti Video" di /kreator/campaign. Gerbang
// participant approved + deadline tetap otoritas final di DB (trigger
// campaign_submission_guard, migrasi 0344); duplikat post_id ditandai
// otomatis (campaign_video_submission_dedup), bukan ditolak di sini.
export async function submitVideoProof(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, creator } = await creatorCtx();
  if (!user || !creator) return { ok: false, message: "Tidak terautentikasi." };

  const deal_id = String(formData.get("deal_id") || "").trim();
  const post_url = String(formData.get("post_url") || "").trim();
  if (!deal_id || !post_url) return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };

  const participant = await myApprovedParticipant(supabase, creator.id, deal_id);
  if (!participant) return { ok: false, message: "Pendaftaran campaign tidak ditemukan." };
  if (participant.status !== "approved") {
    return { ok: false, message: "Hanya kreator yang sudah disetujui yang dapat submit bukti." };
  }

  let storage_path: string | null = null;
  const file = formData.get("proof_file");
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadProofFile(participant.id, file);
    if ("error" in uploaded) return { ok: false, message: uploaded.error };
    storage_path = uploaded.path;
  }

  const { error } = await supabase.from("campaign_video_submissions").insert({
    participant_id: participant.id,
    post_url,
    storage_path,
  });
  if (error) return { ok: false, message: `Gagal menyimpan bukti video: ${error.message}` };

  revalidatePath("/kreator/campaign");
  return { ok: true, message: "Bukti video tersimpan." };
}

// deleteVideoSubmission — kreator menghapus/menarik bukti video miliknya
// (bebas sampai deadline — trigger yang sama menolak setelah lewat).
export async function deleteVideoSubmission(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await creatorCtx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const submission_id = String(formData.get("submission_id") || "").trim();
  if (!submission_id) return { ok: false, message: "Data tidak valid." };

  const { error } = await supabase.from("campaign_video_submissions").delete().eq("id", submission_id);
  if (error) return { ok: false, message: `Gagal menghapus bukti: ${error.message}` };

  revalidatePath("/kreator/campaign");
  return { ok: true, message: "Bukti video dihapus." };
}

// submitLiveProof — form "Submit Bukti Live" di /kreator/campaign.
export async function submitLiveProof(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, creator } = await creatorCtx();
  if (!user || !creator) return { ok: false, message: "Tidak terautentikasi." };

  const deal_id = String(formData.get("deal_id") || "").trim();
  const live_date = String(formData.get("live_date") || "").trim();
  const durationRaw = String(formData.get("duration_minutes") || "").trim();
  const proof_url = String(formData.get("proof_url") || "").trim() || null;
  const duration_minutes = Number(durationRaw);
  if (!deal_id || !live_date || !durationRaw) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (!Number.isFinite(duration_minutes) || duration_minutes <= 0) {
    return { ok: false, message: "[durasi live tidak valid]" };
  }

  const participant = await myApprovedParticipant(supabase, creator.id, deal_id);
  if (!participant) return { ok: false, message: "Pendaftaran campaign tidak ditemukan." };
  if (participant.status !== "approved") {
    return { ok: false, message: "Hanya kreator yang sudah disetujui yang dapat submit bukti." };
  }

  let storage_path: string | null = null;
  const file = formData.get("proof_file");
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadProofFile(participant.id, file);
    if ("error" in uploaded) return { ok: false, message: uploaded.error };
    storage_path = uploaded.path;
  }

  const { error } = await supabase.from("campaign_live_submissions").insert({
    participant_id: participant.id,
    live_date,
    duration_minutes,
    proof_url,
    storage_path,
  });
  if (error) return { ok: false, message: `Gagal menyimpan bukti live: ${error.message}` };

  revalidatePath("/kreator/campaign");
  return { ok: true, message: "Bukti live tersimpan." };
}

// deleteLiveSubmission — kreator menghapus/menarik bukti live miliknya.
export async function deleteLiveSubmission(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await creatorCtx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const submission_id = String(formData.get("submission_id") || "").trim();
  if (!submission_id) return { ok: false, message: "Data tidak valid." };

  const { error } = await supabase.from("campaign_live_submissions").delete().eq("id", submission_id);
  if (error) return { ok: false, message: `Gagal menghapus bukti: ${error.message}` };

  revalidatePath("/kreator/campaign");
  return { ok: true, message: "Bukti live dihapus." };
}
