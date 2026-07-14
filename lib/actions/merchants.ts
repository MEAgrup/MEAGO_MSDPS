"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

const SERVICE_TYPES = ["KOL-Video", "KOL-Live", "E-commerce", "Ads", "Live Stream"];
const PAYMENT_INTENTS = ["Lunas", "Bayar Sebagian", "Termin", "Bayar di Belakang"];

export async function closeDeal(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const p_attempt_id = String(formData.get("attempt_id") || "");
  const p_nama_toko = String(formData.get("nama_toko") || "").trim();
  const p_kota = String(formData.get("kota") || "").trim();
  const p_link_toko = String(formData.get("link_toko") || "").trim();
  const p_kategori = String(formData.get("kategori") || "").trim();
  const p_gmv_baseline = Number(formData.get("gmv_baseline") || 0);
  const p_target_gmv = Number(formData.get("target_gmv") || 0);
  const p_total_fee = Number(formData.get("total_fee") || 0);
  const p_payment_intent = String(formData.get("payment_intent") || "");
  const p_service_types = formData.getAll("service_types").map(String).filter(Boolean);

  if (
    !p_attempt_id ||
    !p_nama_toko ||
    !p_kota ||
    !p_link_toko ||
    !p_kategori ||
    !p_payment_intent
  ) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (!PAYMENT_INTENTS.includes(p_payment_intent)) {
    return { ok: false, message: "Skema pembayaran tidak valid." };
  }
  if (p_service_types.length === 0) {
    return { ok: false, message: "[minimal satu service harus dipilih]" };
  }
  if (p_service_types.some((s) => !SERVICE_TYPES.includes(s))) {
    return { ok: false, message: "Jenis service tidak valid." };
  }
  if (!(p_gmv_baseline >= 0) || !(p_target_gmv >= 0) || !(p_total_fee > 0)) {
    return { ok: false, message: "GMV & total fee harus angka valid (fee > 0)." };
  }

  const { data, error } = await supabase.rpc("close_deal", {
    p_attempt_id,
    p_nama_toko,
    p_kota,
    p_link_toko,
    p_kategori,
    p_gmv_baseline,
    p_target_gmv,
    p_service_types,
    p_total_fee,
    p_payment_intent,
  });
  if (error) return { ok: false, message: `Closing gagal: ${error.message}` };

  revalidatePath("/merchants");
  revalidatePath("/leads");
  revalidatePath("/finance");
  return { ok: true, message: `Closing berhasil — merchant & transaksi dibuat (id ${data}).` };
}
