"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

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

// updateAppConfig: ubah value jsonb utk satu key app_config. Hanya OD/Director
// (RLS DB juga menegakkan). value divalidasi via JSON.parse sebelum disimpan.
export async function updateAppConfig(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!(me.is_od || me.is_director)) {
    return { ok: false, message: "Hanya OD/Director yang dapat mengubah konfigurasi." };
  }

  const key = String(formData.get("key") || "").trim();
  const valueRaw = String(formData.get("value") || "").trim();
  if (!key || valueRaw === "") {
    return { ok: false, message: "Key dan value wajib diisi." };
  }

  let value: unknown;
  try {
    value = JSON.parse(valueRaw);
  } catch {
    return { ok: false, message: "Value harus JSON valid (mis. 0.15, 20, atau {\"low\":180000})." };
  }

  const { error } = await supabase
    .from("app_config")
    .update({ value, updated_by: me.id, updated_at: new Date().toISOString() })
    .eq("key", key);
  if (error) return { ok: false, message: `Gagal menyimpan konfigurasi: ${error.message}` };

  // /management pensiun 2026-09-12 (nisan statis); app_config kini dibaca /okr.
  revalidatePath("/okr");
  return { ok: true, message: `Konfigurasi "${key}" diperbarui.` };
}
