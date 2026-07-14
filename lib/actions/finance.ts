"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

export async function verifyPayment(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const p_transaction_id = String(formData.get("transaction_id") || "");
  const p_amount = Number(formData.get("amount") || 0);
  const p_proof = String(formData.get("proof") || "").trim() || null;
  if (!p_transaction_id || !(p_amount > 0)) {
    return { ok: false, message: "Jumlah verifikasi harus lebih dari 0." };
  }

  const { data, error } = await supabase.rpc("verify_payment", {
    p_transaction_id,
    p_amount,
    p_proof,
  });
  if (error) return { ok: false, message: `Verifikasi gagal: ${error.message}` };

  revalidatePath("/finance");
  revalidatePath("/merchants");
  return { ok: true, message: `Pembayaran diverifikasi. Status transaksi: ${data}.` };
}

// Disbursement payout kreator (M5 out-leg): Finance transfer manual mingguan,
// atau batalkan (lead) dengan alasan wajib.
export async function setPayoutStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  const transfer_proof = String(formData.get("transfer_proof") || "").trim();
  const cancellation_reason = String(formData.get("cancellation_reason") || "").trim();
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const patch: Record<string, unknown> = { status: to_status };
  if (transfer_proof) patch.transfer_proof = transfer_proof;
  if (cancellation_reason) patch.cancellation_reason = cancellation_reason;

  const { error } = await supabase.from("creator_payouts").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/finance");
  revalidatePath("/kol");
  return { ok: true, message: `Status payout diubah ke ${to_status}.` };
}

export async function setTransactionFlag(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("transaction_id") || "");
  const field = String(formData.get("field") || "");
  const value = String(formData.get("value") || "") === "true";
  if (!id || (field !== "flag_jatuh_tempo" && field !== "flag_bermasalah")) {
    return { ok: false, message: "Data flag tidak valid." };
  }

  const { error } = await supabase.from("transactions").update({ [field]: value }).eq("id", id);
  if (error) return { ok: false, message: `Gagal memperbarui flag: ${error.message}` };

  revalidatePath("/finance");
  return {
    ok: true,
    message: `${field === "flag_jatuh_tempo" ? "Flag jatuh tempo" : "Flag bermasalah"} ${
      value ? "dinyalakan" : "dimatikan"
    }.`,
  };
}
