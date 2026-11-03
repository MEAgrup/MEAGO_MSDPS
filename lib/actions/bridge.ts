"use server";

// Bridge MSDPS→CDPS — server action rencana layanan CDPS (migrasi 0377).
//
// Sejak 0377 BD tidak lagi "meneruskan" deal ke CDPS dengan tombol sesudah
// Finance approve. BD cukup menyimpan RENCANA (layanan apa saja, atau "Tidak
// perlu CDPS") — kapan pun, sebelum atau sesudah pembayaran. Begitu pembayaran
// terverifikasi Finance (DP pun cukup), lib/bridge/enqueue.ts yang mengantre
// order ke cdps_outbox secara otomatis; delivery job yang mem-POST ke CDPS.
//
// TIDAK PERNAH mengirim ke CDPS inline dari sini — CDPS mati tidak boleh
// menggagalkan save-nya BD.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readCdpsPlan } from "@/lib/bridge/plan";
import { upsertCdpsPlan, tryEnqueueNow, describeEnqueue } from "@/lib/bridge/server";

export type ActionResult = { ok: boolean; message: string };

type Me = { id: string; division: string; is_od: boolean; is_director: boolean };

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, me: null as Me | null };
  const { data: me } = await supabase
    .from("employees")
    .select("id, division, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  return { supabase, user, me: me as Me | null };
}

// Cermin canManageDeals() (lib/actions/deals.ts) DAN can_manage_bridge() SQL
// (migrasi 0360) — satu wewenang, tiga salinan (TS server action, SQL RLS/trigger,
// pesan ramah) karena repo ini tidak punya lapisan domain bersama seperti CDPS.
function canManageBridge(me: Me | null): boolean {
  return !!me && (me.is_od || me.is_director || me.division === "BizDev" || me.division === "CreatorManagement");
}

// Modal "Layanan CDPS" per baris deal (/deals).
export async function saveCdpsPlan(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageBridge(me)) return { ok: false, message: "Tidak berwenang mengatur layanan CDPS." };

  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!dealId) return { ok: false, message: "Deal tidak valid." };

  const parsed = readCdpsPlan(formData);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  const { data: deal } = await supabase
    .from("brand_deals")
    .select("id, brand_name, bentuk_kerjasama")
    .eq("id", dealId)
    .maybeSingle();
  if (!deal) return { ok: false, message: "Deal tidak ditemukan." };
  if (deal.bentuk_kerjasama !== "Berbayar") {
    return { ok: false, message: "[deal free/barter tidak dikerjakan CDPS]" };
  }

  const { error } = await upsertCdpsPlan(supabase, dealId, parsed.plan);
  if (error) return { ok: false, message: error };

  const note = parsed.plan.tidak_perlu ? "" : describeEnqueue(await tryEnqueueNow(dealId));

  revalidatePath("/deals");
  return {
    ok: true,
    message: parsed.plan.tidak_perlu
      ? `${deal.brand_name} ditandai tidak perlu CDPS.`
      : `${parsed.plan.lines.length} layanan CDPS untuk ${deal.brand_name} tersimpan.${note}`,
  };
}
