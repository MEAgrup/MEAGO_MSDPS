"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { POI_SLA_FLOWS, type PoiSlaFlow } from "@/lib/mcn/poi-sop";

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
// di lib/actions/deals.ts). RLS poi_sop_step_defs (migrasi 0343/0364)
// menegakkan hal yang sama di level DB.
function canManageSla(me: Me | null): boolean {
  return !!me && me.is_director;
}

function isPoiSlaFlow(value: string): value is PoiSlaFlow {
  return (POI_SLA_FLOWS as readonly string[]).includes(value);
}

// updatePoiSlaSetting — form inline per-step di tab Setting Bizdev & Admin Ops:
// edit task, SLA (sla_days/sla_label), dan opsional (khusus flow Dining
// Berbayar). step_no/flow sendiri tidak bisa diubah dari sini (immutable —
// step baru wajib lewat addPoiSopStep supaya penomoran & propagasi konsisten).
export async function updatePoiSlaSetting(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageSla(me)) return { ok: false, message: "Hanya Director yang dapat mengatur step SOP." };

  const id = String(formData.get("id") || "").trim();
  if (!id) return { ok: false, message: "Step tidak valid." };

  const task = String(formData.get("task") || "").trim();
  if (!task) return { ok: false, message: "[task wajib diisi]" };

  const slaDaysRaw = String(formData.get("sla_days") || "").trim();
  let sla_days: number | null = null;
  if (slaDaysRaw) {
    sla_days = Number(slaDaysRaw);
    if (!Number.isInteger(sla_days) || sla_days < 0) return { ok: false, message: "[jumlah hari SLA tidak valid]" };
  }
  const sla_label = String(formData.get("sla_label") || "").trim() || null;
  const is_optional = formData.get("is_optional") === "on";

  const { error } = await supabase
    .from("poi_sop_step_defs")
    .update({ task, sla_days, sla_label, is_optional, updated_by: me.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: `Gagal menyimpan step: ${error.message}` };

  revalidatePath("/bizdev/settings");
  revalidatePath("/bizdev/poi");
  revalidatePath("/bizdev/poi-dining");
  return { ok: true, message: "Step SOP diperbarui." };
}

// setPoiSopStepActive — nonaktifkan ("Hapus") atau aktifkan kembali suatu
// step. SOFT DELETE saja — baris riwayat poi_sop_steps/poi_dining_steps yang
// sudah ada tetap utuh, cuma disembunyikan dari tampilan/hitungan aktif ke
// depannya (lihat catatan migrasi 0364).
export async function setPoiSopStepActive(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageSla(me)) return { ok: false, message: "Hanya Director yang dapat menghapus/mengaktifkan step SOP." };

  const id = String(formData.get("id") || "").trim();
  if (!id) return { ok: false, message: "Step tidak valid." };
  const active = String(formData.get("active") || "") === "true";

  const { error } = await supabase
    .from("poi_sop_step_defs")
    .update({ active, updated_by: me.id, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { ok: false, message: `Gagal menyimpan perubahan: ${error.message}` };

  revalidatePath("/bizdev/settings");
  revalidatePath("/bizdev/poi");
  revalidatePath("/bizdev/poi-dining");
  return { ok: true, message: active ? "Step diaktifkan kembali." : "Step dihapus (dinonaktifkan)." };
}

// addPoiSopStep — tambah step SOP baru ke akhir urutan flow, via RPC
// poi_sop_step_defs_add (migrasi 0364): RPC yang menghitung step_no
// berikutnya DAN menyebarkan baris step baru ke seluruh deal/siklus yang
// sudah berjalan (SECURITY DEFINER — poi_sop_steps/poi_dining_steps tidak
// punya policy INSERT untuk role authenticated).
export async function addPoiSopStep(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageSla(me)) return { ok: false, message: "Hanya Director yang dapat menambah step SOP." };

  const flow = String(formData.get("flow") || "").trim();
  if (!isPoiSlaFlow(flow)) return { ok: false, message: "[flow tidak dikenal]" };

  const task = String(formData.get("task") || "").trim();
  if (!task) return { ok: false, message: "[task wajib diisi]" };

  const slaDaysRaw = String(formData.get("sla_days") || "").trim();
  let sla_days: number | null = null;
  if (slaDaysRaw) {
    sla_days = Number(slaDaysRaw);
    if (!Number.isInteger(sla_days) || sla_days < 0) return { ok: false, message: "[jumlah hari SLA tidak valid]" };
  }
  const sla_label = String(formData.get("sla_label") || "").trim() || null;
  const is_optional = flow === "poi_dining_berbayar" && formData.get("is_optional") === "on";

  const { error } = await supabase.rpc("poi_sop_step_defs_add", {
    p_flow: flow,
    p_task: task,
    p_sla_days: sla_days,
    p_sla_label: sla_label,
    p_is_optional: is_optional,
  });
  if (error) return { ok: false, message: `Gagal menambah step: ${error.message}` };

  revalidatePath("/bizdev/settings");
  revalidatePath("/bizdev/poi");
  revalidatePath("/bizdev/poi-dining");
  return { ok: true, message: `Step baru ditambahkan ke ${flow} — otomatis muncul di deal/siklus yang sudah berjalan.` };
}
