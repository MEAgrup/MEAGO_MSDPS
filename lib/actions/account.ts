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

const FASE_C_PATHS = ["/account", "/ecommerce", "/ads", "/kol", "/livestream", "/merchants"];
function revalidateAll() {
  for (const p of FASE_C_PATHS) revalidatePath(p);
}

// ---- Intake: SPV/Head Account menugaskan AM (M6 §3) ----
export async function assignAm(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const p_merchant_id = String(formData.get("merchant_id") || "");
  const p_am_id = String(formData.get("am_id") || "");
  const reason = String(formData.get("reason") || "").trim();
  if (!p_merchant_id || !p_am_id) return { ok: false, message: "Merchant dan AM wajib dipilih." };

  const { error } = await supabase.rpc("assign_am", {
    p_merchant_id,
    p_am_id,
    p_reason: reason || null,
  });
  if (error) return { ok: false, message: `Assignment gagal: ${error.message}` };

  revalidateAll();
  return { ok: true, message: "AM berhasil ditugaskan." };
}

// ---- Strategy & Plan (M6 §4) ----
export async function createStrategy(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const service_id = String(formData.get("service_id") || "");
  const objective = String(formData.get("objective") || "").trim();
  const target_kpis = String(formData.get("target_kpis") || "").trim();
  const outline = String(formData.get("outline") || "").trim();
  const timeline_start = String(formData.get("timeline_start") || "");
  const timeline_end = String(formData.get("timeline_end") || "");
  if (!service_id || !objective || !target_kpis || !outline || !timeline_start || !timeline_end) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { error } = await supabase.from("strategies").insert({
    service_id,
    objective,
    target_kpis,
    outline,
    timeline_start,
    timeline_end,
  });
  if (error) return { ok: false, message: `Gagal membuat Strategy Plan: ${error.message}` };

  revalidateAll();
  return { ok: true, message: "Strategy Plan dibuat ([Strategy Drafting])." };
}

export async function setStrategyStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  const revision_notes = String(formData.get("revision_notes") || "").trim();
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const patch: Record<string, unknown> = { status: to_status };
  if (revision_notes) patch.revision_notes = revision_notes;

  const { error } = await supabase.from("strategies").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidateAll();
  return { ok: true, message: `Status Strategy diubah ke ${to_status}.` };
}

// ---- Brief (M6 §5–§6): field wajib berbeda per divisi ----
export async function createBrief(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const service_id = String(formData.get("service_id") || "");
  const division = String(formData.get("division") || ""); // hanya untuk pemetaan field; DB memvalidasi ulang
  const deliverable_type = String(formData.get("deliverable_type") || "").trim();
  const due_date = String(formData.get("due_date") || "");
  const priority = String(formData.get("priority") || "");
  const instructions = String(formData.get("instructions") || "").trim();
  const quantity_target = Number(formData.get("quantity_target") || 0);
  if (!service_id || !deliverable_type || !due_date || !priority) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const row: Record<string, unknown> = {
    service_id,
    deliverable_type,
    due_date,
    priority,
    instructions: instructions || null,
  };

  if (division === "LiveStream") {
    const target_gmv = Number(formData.get("target_gmv") || 0);
    const target_jam = Number(formData.get("target_jam_tayang") || 0);
    const metrics: Record<string, number> = {};
    if (target_gmv > 0) metrics.target_gmv = target_gmv;
    if (target_jam > 0) metrics.target_jam_tayang = target_jam;
    if (Object.keys(metrics).length === 0) {
      return { ok: false, message: "[Brief Live Stream wajib memiliki Target Metric(s)]" };
    }
    row.target_metrics = metrics;
  } else {
    if (!(quantity_target > 0)) {
      return { ok: false, message: "Target (jumlah) wajib diisi dan lebih dari 0." };
    }
    row.quantity_target = quantity_target;
  }

  if (division === "Ecommerce") {
    const scope = formData.getAll("optimization_scope").map(String).filter(Boolean);
    const custom = String(formData.get("custom_scope_item") || "").trim();
    if (scope.length === 0) {
      return { ok: false, message: "[Optimization Scope Checklist wajib dipilih minimal satu]" };
    }
    row.optimization_scope = scope;
    row.custom_scope_item = custom || null;
  }

  if (division === "Ads") {
    const platforms = formData.getAll("platforms").map(String).filter(Boolean);
    const budget_idr = Number(formData.get("budget_total_idr") || 0);
    const budget_usd = Number(formData.get("budget_total_usd") || 0);
    if (platforms.length === 0 || (budget_idr <= 0 && budget_usd <= 0)) {
      return { ok: false, message: "[Brief Ads wajib memiliki Platform dan Budget Total]" };
    }
    row.platforms = platforms;
    if (budget_idr > 0) row.budget_total_idr = budget_idr;
    if (budget_usd > 0) row.budget_total_usd = budget_usd;
  }

  const { error } = await supabase.from("briefs").insert(row);
  if (error) return { ok: false, message: `Gagal membuat Brief: ${error.message}` };

  revalidateAll();
  return { ok: true, message: "Brief dibuat dan ter-dispatch ke queue divisi." };
}

// Transisi status Brief generik (pick-up, forward vendor, revisi, blocked, dst).
export async function setBriefStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  const revision_notes = String(formData.get("revision_notes") || "").trim();
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const patch: Record<string, unknown> = { status: to_status };
  if (revision_notes) patch.revision_notes = revision_notes;

  const { error } = await supabase.from("briefs").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidateAll();
  return { ok: true, message: `Status Brief diubah ke ${to_status}.` };
}

// ---- Complaints (M6 §8) ----
export async function createComplaint(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const merchant_id = String(formData.get("merchant_id") || "");
  const description = String(formData.get("description") || "").trim();
  const severity = String(formData.get("severity") || "");
  const related_service_id = String(formData.get("related_service_id") || "");
  if (!merchant_id || !description || !severity) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { error } = await supabase.from("complaints").insert({
    merchant_id,
    description,
    severity,
    related_service_id: related_service_id || null,
  });
  if (error) return { ok: false, message: `Gagal mencatat komplain: ${error.message}` };

  revalidatePath("/account");
  return { ok: true, message: "Komplain tercatat ([Open])." };
}

export async function setComplaintStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  const resolution_notes = String(formData.get("resolution_notes") || "").trim();
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const patch: Record<string, unknown> = { status: to_status };
  if (resolution_notes) patch.resolution_notes = resolution_notes;

  const { error } = await supabase.from("complaints").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/account");
  return { ok: true, message: `Status komplain diubah ke ${to_status}.` };
}
