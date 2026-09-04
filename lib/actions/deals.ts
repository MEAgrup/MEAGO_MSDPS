"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isBrandCategory, isDealStatus, normalizePhone62 } from "@/lib/leads/intake";
import { isBentukKerjasama, isOpsName } from "@/lib/deals/intake";
import { parseIntTolerant, parseRupiah } from "@/lib/mcn/parsers";

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

// canManageDeals: siapa boleh "Daftarkan Transaksi" (insert) — sama seperti
// canRegister di page.tsx (mgmt/BizDev/CreatorManagement).
function canManageDeals(me: Me | null): boolean {
  return !!me && (me.is_od || me.is_director || me.division === "BizDev" || me.division === "CreatorManagement");
}

// canEditDeleteDeals: Edit & Hapus transaksi deal dibatasi ke role "leader dan
// atasnya" — konsep leader lintas divisi belum ada di skema, jadi untuk saat
// ini dipakai is_director() saja (sesuai instruksi eksplisit). RLS brand_deals
// (migrasi 0341) sudah menegakkan ini juga di level DB; ini hanya utk pesan
// error yang ramah.
function canEditDeleteDeals(me: Me | null): boolean {
  return !!me && me.is_director;
}

type SupabaseClientLike = Awaited<ReturnType<typeof createClient>>;

type DealFields = {
  lead_id: string;
  bd_id: string;
  ops_name: string;
  kategori_poi: string;
  pic_name: string;
  pic_whatsapp: string;
  tanggal_mulai_kontrak: string | null;
  tanggal_akhir_kontrak: string | null;
  bentuk_kerjasama: string;
  nominal_harga: number;
  benefit: string;
  visit_start_date: string;
  visit_start_time: string;
  visit_end_date: string;
  visit_end_time: string;
  kreator_needed: number;
  konten_needed: number | null;
  total_jam_live: number | null;
  brief_link: string | null;
};

// readDealFields — validasi field form "Daftarkan Transaksi" / edit ("Lengkapi
// Data"), dipakai bersama registerDealTransaction + updateDealTransaction.
// DB (trigger brand_deals_validate, migrasi 0332/0333) tetap otoritas final —
// pengecekan di sini hanya supaya pesan errornya ramah & spesifik per-field.
async function readDealFields(
  supabase: SupabaseClientLike,
  formData: FormData
): Promise<{ fields: DealFields; brand_name: string } | { error: string }> {
  const lead_id = String(formData.get("lead_id") || "").trim();
  const bd_id = String(formData.get("bd_id") || "").trim();
  const ops_name = String(formData.get("ops_name") || "").trim();
  const kategori_poi = String(formData.get("kategori_poi") || "").trim();
  const pic_name = String(formData.get("pic_name") || "").trim();
  const pic_whatsapp_raw = String(formData.get("pic_whatsapp") || "").trim();
  const bentuk_kerjasama = String(formData.get("bentuk_kerjasama") || "").trim();
  const nominalRaw = String(formData.get("nominal_harga") || "").trim();
  const benefit = String(formData.get("benefit") || "").trim();
  const visit_mulai = String(formData.get("visit_mulai") || "").trim();
  const visit_berakhir = String(formData.get("visit_berakhir") || "").trim();
  const kreatorRaw = String(formData.get("kreator_needed") || "").trim();
  const kontenRaw = String(formData.get("konten_needed") || "").trim();
  const jamLiveRaw = String(formData.get("total_jam_live") || "").trim();
  const brief_link = String(formData.get("brief_link") || "").trim();
  const tglMulaiRaw = String(formData.get("tanggal_mulai_kontrak") || "").trim();
  const tglAkhirRaw = String(formData.get("tanggal_akhir_kontrak") || "").trim();

  if (
    !lead_id ||
    !bd_id ||
    !ops_name ||
    !kategori_poi ||
    !pic_name ||
    !pic_whatsapp_raw ||
    !bentuk_kerjasama ||
    !benefit ||
    !visit_mulai ||
    !visit_berakhir ||
    !kreatorRaw
  ) {
    return { error: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (!isBrandCategory(kategori_poi)) return { error: "[kategori POI tidak dikenal]" };
  if (!isOpsName(ops_name)) return { error: "[nama OPS tidak dikenal]" };
  if (!isBentukKerjasama(bentuk_kerjasama)) return { error: "[bentuk kerja sama tidak dikenal]" };

  if (kategori_poi === "Dining" && (!tglMulaiRaw || !tglAkhirRaw)) {
    return { error: "[tanggal awal & akhir kerjasama wajib diisi untuk kategori Dining]" };
  }

  const { data: lead } = await supabase
    .from("leads")
    .select("id, brand_name, lead_name, crm_status")
    .eq("id", lead_id)
    .maybeSingle();
  if (!lead) return { error: "[POI/Merchant tidak ditemukan]" };
  if (!isDealStatus(lead.crm_status)) {
    return { error: "[POI/Merchant harus berstatus Dealing atau Renewal]" };
  }

  const nominal_harga = bentuk_kerjasama === "Free/Barter" ? 0 : parseRupiah(nominalRaw) ?? NaN;
  if (!Number.isFinite(nominal_harga) || nominal_harga < 0) {
    return { error: "[nominal deals tidak valid]" };
  }
  if (bentuk_kerjasama === "Berbayar" && nominal_harga <= 0) {
    return { error: "[nominal deals wajib diisi untuk Berbayar]" };
  }

  const kreator_needed = parseIntTolerant(kreatorRaw) ?? NaN;
  if (!Number.isFinite(kreator_needed) || kreator_needed <= 0) {
    return { error: "[jumlah kreator tidak valid]" };
  }
  let konten_needed: number | null = null;
  if (kontenRaw) {
    konten_needed = parseIntTolerant(kontenRaw);
    if (konten_needed === null || konten_needed < 0) return { error: "[jumlah konten tidak valid]" };
  }
  let total_jam_live: number | null = null;
  if (jamLiveRaw) {
    total_jam_live = Number(jamLiveRaw);
    if (!Number.isFinite(total_jam_live) || total_jam_live < 0) {
      return { error: "[total jam live tidak valid]" };
    }
  }

  const [visitMulaiDate, visitMulaiTime] = visit_mulai.split("T");
  const [visitBerakhirDate, visitBerakhirTime] = visit_berakhir.split("T");
  if (!visitMulaiDate || !visitMulaiTime || !visitBerakhirDate || !visitBerakhirTime) {
    return { error: "[visit dimulai/berakhir tidak valid]" };
  }
  if (visitBerakhirDate < visitMulaiDate) {
    return { error: "[tanggal selesai visit tidak boleh sebelum tanggal mulai]" };
  }

  const pic_whatsapp = normalizePhone62(pic_whatsapp_raw);
  if (!pic_whatsapp) return { error: "[nomor WhatsApp tidak valid]" };

  return {
    brand_name: lead.brand_name ?? lead.lead_name,
    fields: {
      lead_id,
      bd_id,
      ops_name,
      kategori_poi,
      pic_name,
      pic_whatsapp,
      tanggal_mulai_kontrak: kategori_poi === "Dining" ? tglMulaiRaw : null,
      tanggal_akhir_kontrak: kategori_poi === "Dining" ? tglAkhirRaw : null,
      bentuk_kerjasama,
      nominal_harga,
      benefit,
      visit_start_date: visitMulaiDate,
      visit_start_time: visitMulaiTime,
      visit_end_date: visitBerakhirDate,
      visit_end_time: visitBerakhirTime,
      kreator_needed,
      konten_needed,
      total_jam_live,
      brief_link: brief_link || null,
    },
  };
}

// registerDealTransaction — form "Daftarkan Transaksi" (tab Merchant Deals).
export async function registerDealTransaction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageDeals(me)) return { ok: false, message: "Tidak berwenang mendaftarkan transaksi deal." };

  const parsed = await readDealFields(supabase, formData);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  const sourced_by_role = me.division === "CreatorManagement" && !(me.is_od || me.is_director) ? "cm" : "bd";

  const { data: deal, error } = await supabase
    .from("brand_deals")
    .insert({ brand_name: parsed.brand_name, sourced_by_role, ...parsed.fields })
    .select("id, code")
    .single();
  if (error) return { ok: false, message: `Gagal menyimpan transaksi: ${error.message}` };

  revalidatePath("/deals");
  revalidatePath("/leads");
  return { ok: true, message: `Transaksi deal ${deal.code} — ${parsed.brand_name} tersimpan.` };
}

