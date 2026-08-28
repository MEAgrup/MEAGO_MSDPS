"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  isApproachVia,
  isBrandCategory,
  isCrmStatus,
  isDealStatus,
  isHasilApproach,
  isIntakeSource,
  isWilayah,
  normalizePhone62,
  RENEWAL_REQUIRES_STATUS,
} from "@/lib/leads/intake";

export type ActionResult = { ok: boolean; message: string };

// Sumber yang mewajibkan kampanye asal (mirror leads_validate di DB). Hanya
// berlaku untuk jalur impor CSV — form intake BD tidak memakai kampanye.
const CAMPAIGN_REQUIRED = ["Leads-Iklan", "Broadcast", "Event", "Kulwa-Webinar", "GO-Program"];

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

// Sama seperti canRegister di page.tsx — akses kelola Pool Lead (edit/hapus/update
// status) dibatasi ke tim yang boleh mendaftarkan lead: BizDev, Marketing, Director.
function canManage(me: { division: string; is_director: boolean } | null): boolean {
  return !!me && (me.division === "BizDev" || me.division === "Marketing" || me.is_director);
}

// Ambil & validasi field intake BD yang dipakai bersama createLead + updateLeadFields.
// Mengembalikan null (dengan message di errOut) kalau ada yang tidak valid.
function readIntakeFields(formData: FormData): { fields: Record<string, unknown> } | { error: string } {
  const brand_name = String(formData.get("brand_name") || "").trim();
  const brand_category = String(formData.get("brand_category") || "");
  const business_type = String(formData.get("business_type") || "").trim();
  const wilayah = String(formData.get("wilayah") || "");
  const source = String(formData.get("source") || "");
  const pic_name_position = String(formData.get("pic_name_position") || "").trim();
  const pic_phone_raw = String(formData.get("pic_phone") || "");
  const web_socmed_link = String(formData.get("web_socmed_link") || "").trim();

  if (!brand_name) {
    return { error: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (brand_category && !isBrandCategory(brand_category)) {
    return { error: "[kategori brand tidak dikenal]" };
  }
  if (business_type && !brand_category) {
    return { error: "[kategori brand wajib dipilih sebelum jenis usaha]" };
  }
  if (wilayah && !isWilayah(wilayah)) {
    return { error: "[wilayah tidak dikenal]" };
  }
  if (source && !isIntakeSource(source)) {
    return { error: "[source tidak dikenal]" };
  }

  return {
    fields: {
      brand_name,
      brand_category: brand_category || null,
      business_type: business_type || null,
      wilayah: wilayah || null,
      source: source || null,
      pic_name_position: pic_name_position || null,
      pic_phone: normalizePhone62(pic_phone_raw),
      web_socmed_link: web_socmed_link || null,
    },
  };
}

// Intake lead BD (tab Leads & Prospek → "Daftarkan Lead"). Wajib: Nama BD +
// Brand/Merchant/POI. Sisanya opsional — DB (0330/0331) yang jadi otoritas
// validasi; pengecekan di sini hanya supaya pesan errornya ramah. Status awal
// selalu "Leads" (dipaksa trigger DB, apa pun yang dikirim dari sini).
export async function createLead(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const bd_employee_id = String(formData.get("bd_employee_id") || "");
  if (!bd_employee_id) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const parsed = readIntakeFields(formData);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  // lead_name sengaja tidak dikirim: trigger DB menurunkannya dari brand_name.
  const { error } = await supabase.from("leads").insert({ bd_employee_id, ...parsed.fields });

  if (error) return { ok: false, message: `Gagal menyimpan lead: ${error.message}` };

  revalidatePath("/leads");
  return { ok: true, message: `Lead "${parsed.fields.brand_name}" terdaftar di pool.` };
}

// Edit data intake dari kolom Aksi tabel Pool Lead. Tidak menyentuh crm_status —
// perubahan status hanya lewat tombol "Update Status Leads" (updateLeadStatus).
export async function updateLeadFields(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManage(me)) return { ok: false, message: "Tidak berwenang mengedit lead." };

  const lead_id = String(formData.get("lead_id") || "");
  if (!lead_id) return { ok: false, message: "Lead tidak valid." };

  const bd_employee_id = String(formData.get("bd_employee_id") || "");
  if (!bd_employee_id) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const parsed = readIntakeFields(formData);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  const { error } = await supabase
    .from("leads")
    .update({ bd_employee_id, ...parsed.fields })
    .eq("id", lead_id);
  if (error) return { ok: false, message: `Gagal menyimpan perubahan: ${error.message}` };

  revalidatePath("/leads");
  return { ok: true, message: "Perubahan lead disimpan." };
}

// Tombol "Update Status Leads". Renewal hanya boleh dari Dealing (ditegakkan
// ulang di DB); Benefit Dealing & Nominal Bayar hanya wajib/terkirim saat status
// Dealing/Renewal.
export async function updateLeadStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManage(me)) return { ok: false, message: "Tidak berwenang mengubah status lead." };

  const lead_id = String(formData.get("lead_id") || "");
  const crm_status = String(formData.get("crm_status") || "");
  if (!lead_id || !crm_status) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (!isCrmStatus(crm_status)) return { ok: false, message: "[status tidak dikenal]" };

  const approach_via = String(formData.get("approach_via") || "");
  if (approach_via && !isApproachVia(approach_via)) {
    return { ok: false, message: "[approach via tidak dikenal]" };
  }
  const hasil_approach = String(formData.get("hasil_approach") || "");
  if (hasil_approach && !isHasilApproach(hasil_approach)) {
    return { ok: false, message: "[hasil approach tidak dikenal]" };
  }

  const patch: Record<string, unknown> = {
    crm_status,
    approach_via: approach_via || null,
    hasil_approach: hasil_approach || null,
    notes: String(formData.get("notes") || "").trim() || null,
    tanggal_mulai_kontrak: String(formData.get("tanggal_mulai_kontrak") || "") || null,
    tanggal_akhir_kontrak: String(formData.get("tanggal_akhir_kontrak") || "") || null,
  };

  if (isDealStatus(crm_status)) {
    const benefit_dealing = String(formData.get("benefit_dealing") || "").trim();
    if (!benefit_dealing) {
      return { ok: false, message: "[benefit dealing wajib diisi untuk status Dealing/Renewal]" };
    }
    const nominalRaw = String(formData.get("nominal_bayar") || "").trim();
    if (nominalRaw === "") {
      return { ok: false, message: "[nominal bayar wajib diisi — tulis 0 jika barter/gratis]" };
    }
    const nominal_bayar = Number(nominalRaw.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(nominal_bayar) || nominal_bayar < 0) {
      return { ok: false, message: "[nominal bayar tidak valid]" };
    }
    patch.benefit_dealing = benefit_dealing;
    patch.nominal_bayar = nominal_bayar;
  }

  if (crm_status === "Renewal") {
    // Pengecekan ramah di sini; DB (leads_validate) tetap otoritas final.
    const { data: current } = await supabase
      .from("leads")
      .select("crm_status")
      .eq("id", lead_id)
      .maybeSingle();
    if (current?.crm_status !== RENEWAL_REQUIRES_STATUS) {
      return { ok: false, message: "[Renewal hanya dapat dipilih dari status Dealing]" };
    }
  }

  const { error } = await supabase.from("leads").update(patch).eq("id", lead_id);
  if (error) return { ok: false, message: `Gagal mengubah status: ${error.message}` };

  revalidatePath("/leads");
  return { ok: true, message: `Status lead diubah ke ${crm_status}.` };
}

