"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

// Sources that require an origin campaign (mirrors leads_validate in DB).
const CAMPAIGN_REQUIRED = ["Leads-Iklan", "Broadcast", "Event", "Kulwa-Webinar", "GO-Program"];

// JS mirror of normalize_phone_id (for dedup lookup only; DB is authoritative).
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

export async function createLead(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const lead_name = String(formData.get("lead_name") || "").trim();
  const phone_raw = String(formData.get("phone_raw") || "").trim();
  const email = String(formData.get("email") || "").trim() || null;
  const source = String(formData.get("source") || "");
  const origin_campaign_id = String(formData.get("origin_campaign_id") || "") || null;

  if (!lead_name || !phone_raw || !source) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (CAMPAIGN_REQUIRED.includes(source) && !origin_campaign_id) {
    return { ok: false, message: "[kampanye asal wajib untuk sumber ini]" };
  }

  const { error } = await supabase.from("leads").insert({
    lead_name,
    phone_raw,
    email,
    source,
    origin_campaign_id,
  });

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
    return { ok: false, message: `Gagal menyimpan lead: ${error.message}` };
  }

  revalidatePath("/leads");
  return { ok: true, message: `Lead "${lead_name}" terdaftar di pool.` };
}

export async function importLeadsCsv(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const raw = String(formData.get("csv") || "").trim();
  const source = String(formData.get("source") || "");
  const origin_campaign_id = String(formData.get("origin_campaign_id") || "") || null;
  if (!raw || !source) return { ok: false, message: "Isi data CSV dan pilih sumber." };
  if (CAMPAIGN_REQUIRED.includes(source) && !origin_campaign_id) {
    return { ok: false, message: "[kampanye asal wajib untuk sumber ini]" };
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let inserted = 0;
  let skippedDup = 0;
  let failed = 0;
  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map((s) => s.trim());
    const lead_name = parts[0];
    const phone_raw = parts[1];
    const email = parts[2] || null;
    if (!lead_name || !phone_raw) {
      failed++;
      continue;
    }
    const { error } = await supabase
      .from("leads")
      .insert({ lead_name, phone_raw, email, source, origin_campaign_id });
    if (error) {
      if (error.code === "23505") skippedDup++;
      else failed++;
    } else {
      inserted++;
    }
  }

  revalidatePath("/leads");
  return {
    ok: inserted > 0,
    message: `Import selesai: ${inserted} masuk, ${skippedDup} duplikat dilewati, ${failed} baris gagal (dari ${lines.length}).`,
  };
}

export async function claimLead(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (me.division !== "BizDev" && !me.is_director) {
    return { ok: false, message: "Hanya BizDev yang dapat mengambil lead." };
  }

  const lead_id = String(formData.get("lead_id") || "");
  if (!lead_id) return { ok: false, message: "Lead tidak valid." };

  // Guard against grabbing a lead you already have an open attempt on.
  const { data: mine } = await supabase
    .from("prospect_attempts")
    .select("id")
    .eq("parent_lead_id", lead_id)
    .eq("owner_id", me.id)
    .maybeSingle();
  if (mine) return { ok: false, message: "Anda sudah punya prospek aktif untuk lead ini." };

  const { error } = await supabase
    .from("prospect_attempts")
    .insert({ parent_lead_id: lead_id, owner_id: me.id });
  if (error) return { ok: false, message: `Gagal mengambil lead: ${error.message}` };

  revalidatePath("/leads");
  return { ok: true, message: "Lead diambil — prospek [Pending Validation] dibuat." };
}

export async function advanceAttempt(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const to_status = String(formData.get("to_status") || "");
  const not_qualified_reason = String(formData.get("not_qualified_reason") || "") || null;
  if (!id || !to_status) return { ok: false, message: "Data transisi tidak lengkap." };

  const patch: Record<string, unknown> = { status: to_status };
  if (to_status === "[Not Qualified]") {
    if (!not_qualified_reason) return { ok: false, message: "[alasan tidak berkualitas wajib diisi]" };
    patch.not_qualified_reason = not_qualified_reason;
  }

  const { error } = await supabase.from("prospect_attempts").update(patch).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/leads");
  return { ok: true, message: `Prospek diubah ke ${to_status}.` };
}
