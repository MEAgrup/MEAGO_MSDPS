"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  campaignRoutingNext,
  type CampaignRoutingEvent,
  type CampaignRoutingState,
} from "@/lib/mcn/routing";

export type ActionResult = { ok: boolean; message: string };

// JS mirror of normalize_phone_id (dedup lookup only; DB authoritative).
function jsNormalize(p: string): string | null {
  if (!p || !p.trim()) return null;
  const digits = p.replace(/[^0-9]/g, "").replace(/^0/, "").replace(/^62/, "");
  return "+62" + digits;
}

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

// createShopLead: lead shop dari tim CM masuk ke modul Leads M1 existing dgn source
// 'MCN Shop Lead'. Kolom wajib leads M1: lead_name + phone_raw (NOT NULL) + source.
export async function createShopLead(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const lead_name = String(formData.get("lead_name") || "").trim();
  const phone_raw = String(formData.get("phone_raw") || "").trim();
  const email = String(formData.get("email") || "").trim() || null;
  if (!lead_name || !phone_raw) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { error } = await supabase
    .from("leads")
    .insert({ lead_name, phone_raw, email, source: "MCN Shop Lead" });
  if (error) {
    if (error.code === "23505") {
      const norm = jsNormalize(phone_raw);
      const { data: dup } = await supabase
        .from("leads")
        .select("code, lead_name, status")
        .eq("phone_normalized", norm)
        .maybeSingle();
      return {
        ok: false,
        message: dup
          ? `[nomor sudah terdaftar] sebagai ${dup.code} — ${dup.lead_name} (${dup.status}).`
          : "[nomor sudah terdaftar di database leads]",
      };
    }
    return { ok: false, message: `Gagal menyimpan lead shop: ${error.message}` };
  }

  revalidatePath("/bizdev");
  revalidatePath("/leads");
  return { ok: true, message: `Lead shop "${lead_name}" masuk ke pool leads.` };
}

// createCampaignRequest: buat routing campaign deal→kreator. owner_cpm_id auto-derive
// dari kreator via trigger DB.
export async function createCampaignRequest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const deal_id = String(formData.get("deal_id") || "") || null;
  const mcn_creator_id = String(formData.get("mcn_creator_id") || "") || null;
  const needs_brand_acc = String(formData.get("needs_brand_acc") || "") === "true";
  if (!mcn_creator_id) return { ok: false, message: "Kreator wajib dipilih." };

  const { error } = await supabase
    .from("campaign_requests")
    .insert({ deal_id, mcn_creator_id, needs_brand_acc });
  if (error) return { ok: false, message: `Gagal membuat campaign request: ${error.message}` };

  revalidatePath("/bizdev");
  return { ok: true, message: "Campaign request dibuat (menunggu konfirmasi CM)." };
}

// Helper generik: select state routing → jalankan pure function → tulis kolom baru.
async function runRouting(
  formData: FormData,
  event: CampaignRoutingEvent,
  okMessage: string
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Campaign request tidak valid." };

  const { data: row, error: rErr } = await supabase
    .from("campaign_requests")
    .select("cm_confirm_status, needs_brand_acc, brand_acc_status, final_status, handover_done")
    .eq("id", id)
    .maybeSingle();
  if (rErr) return { ok: false, message: `Gagal membaca campaign request: ${rErr.message}` };
  if (!row) return { ok: false, message: "Campaign request tidak ditemukan." };

  const state = row as CampaignRoutingState;
  const result = campaignRoutingNext(state, event);
  if (!result.ok) return { ok: false, message: result.error };

  const next = result.next;
  const { error: uErr } = await supabase
    .from("campaign_requests")
    .update({
      cm_confirm_status: next.cm_confirm_status,
      brand_acc_status: next.brand_acc_status,
      final_status: next.final_status,
      handover_done: next.handover_done,
    })
    .eq("id", id);
  if (uErr) return { ok: false, message: `Gagal memperbarui routing: ${uErr.message}` };

  revalidatePath("/bizdev");
  return { ok: true, message: okMessage };
}

// cmConfirm: CM konfirmasi mau/tidak (event cm_mau / cm_tidak dari form 'confirm').
export async function cmConfirm(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const confirm = String(formData.get("confirm") || "");
  if (confirm !== "mau" && confirm !== "tidak") {
    return { ok: false, message: "Pilih konfirmasi 'mau' atau 'tidak'." };
  }
  const event: CampaignRoutingEvent = confirm === "mau" ? "cm_mau" : "cm_tidak";
  return runRouting(formData, event, `CM konfirmasi: ${confirm}.`);
}

// brandAcc: hasil approval brand (event brand_approve / brand_reject dari form 'acc').
export async function brandAcc(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const acc = String(formData.get("acc") || "");
  if (acc !== "approved" && acc !== "ditolak") {
    return { ok: false, message: "Pilih hasil approval brand 'approved' atau 'ditolak'." };
  }
  const event: CampaignRoutingEvent = acc === "approved" ? "brand_approve" : "brand_reject";
  return runRouting(formData, event, `Approval brand: ${acc}.`);
}

// finalizeCampaign: finalisasi fix/batal (event finalize_fix / finalize_batal dari form 'final').
export async function finalizeCampaign(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const final = String(formData.get("final") || "");
  if (final !== "fix" && final !== "batal") {
    return { ok: false, message: "Pilih finalisasi 'fix' atau 'batal'." };
  }
  const event: CampaignRoutingEvent = final === "fix" ? "finalize_fix" : "finalize_batal";
  return runRouting(formData, event, `Campaign difinalisasi: ${final}.`);
}

// handoverCampaign: handover setelah final_status 'fix'.
export async function handoverCampaign(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  return runRouting(formData, "handover", "Campaign di-handover ke CM.");
}