export async function deleteLead(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManage(me)) return { ok: false, message: "Tidak berwenang menghapus lead." };

  const lead_id = String(formData.get("lead_id") || "");
  if (!lead_id) return { ok: false, message: "Lead tidak valid." };

  const { error } = await supabase.from("leads").delete().eq("id", lead_id);
  if (error) {
    const msg =
      error.code === "23503"
        ? "Tidak bisa dihapus — lead ini sudah punya prospek terkait."
        : `Gagal menghapus lead: ${error.message}`;
    return { ok: false, message: msg };
  }

  revalidatePath("/leads");
  return { ok: true, message: "Lead dihapus." };
}

// Hapus massal dari checkbox tabel Pool Lead. ids dikirim sebagai beberapa
// input name="lead_ids" (satu per checkbox yang dicentang).
export async function deleteLeadsBulk(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManage(me)) return { ok: false, message: "Tidak berwenang menghapus lead." };

  const ids = formData.getAll("lead_ids").map(String).filter(Boolean);
  if (ids.length === 0) return { ok: false, message: "Pilih minimal satu lead untuk dihapus." };

  const { error, count } = await supabase.from("leads").delete({ count: "exact" }).in("id", ids);
  if (error) {
    const msg =
      error.code === "23503"
        ? "Sebagian lead tidak bisa dihapus karena sudah punya prospek terkait."
        : `Gagal menghapus lead terpilih: ${error.message}`;
    return { ok: false, message: msg };
  }

  revalidatePath("/leads");
  return { ok: true, message: `${count ?? ids.length} lead dihapus.` };
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
