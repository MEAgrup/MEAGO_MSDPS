"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseFlexibleDate } from "@/lib/mcn/parsers";

export type ActionResult = { ok: boolean; message: string };

// Status follow up perpanjangan — mirror CHECK constraint migration 0319.
export const FOLLOWUP_STATUS = [
  "menunggu",
  "dihubungi",
  "akan_perpanjang",
  "tidak_perpanjang",
] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUS)[number];

// Label tampilan untuk tiap status (dipakai form & tabel dashboard).
export const FOLLOWUP_STATUS_LABEL: Record<FollowupStatus, string> = {
  menunggu: "Menunggu",
  dihubungi: "Dihubungi",
  akan_perpanjang: "Akan Perpanjang",
  tidak_perpanjang: "Tidak Perpanjang",
};

// recordFollowup: catat satu baris follow up perpanjangan untuk sebuah akuisisi.
// Riwayat bersifat append-only (tak ada edit/hapus) — koreksi = catatan baru.
// followup_date opsional (default hari ini di DB bila kosong).
export async function recordFollowup(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const acquisition_id = String(formData.get("acquisition_id") || "");
  const note = String(formData.get("note") || "").trim();
  const dateRaw = String(formData.get("followup_date") || "").trim();
  const status = String(formData.get("status") || "").trim();
  if (!acquisition_id || !note || !status) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (!(FOLLOWUP_STATUS as readonly string[]).includes(status)) {
    return { ok: false, message: "Status follow up tidak valid." };
  }

  const followup_date = dateRaw ? parseFlexibleDate(dateRaw) : null;
  if (dateRaw && !followup_date) {
    return { ok: false, message: "Tanggal follow up tidak valid." };
  }

  const { error } = await supabase.from("acquisition_followups").insert({
    acquisition_id,
    note,
    status,
    ...(followup_date ? { followup_date } : {}),
  });
  if (error) return { ok: false, message: `Gagal menyimpan follow up: ${error.message}` };

  revalidatePath("/acquisition/renewal");
  return { ok: true, message: "Follow up tercatat." };
}
