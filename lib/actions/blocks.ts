"use server";

// M12 block-request + generator manual M13/M14 (OD/Director).
// Enforcement tetap di Postgres (trigger/RLS/RPC-gate); action hanya meneruskan.

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

function refreshAll() {
  for (const p of ["/portal", "/board", "/management", "/ecommerce", "/ads", "/kol", "/livestream"]) {
    revalidatePath(p);
  }
}

// Staff ajukan block atas Brief yang sedang berjalan (Pending -> menunggu SPV/Lead).
export async function ajukanBlock(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const brief_id = String(formData.get("brief_id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (!brief_id || !reason) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { error } = await supabase
    .from("block_requests")
    .insert({ brief_id, reason, requested_by: user.id });
  if (error) return { ok: false, message: `Gagal mengajukan block: ${error.message}` };

  refreshAll();
  return { ok: true, message: "Block request diajukan ([Pending]) — menunggu keputusan SPV/Lead." };
}

// SPV/Lead memutuskan: [Approved] (Brief otomatis [Blocked], timer berhenti) atau
// [Rejected] (tanpa alasan — keputusan CDPS).
export async function putuskanBlock(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  if (!id || !["[Approved]", "[Rejected]"].includes(to_status)) {
    return { ok: false, message: "Data keputusan tidak lengkap." };
  }

  const { data, error } = await supabase
    .from("block_requests")
    .update({ status: to_status })
    .eq("id", id)
    .select("id");
  if (error) return { ok: false, message: `Keputusan ditolak: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, message: "[anda tidak berwenang memutuskan block request ini]" };
  }

  refreshAll();
  return {
    ok: true,
    message:
      to_status === "[Approved]"
        ? "Block di-approve — Brief otomatis [Blocked], waktu blocked dikecualikan dari SLA."
        : "Block ditolak — Brief tetap berjalan.",
  };
}

// Staff/lead melanjutkan Brief yang [Blocked] -> [In Progress] (blocked_to terstempel).
export async function resumeBrief(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const brief_id = String(formData.get("brief_id") || "");
  if (!brief_id) return { ok: false, message: "Brief tidak valid." };

  const { error } = await supabase
    .from("briefs")
    .update({ status: "[In Progress]" })
    .eq("id", brief_id);
  if (error) return { ok: false, message: `Gagal melanjutkan: ${error.message}` };

  refreshAll();
  return { ok: true, message: "Brief dilanjutkan ([In Progress]) — timer berjalan kembali." };
}

// Manual generate (hanya OD/Director — gate di RPC): snapshot health & skor performa
// minggu berjalan, untuk melihat data terbaru tanpa menunggu cron Senin.
export async function generateSkorMingguIni(
  _prev: ActionResult | null,
  _formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  // Senin minggu berjalan (WIB).
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const dow = (now.getUTCDay() + 6) % 7; // Senin=0
  const monday = new Date(now.getTime() - dow * 86400 * 1000);
  const week = monday.toISOString().slice(0, 10);

  const h = await supabase.rpc("generate_health_snapshots", { p_week_start: week });
  if (h.error) return { ok: false, message: `Gagal generate health: ${h.error.message}` };
  const p = await supabase.rpc("generate_performance_scores", { p_week_start: week });
  if (p.error) return { ok: false, message: `Gagal generate performa: ${p.error.message}` };

  refreshAll();
  return {
    ok: true,
    message: `Selesai: ${h.data ?? 0} snapshot health + ${p.data ?? 0} skor performa untuk minggu ${week}. (Minggu yang sudah ada dilewati — snapshot immutable.)`,
  };
}
