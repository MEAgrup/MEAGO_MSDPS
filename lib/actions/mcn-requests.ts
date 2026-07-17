"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseRupiah } from "@/lib/mcn/parsers";

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

// createRequest: permintaan atas kreator.
//  - type 'sample' → langsung ok (needs_approval false).
//  - type 'ads'    → cek ads_budget_cap kreator; bila nominal budget > cap ATAU cap
//                    belum diisi (null) → needs_approval=true (butuh approval Director).
//  - type 'hsl'    → biasa.
export async function createRequest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const mcn_creator_id = String(formData.get("mcn_creator_id") || "");
  const type = String(formData.get("type") || "");
  const target_brand = String(formData.get("target_brand") || "").trim() || null;
  const detail = String(formData.get("detail") || "").trim() || null;
  if (!mcn_creator_id || !type) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  let needs_approval = false;
  if (type === "ads") {
    const budgetRaw = String(formData.get("budget") || "").trim();
    const budget = budgetRaw === "" ? null : parseRupiah(budgetRaw);
    const { data: creator, error: cErr } = await supabase
      .from("mcn_creators")
      .select("ads_budget_cap")
      .eq("id", mcn_creator_id)
      .maybeSingle();
    if (cErr) return { ok: false, message: `Gagal membaca kreator: ${cErr.message}` };
    const cap = creator?.ads_budget_cap ?? null;
    // Cap belum diisi ATAU budget melebihi cap → butuh approval Director.
    needs_approval = cap === null || (budget !== null && Number(budget) > Number(cap));
  }

  const { error } = await supabase
    .from("creator_requests")
    .insert({ mcn_creator_id, type, target_brand, detail, needs_approval });
  if (error) return { ok: false, message: `Gagal membuat request: ${error.message}` };

  revalidatePath("/meago/workspace");
  return {
    ok: true,
    message: needs_approval
      ? "Request dibuat — butuh approval Director (melebihi/tanpa budget cap)."
      : "Request dibuat.",
  };
}

// approveRequest: set approved_by=me.id. Trigger DB memastikan hanya Director.
export async function approveRequest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Request tidak valid." };

  const { error } = await supabase
    .from("creator_requests")
    .update({ approved_by: me.id })
    .eq("id", id);
  if (error) return { ok: false, message: `Approval ditolak: ${error.message}` };

  revalidatePath("/meago/workspace");
  revalidatePath("/bizdev");
  return { ok: true, message: "Request di-approve." };
}

// progressRequest: ubah status via state machine DB (teruskan pesan bila ditolak).
export async function progressRequest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  if (!id || !status) return { ok: false, message: "Data transisi tidak lengkap." };

  const { error } = await supabase.from("creator_requests").update({ status }).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/meago/workspace");
  revalidatePath("/bizdev");
  return { ok: true, message: `Request diubah ke ${status}.` };
}
