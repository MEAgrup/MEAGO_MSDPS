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

// createCurationBatch — form "Buat Batch Kurasi" di /meago/campaigns/[id].
// Batch tercipta sebagai draft; hitungan completed/payout baru terjadi saat
// closeCurationBatch dipanggil (RPC close_curation_batch, migrasi 0345).
export async function createCurationBatch(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const deal_id = String(formData.get("deal_id") || "").trim();
  const period_start = String(formData.get("period_start") || "").trim();
  const period_end = String(formData.get("period_end") || "").trim();
  if (!deal_id || !period_start || !period_end) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (period_end < period_start) {
    return { ok: false, message: "[periode akhir tidak boleh sebelum periode mulai]" };
  }

  const { data, error } = await supabase
    .from("campaign_curation_batches")
    .insert({ deal_id, period_start, period_end })
    .select("code")
    .single();
  if (error) return { ok: false, message: `Gagal membuat batch: ${error.message}` };

  revalidatePath(`/meago/campaigns/${deal_id}`);
  return { ok: true, message: `Batch kurasi ${data.code} dibuat sebagai draft.` };
}

// closeCurationBatch — "Tutup Periode" (keputusan #13). Otoritas final ada di
// RPC close_curation_batch (SECURITY DEFINER, idempoten) — action ini hanya
// meneruskan hasil/pesan errornya.
export async function closeCurationBatch(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const batch_id = String(formData.get("batch_id") || "").trim();
  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!batch_id) return { ok: false, message: "Batch tidak valid." };

  const { data, error } = await supabase.rpc("close_curation_batch", { p_batch_id: batch_id });
  if (error) return { ok: false, message: `Gagal menutup batch: ${error.message}` };

  const row = Array.isArray(data) ? data[0] : data;
  if (deal_id) revalidatePath(`/meago/campaigns/${deal_id}`);
  revalidatePath("/finance");
  return {
    ok: true,
    message: `Batch ditutup: ${row?.payouts_created ?? 0} payout dibuat, total Rp ${Number(row?.total_amount ?? 0).toLocaleString("id-ID")}.`,
  };
}

// setCampaignPayoutStatus — antrian Finance /finance. Cermin persis
// setPayoutStatus (lib/actions/finance.ts) untuk creator_payouts — transisi
// legal & wewenang tetap digerbang trigger enforce_status_transition
// ('campaign_payout') di DB.
export async function setCampaignPayoutStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  const transfer_proof = String(formData.get("transfer_proof") || "").trim();
  const cancellation_reason = String(formData.get("cancellation_reason") || "").trim();
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const patch: Record<string, unknown> = { status: to_status };
  if (transfer_proof) patch.transfer_proof = transfer_proof;
  if (cancellation_reason) patch.cancellation_reason = cancellation_reason;

  const { error } = await supabase.from("campaign_payouts").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/finance");
  return { ok: true, message: `Status payout campaign diubah ke ${to_status}.` };
}
