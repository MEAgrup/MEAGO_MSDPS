"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseFlexibleDate } from "@/lib/mcn/parsers";
import { addDays, parseYMD, daysInMonth, formatYMD } from "@/lib/mcn/weeks";
import { readBindingFields } from "@/lib/mcn/binding-fields";

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

type SummaryRow = { period_start: string; created_at: string; affiliate_gmv: number | null };

// Dedupe per period_start (created_at terbaru menang) lalu Σ affiliate_gmv dalam
// rentang [from, toExclusive) atau [from, toInclusive].
function sumGmv(
  rows: SummaryRow[],
  from: string,
  to: string,
  toInclusive: boolean
): number {
  const latest = new Map<string, SummaryRow>();
  for (const r of rows) {
    const existing = latest.get(r.period_start);
    if (!existing || r.created_at > existing.created_at) latest.set(r.period_start, r);
  }
  let total = 0;
  for (const r of latest.values()) {
    const inRange = r.period_start >= from && (toInclusive ? r.period_start <= to : r.period_start < to);
    if (inRange && r.affiliate_gmv !== null) total += Number(r.affiliate_gmv);
  }
  return total;
}

// Akhir kuartal kalender dari sebuah tanggal binding (string math, tanpa Date object).
function quarterEndOf(dateStr: string): string | null {
  const p = parseYMD(dateStr);
  if (!p) return null;
  const endMonth = Math.floor((p.m - 1) / 3) * 3 + 3; // 3,6,9,12
  return formatYMD(p.y, endMonth, daysInMonth(p.y, endMonth));
}

// PIC CM harus karyawan CreatorManagement yang aktif.
async function validPicCm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string
): Promise<boolean> {
  const { data } = await supabase
    .from("employees")
    .select("id, division, active")
    .eq("id", id)
    .maybeSingle();
  return !!data && data.division === "CreatorManagement" && data.active !== false;
}

