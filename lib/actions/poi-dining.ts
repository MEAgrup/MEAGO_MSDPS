"use server";

import { revalidatePath } from "next/cache";
import { ctx, canManagePoiSop } from "@/lib/actions/poi-shared";
import { isOpsName } from "@/lib/deals/intake";
import { REPORT_STATUS_OPTIONS, type ReportStatus } from "@/lib/mcn/poi-sop";

export type ActionResult = { ok: boolean; message: string };

function isReportStatus(value: string): value is ReportStatus {
  return (REPORT_STATUS_OPTIONS as readonly string[]).includes(value);
}

// updatePoiDiningCycleProgress — form siklus POI Dining Berbayar: Nama Ops
// (brand_deals, satu utk seluruh siklus deal), Tanggal Ops (poi_dining_cycles;
// trigger DB menolak jika step 6 siklus ini belum selesai), Actual VT, Total
// GMV, Link & Status Report Monthly.
export async function updatePoiDiningCycleProgress(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManagePoiSop(me)) return { ok: false, message: "Tidak berwenang mengubah tracker POI Dining." };

  const cycle_id = String(formData.get("cycle_id") || "").trim();
  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!cycle_id || !deal_id) return { ok: false, message: "Siklus POI Dining tidak valid." };

  const ops_name = String(formData.get("ops_name") || "").trim();
  if (ops_name && !isOpsName(ops_name)) return { ok: false, message: "[nama OPS tidak dikenal]" };

  // datetime-local mengirim "YYYY-MM-DDTHH:mm" tanpa offset — selalu diartikan
  // sebagai jam WIB (+07:00, tanpa DST), sama seperti updatePoiSopProgress.
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

  const actualKreatorRaw = String(formData.get("actual_kreator") || "").trim();
  let actual_kreator: number | null = null;
  if (actualKreatorRaw) {
    actual_kreator = Number(actualKreatorRaw);
    if (!Number.isInteger(actual_kreator) || actual_kreator < 0) {
      return { ok: false, message: "[Kreator Tercapai tidak valid]" };
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
  const notes = String(formData.get("notes") || "").trim() || null;

  const { error: cycleErr } = await supabase
    .from("poi_dining_cycles")
    .update({ ops_datetime, actual_kreator, actual_vt, total_gmv, report_link, report_status, notes })
    .eq("id", cycle_id);
  if (cycleErr) {
    const msg = cycleErr.message.match(/\[(.+)\]/)?.[0] ?? `Gagal menyimpan tracker POI Dining: ${cycleErr.message}`;
    return { ok: false, message: msg };
  }

  if (ops_name) {
    const { error: opsErr } = await supabase.from("brand_deals").update({ ops_name }).eq("id", deal_id);
    if (opsErr) return { ok: false, message: `Gagal menyimpan Nama Ops: ${opsErr.message}` };
  }

  revalidatePath("/bizdev/poi-dining");
  revalidatePath("/deals");
  return { ok: true, message: "Tracker POI Dining diperbarui." };
}

// completePoiDiningStep — tombol "Tandai Selesai". Step 1-5 boleh dalam urutan
// bebas; step 6-22 berurutan & baru bisa mulai setelah seluruh step 1-5
// selesai/di-skip — semua ditegakkan trigger DB (poi_dining_steps_validate,
// migrasi 0337).
export async function completePoiDiningStep(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManagePoiSop(me)) return { ok: false, message: "Tidak berwenang menandai step SOP." };

  const cycle_id = String(formData.get("cycle_id") || "").trim();
  const step_no = Number(formData.get("step_no") || "");
  if (!cycle_id || !Number.isInteger(step_no) || step_no < 1 || step_no > 22) {
    return { ok: false, message: "Step tidak valid." };
  }

  const { error } = await supabase
    .from("poi_dining_steps")
    .update({ completed_at: new Date().toISOString() })
    .eq("cycle_id", cycle_id)
    .eq("step_no", step_no);
  if (error) {
    const msg = error.message.match(/\[(.+)\]/)?.[0] ?? `Gagal menandai step: ${error.message}`;
    return { ok: false, message: msg };
  }

  revalidatePath("/bizdev/poi-dining");
  return { ok: true, message: `Step ${step_no} ditandai selesai.` };
}

// skipPoiDiningStep — "Lewati step ini" utk step 1-5 (MOU/Invoice/Payment).
// Gate di layer action ini HANYA utk pesan error yang ramah; trigger DB
// (poi_dining_steps_validate) tetap otoritas final: is_director() adalah
// satu-satunya role yang boleh mengisi skipped_at saat ini — spesifikasi
// menyebut ini akan diperluas ke role lain ke depannya.
export async function skipPoiDiningStep(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManagePoiSop(me)) return { ok: false, message: "Tidak berwenang mengubah step SOP." };
  if (!me.is_director) return { ok: false, message: "Hanya Director yang dapat melewati step ini." };

  const cycle_id = String(formData.get("cycle_id") || "").trim();
  const step_no = Number(formData.get("step_no") || "");
  if (!cycle_id || !Number.isInteger(step_no) || step_no < 1 || step_no > 5) {
    return { ok: false, message: "Step tidak valid untuk dilewati." };
  }

  const { error } = await supabase
    .from("poi_dining_steps")
    .update({ skipped_at: new Date().toISOString() })
    .eq("cycle_id", cycle_id)
    .eq("step_no", step_no);
  if (error) {
    const msg = error.message.match(/\[(.+)\]/)?.[0] ?? `Gagal melewati step: ${error.message}`;
    return { ok: false, message: msg };
  }

  revalidatePath("/bizdev/poi-dining");
  return { ok: true, message: `Step ${step_no} dilewati (disetujui Director).` };
}
