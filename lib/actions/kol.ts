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

// ---- Creator Master (M9 §4.2) ----
export async function createCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const name_handle = String(formData.get("name_handle") || "").trim();
  const platforms = formData.getAll("platforms").map(String).filter(Boolean);
  const niche = String(formData.get("niche") || "").trim();
  const source_pool = String(formData.get("source_pool") || "");
  const roster_ref = String(formData.get("roster_ref") || "").trim();
  const payment_details = String(formData.get("payment_details") || "").trim();
  if (!name_handle || platforms.length === 0 || !niche || !source_pool) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { error } = await supabase.from("creators").insert({
    name_handle,
    platforms,
    niche,
    source_pool,
    roster_ref: roster_ref || null,
    payment_details: payment_details || null,
  });
  if (error) return { ok: false, message: `Gagal membuat Creator Master: ${error.message}` };

  revalidatePath("/kol");
  return { ok: true, message: `Creator Master ${name_handle} dibuat.` };
}

export async function updateCreatorPayment(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const payment_details = String(formData.get("payment_details") || "").trim();
  if (!id || !payment_details) return { ok: false, message: "Payment Details wajib diisi." };

  const { error } = await supabase.from("creators").update({ payment_details }).eq("id", id);
  if (error) return { ok: false, message: `Gagal menyimpan: ${error.message}` };

  revalidatePath("/kol");
  return { ok: true, message: "Payment Details tersimpan." };
}

// ---- Creator Booking (M9 §4.3) ----
export async function createBooking(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const brief_id = String(formData.get("brief_id") || "");
  const creator_id = String(formData.get("creator_id") || "");
  const deliverable_type = String(formData.get("deliverable_type") || "");
  const agreed_rate = Number(formData.get("agreed_rate") || 0);
  const due_date = String(formData.get("due_date") || "");
  if (!brief_id || !creator_id || !deliverable_type || !(agreed_rate > 0) || !due_date) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { error } = await supabase.from("creator_bookings").insert({
    brief_id,
    creator_id,
    deliverable_type,
    agreed_rate,
    due_date,
  });
  if (error) return { ok: false, message: `Gagal membuat Booking: ${error.message}` };

  revalidatePath("/kol");
  return { ok: true, message: "Creator Booking dibuat ([Sourcing/Negotiation])." };
}

export async function setBookingStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  const delivery_proof = String(formData.get("delivery_proof") || "").trim();
  const hours_logged = String(formData.get("hours_logged") || "").trim();
  const cancellation_reason = String(formData.get("cancellation_reason") || "").trim();
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const patch: Record<string, unknown> = { status: to_status };
  if (delivery_proof) patch.delivery_proof = delivery_proof;
  if (hours_logged) patch.hours_logged = Number(hours_logged);
  if (cancellation_reason) patch.cancellation_reason = cancellation_reason;

  const { error } = await supabase.from("creator_bookings").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/kol");
  return { ok: true, message: `Status Booking diubah ke ${to_status}.` };
}

// GMV Generated diisi belakangan — metrik evaluasi creator, bukan syarat payout.
export async function setBookingGmv(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const gmv = Number(formData.get("gmv_generated") || 0);
  if (!id || !(gmv >= 0)) return { ok: false, message: "GMV tidak valid." };

  const { error } = await supabase.from("creator_bookings").update({ gmv_generated: gmv }).eq("id", id);
  if (error) return { ok: false, message: `Gagal menyimpan GMV: ${error.message}` };

  revalidatePath("/kol");
  return { ok: true, message: "GMV Generated tersimpan." };
}

// ---- Payment Request → PYO (M9 §3.3, milestone 10 video / 5 jam) ----
export async function createPayout(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const p_creator_id = String(formData.get("creator_id") || "");
  const p_payout_type = String(formData.get("payout_type") || "");
  const p_amount = Number(formData.get("amount") || 0);
  if (!p_creator_id || !p_payout_type || !(p_amount > 0)) {
    return { ok: false, message: "Creator, tipe payout, dan nominal wajib diisi." };
  }

  const { data, error } = await supabase.rpc("create_creator_payout", {
    p_creator_id,
    p_payout_type,
    p_amount,
  });
  if (error) return { ok: false, message: `Payment Request ditolak: ${error.message}` };

  revalidatePath("/kol");
  revalidatePath("/finance");
  return { ok: true, message: `Payment Request dibuat (PYO ${data}) — masuk antrian Finance.` };
}
