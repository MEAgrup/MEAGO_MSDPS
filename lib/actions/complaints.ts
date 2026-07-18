"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

// progressComplaint — CM (RLS update creator_complaints, 0312): staff CM hanya kreator
// miliknya, Lead CM lintas, mgmt semua. Trigger DB creator_complaints_validate() mengisi
// status_changed_by/status_changed_at + handled_by otomatis saat status berubah — jangan
// diset dari client.
export async function progressComplaint(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const complaint_id = String(formData.get("complaint_id") || "");
  const next_status = String(formData.get("next_status") || "");
  if (!complaint_id || !["diproses", "selesai"].includes(next_status)) {
    return { ok: false, message: "Data transisi tidak valid." };
  }

  const { error } = await supabase
    .from("creator_complaints")
    .update({ status: next_status })
    .eq("id", complaint_id);
  if (error) return { ok: false, message: `Gagal mengubah status: ${error.message}` };

  revalidatePath("/meago/workspace");
  return { ok: true, message: `Status komplain diubah ke ${next_status}.` };
}
