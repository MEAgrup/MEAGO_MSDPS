"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  CRM_STATUSES,
  DEAL_STATUSES,
  KATEGORI_BRAND,
  MANUAL,
  type CrmStatus,
} from "@/lib/crm/options";

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

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

// Select "Nama BD" mengirim UUID karyawan ATAU sentinel MANUAL + input teks bebas.
// Nama disimpan sebagai text (jejak historis tetap terbaca meski karyawan keluar),
// bd_id hanya terisi bila BD dipilih dari direktori.
async function resolveEmployee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pick: string,
  manual: string
): Promise<{ name: string; id: string | null }> {
  if (pick && pick !== MANUAL) {
    const { data } = await supabase
      .from("employees")
      .select("id, full_name")
      .eq("id", pick)
      .maybeSingle();
    if (data) return { name: data.full_name, id: data.id };
  }
  return { name: manual, id: null };
}

// Pesan error DB dikembalikan apa adanya: trigger 0321 sudah berbahasa Indonesia
// dan diapit [ ] sesuai konvensi Phase 0.
function dbError(prefix: string, message: string): ActionResult {
  return { ok: false, message: `${prefix}: ${message}` };
}

// ---------------------------------------------------------------------------
// 1. FORMS LEADS MASUK — input lead baru (status awal 'Leads')
// ---------------------------------------------------------------------------
export async function createCrmLead(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const bd = await resolveEmployee(supabase, str(formData, "bd_pick"), str(formData, "nama_bd_manual"));
  const brand = str(formData, "brand");
  const kategoriBrand = str(formData, "kategori_brand");

  if (!bd.name || !brand) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (!(KATEGORI_BRAND as readonly string[]).includes(kategoriBrand)) {
    return { ok: false, message: "[kategori brand tidak valid]" };
  }

  const jenisPick = str(formData, "jenis_usaha");
  const jenisUsaha = jenisPick === MANUAL ? str(formData, "jenis_usaha_manual") : jenisPick;

  const { data, error } = await supabase
    .from("crm_leads")
    .insert({
      nama_bd: bd.name,
      bd_id: bd.id,
      brand,
      kategori_brand: kategoriBrand,
      jenis_usaha: jenisUsaha || null,
      source: str(formData, "source") || null,
      wilayah: str(formData, "wilayah") || null,
      nama_pic: str(formData, "nama_pic") || null,
      kontak_pic: str(formData, "kontak_pic") || null,
      website_socmed: str(formData, "website_socmed") || null,
    })
    .select("code")
    .maybeSingle();

  if (error) return dbError("Gagal menyimpan lead", error.message);

  revalidatePath("/leads");
  revalidatePath("/deals");
  return {
    ok: true,
    message: `Lead "${brand}" tersimpan${data?.code ? ` dengan ID ${data.code}` : ""} — status awal Leads.`,
  };
}

// ---------------------------------------------------------------------------
// 2. UPDATE STATUS — ubah status lead + data dealing/kontrak bila relevan
// ---------------------------------------------------------------------------
export async function updateCrmLeadStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = str(formData, "id");
  const status = str(formData, "status") as CrmStatus;
  if (!id) return { ok: false, message: "Lead tidak dipilih." };
  if (!(CRM_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, message: "[status tidak valid]" };
  }

  const isDeal = DEAL_STATUSES.includes(status);

  const patch: Record<string, unknown> = {
    status,
    approach_via: str(formData, "approach_via") || null,
    hasil_approach: str(formData, "hasil_approach") || null,
  };

  if (isDeal) {
    const benefitPick = str(formData, "benefit_dealing");
    const benefit = benefitPick === MANUAL ? str(formData, "benefit_dealing_manual") : benefitPick;
    if (!benefit) {
      return { ok: false, message: `[benefit dealing wajib diisi untuk status ${status}]` };
    }

    const mulai = str(formData, "tanggal_mulai_kontrak");
    const akhir = str(formData, "tanggal_akhir_kontrak");
    if (!!mulai !== !!akhir) {
      return {
        ok: false,
        message: "[durasi kontrak harus diisi lengkap: tanggal awal dan tanggal akhir]",
      };
    }
    if (mulai && akhir && mulai > akhir) {
      return { ok: false, message: "[tanggal awal kontrak tidak boleh melebihi tanggal akhir]" };
    }

    const nominalRaw = str(formData, "nominal_bayar");
    const nominal = nominalRaw === "" ? 0 : Number(nominalRaw);
    if (!Number.isFinite(nominal) || nominal < 0) {
      return { ok: false, message: "[nominal bayar tidak valid]" };
    }

    patch.benefit_dealing = benefit;
    patch.nominal_bayar = nominal;
    patch.tanggal_mulai_kontrak = mulai || null;
    patch.tanggal_akhir_kontrak = akhir || null;
    patch.notes_kontrak = str(formData, "notes_kontrak") || null;
  }

  const { error } = await supabase.from("crm_leads").update(patch).eq("id", id);
  if (error) return dbError("Gagal update status", error.message);

  revalidatePath("/leads");
  revalidatePath("/deals");
  return { ok: true, message: `Status lead diubah ke ${status}.` };
}