// recordAcquisition: snapshot commission_share; baseline GMV 30d pre-binding (log-only);
// quarter_end kalender; specialist dipaksa trigger DB. Field binding 0382 (UID, WA,
// GMV Potential, Tgl Binding Akhir) wajib; Jenis Kontrak & PIC CM ditulis ke master
// kreator (status_kontrak / owner_cpm_id) — Akuisisi menetapkan PIC CM saat binding.
// Setelah insert, kreator prospek→binding.
export async function recordAcquisition(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const mcn_creator_id = String(formData.get("mcn_creator_id") || "");
  const bindingRaw = String(formData.get("binding_date") || "").trim();
  const lead_source = String(formData.get("lead_source") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  if (!mcn_creator_id || !bindingRaw) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const binding_date = parseFlexibleDate(bindingRaw);
  if (!binding_date) return { ok: false, message: "Tanggal binding tidak valid." };

  const bf = readBindingFields((k) => String(formData.get(k) ?? ""), binding_date);
  if ("error" in bf) return { ok: false, message: bf.error };
  const { status_kontrak, pic_cm_id, ...acqFields } = bf.fields;
  if (!(await validPicCm(supabase, pic_cm_id))) {
    return { ok: false, message: "[PIC CM harus karyawan Creator Management yang aktif]" };
  }

  const quarter_end = quarterEndOf(binding_date);

  // Snapshot commission_share dari master + status untuk transisi.
  const { data: creator, error: cErr } = await supabase
    .from("mcn_creators")
    .select("commission_share, status")
    .eq("id", mcn_creator_id)
    .maybeSingle();
  if (cErr) return { ok: false, message: `Gagal membaca kreator: ${cErr.message}` };
  const commission_share_at_binding = creator?.commission_share ?? null;

  // Baseline GMV 30 hari sebelum binding (log-only, boleh 0/null).
  const from30 = addDays(binding_date, -30);
  const { data: preRows } = await supabase
    .from("creator_period_summary")
    .select("period_start, created_at, affiliate_gmv")
    .eq("mcn_creator_id", mcn_creator_id)
    .gte("period_start", from30)
    .lt("period_start", binding_date);
  const gmv_last_30d = sumGmv((preRows ?? []) as SummaryRow[], from30, binding_date, false);

  const { error } = await supabase.from("acquisitions").insert({
    mcn_creator_id,
    lead_source,
    binding_date,
    commission_share_at_binding,
    gmv_last_30d,
    quarter_end,
    notes,
    ...acqFields,
  });
  if (error) return { ok: false, message: `Gagal mencatat akuisisi: ${error.message}` };

  // Master kreator: Jenis Kontrak + PIC CM; prospek → binding (hanya bila masih prospek).
  const { error: mErr } = await supabase
    .from("mcn_creators")
    .update({
      status_kontrak,
      owner_cpm_id: pic_cm_id,
      ...(creator?.status === "prospek" ? { status: "binding" } : {}),
    })
    .eq("id", mcn_creator_id);

  revalidatePath("/acquisition");
  revalidatePath("/meago/creators");
  if (mErr) {
    return {
      ok: false,
      message: `Akuisisi tercatat, tetapi PIC CM/jenis kontrak gagal disimpan: ${mErr.message}`,
    };
  }
  return { ok: true, message: "Akuisisi (binding) tercatat, PIC CM ditetapkan." };
}

// recordReferral: validasi source↔referrer sebelum insert (pesan ramah); DB tetap guard.
export async function recordReferral(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const new_creator_id = String(formData.get("new_creator_id") || "");
  const referral_source = String(formData.get("referral_source") || "");
  const referrer_creator_id = String(formData.get("referrer_creator_id") || "") || null;
  if (!new_creator_id || !referral_source) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  if (referral_source === "antar_creator" && !referrer_creator_id) {
    return { ok: false, message: "Referral antar-creator wajib menyertakan kreator perujuk." };
  }
  if (referral_source === "platform" && referrer_creator_id) {
    return { ok: false, message: "Referral dari platform tidak boleh punya kreator perujuk." };
  }

  const { error } = await supabase
    .from("referrals")
    .insert({ new_creator_id, referral_source, referrer_creator_id });
  if (error) return { ok: false, message: `Gagal mencatat referral: ${error.message}` };

  revalidatePath("/acquisition");
  return { ok: true, message: "Referral tercatat." };
}

// markReferralPaid: tandai commission_status='dibayar'. Trigger DB guard (sudah dibayar
// / hanya lead/management) — pesan diteruskan.
export async function markReferralPaid(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Referral tidak valid." };

  const { error } = await supabase
    .from("referrals")
    .update({ commission_status: "dibayar" })
    .eq("id", id);
  if (error) return { ok: false, message: `Gagal menandai referral dibayar: ${error.message}` };

  revalidatePath("/acquisition");
  return { ok: true, message: "Referral ditandai dibayar." };
}

// assignPicCm: Akuisisi menetapkan/mengganti PIC CM kreator SELAMA handoff belum
// selesai (sesudah handoff, penugasan ulang kembali ke CM Lead lewat Data Kreator).
export async function assignPicCm(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!(me.is_od || me.is_director || me.division === "Acquisition")) {
    return { ok: false, message: "Hanya tim Akuisisi atau management yang dapat menetapkan PIC CM di sini." };
  }

  const id = String(formData.get("id") || "");
  const pic = String(formData.get("pic_cm_id") || "");
  if (!id || !pic) return { ok: false, message: "Pilih PIC CM." };

  const { data: acq, error: aErr } = await supabase
    .from("acquisitions")
    .select("mcn_creator_id, handoff_done")
    .eq("id", id)
    .maybeSingle();
  if (aErr) return { ok: false, message: `Gagal membaca akuisisi: ${aErr.message}` };
  if (!acq) return { ok: false, message: "Akuisisi tidak ditemukan." };
  if (acq.handoff_done) {
    return { ok: false, message: "Handoff sudah selesai — penugasan ulang PIC CM lewat CM Lead." };
  }
  if (!(await validPicCm(supabase, pic))) {
    return { ok: false, message: "[PIC CM harus karyawan Creator Management yang aktif]" };
  }

  const { error } = await supabase
    .from("mcn_creators")
    .update({ owner_cpm_id: pic })
    .eq("id", acq.mcn_creator_id);
  if (error) return { ok: false, message: `Gagal menetapkan PIC CM: ${error.message}` };

  revalidatePath("/acquisition");
  revalidatePath("/meago/creators");
  return { ok: true, message: "PIC CM ditetapkan." };
}

