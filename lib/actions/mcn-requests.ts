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

// createRequest: permintaan atas kreator (form CM lama, sekarang + 4 jenis MEA GO).
//  - type 'sample'/'hsl'          → langsung ok (needs_approval false), perilaku lama.
//  - type 'ads'                   → cek ads_budget_cap kreator; bila nominal budget >
//                                    cap ATAU cap belum diisi (null) → needs_approval=true
//                                    (butuh approval Director). Perilaku lama, TIDAK diubah
//                                    (nominal 'ads' historis tidak disimpan ke kolom nominal).
//  - type 'free_meal'/'visit'     → target_brand teks bebas (TANPA dropdown merchant di
//                                    sisi CM); needs_approval tetap default false.
//  - type 'ads_live'/'special_price_live' → nominal (rupiah) disimpan ke kolom nominal.
//                                    needs_approval untuk 'ads_live' DISERAHKAN SEPENUHNYA
//                                    ke trigger DB creator_requests_validate() (0311) yang
//                                    membandingkan ke ads_budget_cap — TIDAK dihitung/di-set
//                                    dari sini.
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
  let nominal: number | null = null;

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
  } else if (type === "ads_live" || type === "special_price_live") {
    const nominalRaw = String(formData.get("nominal") || "").trim();
    if (nominalRaw !== "") {
      nominal = parseRupiah(nominalRaw);
      if (nominal === null) {
        return { ok: false, message: "Nominal tidak valid — gunakan format seperti 500.000." };
      }
    }
  }

  const { error } = await supabase
    .from("creator_requests")
    .insert({ mcn_creator_id, type, target_brand, detail, needs_approval, nominal });
  if (error) return { ok: false, message: `Gagal membuat request: ${error.message}` };

  revalidatePath("/meago/workspace");
  revalidatePath("/bizdev");
  return {
    ok: true,
    message:
      type === "ads" && needs_approval
        ? "Request dibuat — butuh approval Director (melebihi/tanpa budget cap)."
        : type === "ads_live"
          ? "Request dibuat — status approval mengikuti budget cap kreator (dicek otomatis)."
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
