// Helper dipakai bersama lib/actions/poi.ts (tab POI Accommodation & TTD) dan
// lib/actions/poi-dining.ts (tab POI Dining). Modul terpisah TANPA "use server"
// karena setiap export di file "use server" wajib berupa Server Action async —
// canManagePoiSop sinkron, jadi tidak bisa ikut di file yang sama.
import { createClient } from "@/lib/supabase/server";

export type Me = { id: string; division: string; rank: string | null; is_od: boolean; is_director: boolean };

export async function ctx() {
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

// canManagePoiSop: sama seperti gate tab "BizDev Workspace" (mgmt/BizDev).
export function canManagePoiSop(me: Me | null): boolean {
  return !!me && (me.is_od || me.is_director || me.division === "BizDev");
}