// updateDealTransaction — edit transaksi, termasuk jalur "Lengkapi Data" untuk
// baris hasil Import Master Deal (kategori_poi dkk masih kosong).
export async function updateDealTransaction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canEditDeleteDeals(me)) return { ok: false, message: "Hanya Director yang dapat mengedit transaksi deal." };

  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!deal_id) return { ok: false, message: "Deal tidak valid." };

  const parsed = await readDealFields(supabase, formData);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  const { error } = await supabase
    .from("brand_deals")
    .update({ brand_name: parsed.brand_name, ...parsed.fields })
    .eq("id", deal_id);
  if (error) return { ok: false, message: `Gagal menyimpan perubahan: ${error.message}` };

  revalidatePath("/deals");
  revalidatePath("/leads");
  return { ok: true, message: "Transaksi deal diperbarui." };
}

// deleteDealTransaction — hapus satu transaksi deal
export async function deleteDealTransaction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canEditDeleteDeals(me)) return { ok: false, message: "Hanya Director yang dapat menghapus transaksi deal." };

  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!deal_id) return { ok: false, message: "Deal tidak valid." };

  const { error } = await supabase.from("brand_deals").delete().eq("id", deal_id);
  if (error) return { ok: false, message: `Gagal menghapus transaksi: ${error.message}` };

  revalidatePath("/deals");
  revalidatePath("/leads");
  return { ok: true, message: "Transaksi deal dihapus." };
}

// deleteDealTransactionsBulk — hapus multiple transaksi deals
export async function deleteDealTransactionsBulk(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canEditDeleteDeals(me)) return { ok: false, message: "Hanya Director yang dapat menghapus transaksi deal." };

  const deal_ids = formData.getAll("deal_ids") as string[];
  if (deal_ids.length === 0) return { ok: false, message: "Pilih deal yang akan dihapus." };

  const { error } = await supabase.from("brand_deals").delete().in("id", deal_ids);
  if (error) return { ok: false, message: `Gagal menghapus transaksi: ${error.message}` };

  revalidatePath("/deals");
  revalidatePath("/leads");
  return { ok: true, message: `${deal_ids.length} transaksi deal dihapus.` };
}

// setPipelineStage — DIPAKAI BizDev Workspace (app/(app)/bizdev), bukan lagi
// oleh tab Merchant Deals sendiri (pipeline_stage tidak lagi ditampilkan di
// sana) — JANGAN dihapus.
export async function setPipelineStage(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  const pipeline_stage = String(formData.get("pipeline_stage") || "").trim();
  if (!id || !pipeline_stage) return { ok: false, message: "Deal & stage wajib diisi." };

  const { error } = await supabase.from("brand_deals").update({ pipeline_stage }).eq("id", id);
  if (error) return { ok: false, message: `Gagal memindah stage: ${error.message}` };

  revalidatePath("/deals");
  revalidatePath("/bizdev");
  return { ok: true, message: `Pipeline stage → ${pipeline_stage}.` };
}
