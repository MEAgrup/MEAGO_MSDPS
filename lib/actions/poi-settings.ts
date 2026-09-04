"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

type Me = { id: string; division: string; rank: string | null; is_od: boolean; is_director: boolean };

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, me: null as Me | null };
  const { data: me } = await supabase
    .from("employees")
    .select("id, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  return { supabase, user, me: me as Me | null };
}

// canManageSla: tab "Setting Bizdev & Admin Ops" — role leader dan atasnya;
// untuk saat ini dipakai is_director() saja (sama seperti canEditDeleteDeals
// di lib/actions/deals.ts). RLS poi_sla_settings (migrasi 0343) menegakkan
// hal yang sama di level DB.
function canManageSla(me: Me | null): boolean {
  return !!me && me.is_director;
}

// updatePoiSlaSetting — form inline per-step di tab Setting Bizdev & Admin Ops.
// Step/task sendiri tidak bisa diubah dari sini — hanya sla_days & sla_label.
export async function updatePoiSlaSetting(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageSla(me)) return { ok: false, message: "Hanya Director yang dapat mengatur SLA." };

  const id = String(formData.get("id") || "").trim();
  if (!id) return { ok: false, message: "SLA tidak valid." };

  const slaDaysRaw = String(formData.get("sla_days") || "").trim();
  let sla_days: number | null = null;
  if (slaDaysRaw) {
    sla_days = Number(slaDaysRaw);
    if (!Number.isInteger(sla_days) || sla_days < 0) return { ok: false, message: "[jumlah hari SLA tidak valid]" };
  }
  const sla_label = String(formData.get("sla_label") || "").trim() || null;

  const { error } = await supabase
    .from("poi_sla_settings")
    .update({ sla_days, sla_label, updated_by: me.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: `Gagal menyimpan SLA: ${error.message}` };

  revalidatePath("/bizdev/settings");
  revalidatePath("/bizdev/poi");
  revalidatePath("/bizdev/poi-dining");
  return { ok: true, message: "SLA diperbarui." };
}
