"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseRupiah, parseIntTolerant, parseFlexibleDate } from "@/lib/mcn/parsers";

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

// createProject: registrasi Special Project. Validasi tanggal (end>=start) &
// creators_needed int > 0. RLS/DB menolak non-lead (with check is_lead/is_od/is_director).
export async function createProject(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const name = String(formData.get("name") || "").trim();
  const industry_category = String(formData.get("industry_category") || "").trim();
  const startRaw = String(formData.get("start_date") || "").trim();
  const endRaw = String(formData.get("end_date") || "").trim();
  const neededRaw = String(formData.get("creators_needed") || "").trim();
  const description = String(formData.get("description") || "").trim() || null;
  const ads_budget = parseRupiah(String(formData.get("ads_budget") || ""));
  const target_gmv = parseRupiah(String(formData.get("target_gmv") || ""));

  if (!name || !industry_category || !startRaw || !endRaw || !neededRaw) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const start_date = parseFlexibleDate(startRaw);
  const end_date = parseFlexibleDate(endRaw);
  if (!start_date || !end_date) {
    return { ok: false, message: "Tanggal mulai/akhir tidak valid." };
  }
  if (end_date < start_date) {
    return { ok: false, message: "Tanggal akhir tidak boleh sebelum tanggal mulai." };
  }
  const creators_needed = parseIntTolerant(neededRaw);
  if (creators_needed === null || creators_needed <= 0) {
    return { ok: false, message: "Jumlah kreator dibutuhkan harus bilangan bulat > 0." };
  }

  const { error } = await supabase.from("special_projects").insert({
    name,
    industry_category,
    start_date,
    end_date,
    creators_needed,
    ads_budget,
    target_gmv,
    description,
  });
  if (error) return { ok: false, message: `Gagal membuat project: ${error.message}` };

  revalidatePath("/projects");
  return { ok: true, message: `Project "${name}" dibuat (draft).` };
}

// setProjectStatus: ubah status via state machine (draft/active/done/cancelled).
export async function setProjectStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  if (!id || !status) return { ok: false, message: "Data transisi tidak lengkap." };

  const { error } = await supabase.from("special_projects").update({ status }).eq("id", id);
  if (error) return { ok: false, message: `Transisi ditolak: ${error.message}` };

  revalidatePath("/projects");
  return { ok: true, message: `Status project diubah ke ${status}.` };
}

// addProjectMerchant: tambah merchant peserta (FK merchants M4). Dedup unique(project,merchant).
export async function addProjectMerchant(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const project_id = String(formData.get("project_id") || "");
  const merchant_id = String(formData.get("merchant_id") || "");
  if (!project_id || !merchant_id) return { ok: false, message: "Project & merchant wajib dipilih." };

  const { error } = await supabase
    .from("special_project_merchants")
    .insert({ project_id, merchant_id });
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Merchant sudah terdaftar di project ini." };
    return { ok: false, message: `Gagal menambah merchant: ${error.message}` };
  }

  revalidatePath("/projects");
  return { ok: true, message: "Merchant peserta ditambahkan." };
}

// removeProjectMerchant: hapus baris merchant peserta.
export async function removeProjectMerchant(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Baris merchant tidak valid." };

  const { error } = await supabase.from("special_project_merchants").delete().eq("id", id);
  if (error) return { ok: false, message: `Gagal menghapus merchant: ${error.message}` };

  revalidatePath("/projects");
  return { ok: true, message: "Merchant peserta dihapus." };
}

// assignProjectCreator: assign kreator ke project. filled_by DIPAKSA trigger DB dari
// divisi actor; hanya management yang boleh menetapkan filled_by manual (dikirim bila mgmt).
export async function assignProjectCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };

  const project_id = String(formData.get("project_id") || "");
  const mcn_creator_id = String(formData.get("mcn_creator_id") || "");
  if (!project_id || !mcn_creator_id) return { ok: false, message: "Project & kreator wajib dipilih." };

  const payload: Record<string, unknown> = { project_id, mcn_creator_id };
  // Hanya management (OD/Director) yang boleh menentukan filled_by; divisi lain dipaksa trigger.
  if (me.is_od || me.is_director) {
    const filled_by = String(formData.get("filled_by") || "").trim();
    if (filled_by) payload.filled_by = filled_by;
  }

  const { error } = await supabase.from("special_project_creators").insert(payload);
  if (error) {
    if (error.code === "23505") return { ok: false, message: "Kreator sudah ter-assign di project ini." };
    return { ok: false, message: `Gagal assign kreator: ${error.message}` };
  }

  revalidatePath("/projects");
  return { ok: true, message: "Kreator ter-assign ke project." };
}

// unassignProjectCreator: lepas kreator dari project.
export async function unassignProjectCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Baris assignment tidak valid." };

  const { error } = await supabase.from("special_project_creators").delete().eq("id", id);
  if (error) return { ok: false, message: `Gagal melepas kreator: ${error.message}` };

  revalidatePath("/projects");
  return { ok: true, message: "Kreator dilepas dari project." };
}
