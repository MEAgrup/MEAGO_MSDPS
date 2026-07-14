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

// ---- SKU Work Unit (M7) ----
export async function createSkuUnit(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const brief_id = String(formData.get("brief_id") || "");
  const product_ref = String(formData.get("product_ref") || "").trim();
  if (!brief_id || !product_ref) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { error } = await supabase.from("sku_work_units").insert({ brief_id, product_ref });
  if (error) return { ok: false, message: `Gagal membuat Work Unit: ${error.message}` };

  revalidatePath("/ecommerce");
  return { ok: true, message: "SKU Work Unit dibuat ([To Do])." };
}

export async function setSkuStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  const revision_notes = String(formData.get("revision_notes") || "").trim();
  const cancellation_reason = String(formData.get("cancellation_reason") || "").trim();
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const patch: Record<string, unknown> = { status: to_status };
  if (revision_notes) patch.revision_notes = revision_notes;
  if (cancellation_reason) patch.cancellation_reason = cancellation_reason;

  const { error } = await supabase.from("sku_work_units").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/ecommerce");
  return { ok: true, message: `Status Work Unit diubah ke ${to_status}.` };
}

// Simpan progres checklist (item yang sudah dikerjakan).
export async function saveChecklist(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const done = formData.getAll("checklist_done").map(String).filter(Boolean);
  if (!id) return { ok: false, message: "Work Unit tidak valid." };

  const { error } = await supabase
    .from("sku_work_units")
    .update({ checklist_done: done })
    .eq("id", id);
  if (error) return { ok: false, message: `Gagal menyimpan checklist: ${error.message}` };

  revalidatePath("/ecommerce");
  return { ok: true, message: `Checklist tersimpan (${done.length} item selesai).` };
}

// Timer manual dihapus (keputusan 2026-07-02): waktu kerja di-track otomatis per
// Brief oleh trigger briefs_track_time() — mulai saat pick-up, berhenti saat
// submit/complete. ecom_time_logs dibiarkan sebagai arsip historis.
