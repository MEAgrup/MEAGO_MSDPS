"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/mcn/weeks";
import { buildCopiedSlots, type CopySourceSlot } from "@/lib/mcn/copy-week";

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

function nullableStr(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) || "").trim();
  return v === "" ? null : v;
}

// createSlot: buat slot baru. Wajib mcn_creator_id + schedule_date.
export async function createSlot(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const mcn_creator_id = String(formData.get("mcn_creator_id") || "");
  const schedule_date = String(formData.get("schedule_date") || "");
  if (!mcn_creator_id || !schedule_date) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const status = String(formData.get("status") || "").trim() || "scheduled";
  const { error } = await supabase.from("live_schedule_slots").insert({
    mcn_creator_id,
    schedule_date,
    status,
    start_time: nullableStr(formData, "start_time"),
    end_time: nullableStr(formData, "end_time"),
    off_reason: nullableStr(formData, "off_reason"),
    brand_name: nullableStr(formData, "brand_name"),
    deal_id: nullableStr(formData, "deal_id"),
    deals_by: nullableStr(formData, "deals_by"),
    ads_payer: nullableStr(formData, "ads_payer"),
    ads_note: nullableStr(formData, "ads_note"),
    pk_ready: String(formData.get("pk_ready") || "") === "true",
    product_set_title: nullableStr(formData, "product_set_title"),
    product_connected_tap: String(formData.get("product_connected_tap") || "") === "true",
    fokus_produk: nullableStr(formData, "fokus_produk"),
  });
  if (error) return { ok: false, message: `Gagal membuat slot: ${error.message}` };

  revalidatePath("/mcn/schedule");
  return { ok: true, message: "Slot jadwal dibuat." };
}

// updateSlot: patch slot. DB menolak bila slot sudah 'done' (terkunci) — teruskan pesan.
export async function updateSlot(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Slot tidak valid." };

  const patch: Record<string, unknown> = {};
  // Hanya field yang benar-benar dikirim yang di-patch.
  for (const key of [
    "schedule_date",
    "start_time",
    "end_time",
    "status",
    "off_reason",
    "brand_name",
    "deal_id",
    "deals_by",
    "ads_payer",
    "ads_note",
    "product_set_title",
    "fokus_produk",
  ]) {
    if (formData.has(key)) patch[key] = nullableStr(formData, key);
  }
  if (formData.has("pk_ready")) patch.pk_ready = String(formData.get("pk_ready")) === "true";
  if (formData.has("product_connected_tap"))
    patch.product_connected_tap = String(formData.get("product_connected_tap")) === "true";

  if (Object.keys(patch).length === 0) return { ok: false, message: "Tidak ada perubahan." };

  const { error } = await supabase.from("live_schedule_slots").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Gagal memperbarui slot: ${error.message}` };

  revalidatePath("/mcn/schedule");
  return { ok: true, message: "Slot diperbarui." };
}

// deleteSlot: hapus slot. DB menolak bila slot 'done' — teruskan pesan.
export async function deleteSlot(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Slot tidak valid." };

  const { error } = await supabase.from("live_schedule_slots").delete().eq("id", id);
  if (error) return { ok: false, message: `Gagal menghapus slot: ${error.message}` };

  revalidatePath("/mcn/schedule");
  return { ok: true, message: "Slot dihapus." };
}

// verifySlot: isi actual_start/end + verified_by lalu tandai 'done' sekali jalan.
export async function verifySlot(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const actual_start = nullableStr(formData, "actual_start");
  const actual_end = nullableStr(formData, "actual_end");
  if (!id) return { ok: false, message: "Slot tidak valid." };
  if (!actual_start) {
    return { ok: false, message: "[verifikasi wajib mengisi actual_start]" };
  }

  const { error } = await supabase
    .from("live_schedule_slots")
    .update({ status: "done", actual_start, actual_end, verified_by: me.id })
    .eq("id", id);
  if (error) return { ok: false, message: `Verifikasi ditolak: ${error.message}` };

  revalidatePath("/mcn/schedule");
  return { ok: true, message: "Slot terverifikasi (done)." };
}

// copyWeek: salin slot minggu sumber → minggu target (offset hari sama, reset state,
// skip OFF). Ditolak bila minggu target sudah punya slot non-off apa pun.
export async function copyWeek(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const sourceMonday = String(formData.get("source_monday") || "");
  const targetMonday = String(formData.get("target_monday") || "");
  if (!sourceMonday || !targetMonday) {
    return { ok: false, message: "Tanggal Senin sumber & target wajib diisi." };
  }

  let sourceEnd: string;
  let targetEnd: string;
  try {
    sourceEnd = addDays(sourceMonday, 6);
    targetEnd = addDays(targetMonday, 6);
  } catch {
    return { ok: false, message: "Tanggal Senin tidak valid (format YYYY-MM-DD)." };
  }

  // Minggu target harus benar-benar kosong dari slot non-off.
  const { data: targetSlots, error: tErr } = await supabase
    .from("live_schedule_slots")
    .select("id, status")
    .gte("schedule_date", targetMonday)
    .lte("schedule_date", targetEnd)
    .neq("status", "off");
  if (tErr) return { ok: false, message: `Gagal memeriksa minggu target: ${tErr.message}` };
  if (targetSlots && targetSlots.length > 0) {
    return {
      ok: false,
      message: `Minggu target (${targetMonday}) sudah berisi ${targetSlots.length} slot — copy dibatalkan agar tak menimpa jadwal.`,
    };
  }

  const { data: srcRows, error: sErr } = await supabase
    .from("live_schedule_slots")
    .select(
      "mcn_creator_id, schedule_date, start_time, end_time, status, brand_name, deal_id, deals_by, ads_payer, ads_note, product_set_title, fokus_produk"
    )
    .gte("schedule_date", sourceMonday)
    .lte("schedule_date", sourceEnd);
  if (sErr) return { ok: false, message: `Gagal membaca minggu sumber: ${sErr.message}` };

  const source = (srcRows ?? []) as CopySourceSlot[];
  const copied = buildCopiedSlots(source, targetMonday);
  if (copied.length === 0) {
    return { ok: false, message: "Tidak ada slot yang bisa disalin dari minggu sumber (semua OFF/kosong)." };
  }

  const { error: iErr } = await supabase.from("live_schedule_slots").insert(copied);
  if (iErr) return { ok: false, message: `Gagal menyalin slot: ${iErr.message}` };

  revalidatePath("/mcn/schedule");
  return { ok: true, message: `${copied.length} slot disalin ke minggu ${targetMonday}.` };
}

// toggleRosterInline: toggle live_roster kreator langsung dari matriks jadwal.
export async function toggleRosterInline(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const creator_id = String(formData.get("creator_id") || "");
  const live_roster = String(formData.get("live_roster") || "") === "true";
  if (!creator_id) return { ok: false, message: "Kreator tidak valid." };

  const { error } = await supabase
    .from("mcn_creators")
    .update({ live_roster })
    .eq("id", creator_id);
  if (error) return { ok: false, message: `Gagal memperbarui roster: ${error.message}` };

  revalidatePath("/mcn/schedule");
  return { ok: true, message: live_roster ? "Kreator masuk roster live." : "Kreator keluar dari roster live." };
}
