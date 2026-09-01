"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isOpsName } from "@/lib/deals/intake";
import { REPORT_STATUS_OPTIONS, type ReportStatus } from "@/lib/mcn/poi-sop";

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

// canManagePoiSop: sama seperti gate tab "BizDev Workspace" (mgmt/BizDev).
function canManagePoiSop(me: Me | null): boolean {
  return !!me && (me.is_od || me.is_director || me.division === "BizDev");
}

function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUS_OPTIONS as readonly string[]).includes(value);
}

// updatePoiSopProgress — form card POI Accommodation/TTD: Nama Ops (brand_deals),
// Tanggal Ops, Actual VT, Total GMV, Link & Status Report Monthly (poi_sop_progress).
export async function updatePoiSopProgress(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManagePoiSop(me)) return { ok: false, message: "Tidak berwenang mengubah tracker POI." };

  const progress_id = String(formData.get("progress_id") || "").trim();
  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!progress_id || !deal_id) return { ok: false, message: "Transaksi POI tidak valid." };

  const ops_name = String(formData.get("ops_name") || "").trim();
  if (ops_name && !isOpsName(ops_name)) return { ok: false, message: "[nama OPS tidak dikenal]" };

  // datetime-local mengirim "YYYY-MM-DDTHH:mm" tanpa offset — selalu diartikan
  // sebagai jam WIB (+07:00, tanpa DST) apa pun timezone server, bukan diparse
  // apa adanya (yang akan bergantung timezone lokal proses Node).
  const ops_datetime_raw = String(formData.get("ops_datetime") || "").trim();
  let ops_datetime: string | null = null;
  if (ops_datetime_raw) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ops_datetime_raw)) {
      return { ok: false, message: "[tanggal ops tidak valid]" };
    }
    ops_datetime = `${ops_datetime_raw}:00+07:00`;
    if (Number.isNaN(new Date(ops_datetime).getTime())) {
      return { ok: false, message: "[tanggal ops tidak valid]" };
    }
  }

  const actualVtRaw = String(formData.get("actual_vt") || "").trim();
  let actual_vt: number | null = null;
  if (actualVtRaw) {
    actual_vt = Number(actualVtRaw);
    if (!Number.isFinite(actual_vt) || actual_vt < 0) return { ok: false, message: "[Actual VT tidak valid]" };
  }

  const totalGmvRaw = String(formData.get("total_gmv") || "").trim();
  let total_gmv: number | null = null;
  if (totalGmvRaw) {
    total_gmv = Number(totalGmvRaw);
    if (!Number.isFinite(total_gmv) || total_gmv < 0) return { ok: false, message: "[Total GMV tidak valid]" };
  }

  const report_link = String(formData.get("report_link") || "").trim() || null;
  const report_status_raw = String(formData.get("report_status") || "").trim();
  const report_status = report_status_raw ? (isReportStatus(report_status_raw) ? report_status_raw : undefined) : null;
  if (report_status === undefined) return { ok: false, message: "[status report tidak dikenal]" };

  const { error: progressErr } = await supabase
    .from("poi_sop_progress")
    .update({ ops_datetime, actual_vt, total_gmv, report_link, report_status })
    .eq("id", progress_id);
  if (progressErr) return { ok: false, message: `Gagal menyimpan tracker POI: ${progressErr.message}` };

  if (ops_name) {
    const { error: opsErr } = await supabase.from("brand_deals").update({ ops_name }).eq("id", deal_id);
    if (opsErr) return { ok: false, message: `Gagal menyimpan Nama Ops: ${opsErr.message}` };
  }

  revalidatePath("/bizdev/poi");
  revalidatePath("/deals");
  return { ok: true, message: "Tracker POI diperbarui." };
}

// completePoiSopStep — tombol "Tandai Selesai" per step. Urutan & imutabilitas
// ditegakkan trigger DB (poi_sop_steps_validate, migrasi 0336) — pesan error di
// sini hanya meneruskan alasan penolakan DB.
export async function completePoiSopStep(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManagePoiSop(me)) return { ok: false, message: "Tidak berwenang menandai step SOP." };

  const progress_id = String(formData.get("progress_id") || "").trim();
  const step_no = Number(formData.get("step_no") || "");
  if (!progress_id || !Number.isInteger(step_no) || step_no < 1 || step_no > 15) {
    return { ok: false, message: "Step tidak valid." };
  }

  const { error } = await supabase
    .from("poi_sop_steps")
    .update({ completed_at: new Date().toISOString() })
    .eq("progress_id", progress_id)
    .eq("step_no", step_no);
  if (error) {
    const msg = error.message.match(/\[(.+)\]/)?.[0] ?? `Gagal menandai step: ${error.message}`;
    return { ok: false, message: msg };
  }

  revalidatePath("/bizdev/poi");
  return { ok: true, message: `Step ${step_no} ditandai selesai.` };
}
