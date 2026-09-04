"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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