// ---------------------------------------------------------------------------
// 3. EDIT DATA LEAD — perbaikan isi form tanpa menyentuh status
// ---------------------------------------------------------------------------
export async function updateCrmLeadProfile(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = str(formData, "id");
  if (!id) return { ok: false, message: "Lead tidak dipilih." };

  const bd = await resolveEmployee(supabase, str(formData, "bd_pick"), str(formData, "nama_bd_manual"));
  const brand = str(formData, "brand");
  const kategoriBrand = str(formData, "kategori_brand");

  if (!bd.name || !brand) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (!(KATEGORI_BRAND as readonly string[]).includes(kategoriBrand)) {
    return { ok: false, message: "[kategori brand tidak valid]" };
  }

  const jenisPick = str(formData, "jenis_usaha");
  const jenisUsaha = jenisPick === MANUAL ? str(formData, "jenis_usaha_manual") : jenisPick;

  const { error } = await supabase
    .from("crm_leads")
    .update({
      nama_bd: bd.name,
      bd_id: bd.id,
      brand,
      kategori_brand: kategoriBrand,
      jenis_usaha: jenisUsaha || null,
      source: str(formData, "source") || null,
      wilayah: str(formData, "wilayah") || null,
      nama_pic: str(formData, "nama_pic") || null,
      kontak_pic: str(formData, "kontak_pic") || null,
      website_socmed: str(formData, "website_socmed") || null,
    })
    .eq("id", id);

  if (error) return dbError("Gagal memperbarui lead", error.message);

  revalidatePath("/leads");
  revalidatePath("/deals");
  return { ok: true, message: "Data lead berhasil diperbarui." };
}

// ---------------------------------------------------------------------------
// 4. IMPORT BULK LEADS — satu lead per baris
// ---------------------------------------------------------------------------
// Kolom (pemisah tab / ; / ,), sama urutan dengan importBulk() Apps Script:
//   nama_bd, brand, kategori_brand, wilayah, jenis_usaha, source,
//   nama_pic, kontak_pic, website_socmed
export async function importCrmLeadsBulk(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const raw = str(formData, "bulk");
  if (!raw) return { ok: false, message: "Konten teks bulk kosong." };

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  for (const line of lines) {
    const parts = (line.includes("\t") ? line.split("\t") : line.split(/[;,]/)).map((p) => p.trim());
    const namaBd = parts[0] ?? "";
    const brand = parts[1] ?? "";
    // nama_bd & brand adalah kolom wajib — baris tanpa keduanya dilewati
    // (bukan digagalkan) supaya satu baris rusak tidak membatalkan seluruh impor.
    if (!namaBd || !brand) {
      skipped++;
      continue;
    }
    const kategori = parts[2] ?? "";
    rows.push({
      nama_bd: namaBd,
      brand,
      kategori_brand: (KATEGORI_BRAND as readonly string[]).includes(kategori)
        ? kategori
        : "Accommodation",
      wilayah: parts[3] || null,
      jenis_usaha: parts[4] || null,
      source: parts[5] || null,
      nama_pic: parts[6] || null,
      kontak_pic: parts[7] || null,
      website_socmed: parts[8] || null,
    });
  }

  if (rows.length === 0) {
    return { ok: false, message: `Tidak ada baris valid (${skipped} baris dilewati).` };
  }

  // Insert baris-per-baris: trigger ID (next_code) dan validasi berjalan per row,
  // dan satu baris gagal tidak boleh membatalkan sisanya.
  let inserted = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const { error } = await supabase.from("crm_leads").insert(row);
    if (error) {
      if (errors.length < 3) errors.push(`${row.brand}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  revalidatePath("/leads");
  revalidatePath("/deals");
  const failed = rows.length - inserted;
  return {
    ok: inserted > 0,
    message:
      `Impor selesai: ${inserted} lead masuk, ${failed} gagal, ${skipped} baris dilewati ` +
      `(dari ${lines.length} baris).` +
      (errors.length > 0 ? `\nContoh error: ${errors.join(" | ")}` : ""),
  };
}

// ---------------------------------------------------------------------------
// 5. HAPUS LEAD — RLS membatasi ke Lead/SPV BizDev + management
// ---------------------------------------------------------------------------
export async function deleteCrmLead(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = str(formData, "id");
  if (!id) return { ok: false, message: "Lead tidak dipilih." };

  // Lead yang sudah punya transaksi tidak boleh dihapus (FK on delete restrict
  // sudah menjaga, tapi pesannya lebih jelas bila dicek di sini).
  const { count } = await supabase
    .from("crm_transaksi")
    .select("id", { count: "exact", head: true })
    .eq("crm_lead_id", id);
  if ((count ?? 0) > 0) {
    return {
      ok: false,
      message: `Lead tidak bisa dihapus: sudah punya ${count} transaksi tercatat.`,
    };
  }

  const { error } = await supabase.from("crm_leads").delete().eq("id", id);
  if (error) return dbError("Gagal menghapus lead", error.message);

  revalidatePath("/leads");
  revalidatePath("/deals");
  return { ok: true, message: "Lead berhasil dihapus." };
}