// markHandoffDone: blok bila kreator belum punya owner_cpm_id (arahkan ke CM Lead);
// bila ada → handoff_done=true + kreator binding→aktif.
export async function markHandoffDone(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Akuisisi tidak valid." };

  const { data: acq, error: aErr } = await supabase
    .from("acquisitions")
    .select("mcn_creator_id")
    .eq("id", id)
    .maybeSingle();
  if (aErr) return { ok: false, message: `Gagal membaca akuisisi: ${aErr.message}` };
  if (!acq) return { ok: false, message: "Akuisisi tidak ditemukan." };

  const { data: creator, error: cErr } = await supabase
    .from("mcn_creators")
    .select("owner_cpm_id, status")
    .eq("id", acq.mcn_creator_id)
    .maybeSingle();
  if (cErr) return { ok: false, message: `Gagal membaca kreator: ${cErr.message}` };
  if (!creator?.owner_cpm_id) {
    return {
      ok: false,
      message: "Kreator belum punya PIC CM — tetapkan PIC CM dulu sebelum handoff.",
    };
  }

  const { error: uErr } = await supabase
    .from("acquisitions")
    .update({ handoff_done: true })
    .eq("id", id);
  if (uErr) return { ok: false, message: `Gagal menandai handoff: ${uErr.message}` };

  // Kreator binding → aktif (abaikan bila sudah aktif/transisi tak berlaku).
  if (creator.status === "binding") {
    await supabase.from("mcn_creators").update({ status: "aktif" }).eq("id", acq.mcn_creator_id);
  }

  revalidatePath("/acquisition");
  return { ok: true, message: "Handoff selesai — kreator aktif." };
}

// refreshGmvPostJoin: window dari config mcn.gmv_post_join_days. Σ affiliate_gmv per
// period_start dalam [binding, binding+window) → gmv_post_join, dan [binding, quarter_end]
// → gmv_quarter_actual.
export async function refreshGmvPostJoin(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Akuisisi tidak valid." };

  const { data: acq, error: aErr } = await supabase
    .from("acquisitions")
    .select("mcn_creator_id, binding_date, quarter_end")
    .eq("id", id)
    .maybeSingle();
  if (aErr) return { ok: false, message: `Gagal membaca akuisisi: ${aErr.message}` };
  if (!acq || !acq.binding_date) return { ok: false, message: "Akuisisi/binding_date tidak ditemukan." };

  const { data: cfg } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "mcn.gmv_post_join_days")
    .maybeSingle();
  const windowDays = cfg?.value != null ? Number(cfg.value) : 90;

  const binding = acq.binding_date as string;
  const windowEnd = addDays(binding, windowDays);

  const { data: rows, error: rErr } = await supabase
    .from("creator_period_summary")
    .select("period_start, created_at, affiliate_gmv")
    .eq("mcn_creator_id", acq.mcn_creator_id)
    .gte("period_start", binding);
  if (rErr) return { ok: false, message: `Gagal membaca ringkasan GMV: ${rErr.message}` };

  const all = (rows ?? []) as SummaryRow[];
  const gmv_post_join = sumGmv(all, binding, windowEnd, false);
  const gmv_quarter_actual = acq.quarter_end
    ? sumGmv(all, binding, acq.quarter_end as string, true)
    : null;

  const { error: uErr } = await supabase
    .from("acquisitions")
    .update({ gmv_post_join, gmv_quarter_actual })
    .eq("id", id);
  if (uErr) return { ok: false, message: `Gagal memperbarui GMV: ${uErr.message}` };

  revalidatePath("/acquisition");
  return { ok: true, message: "GMV post-join diperbarui." };
}
