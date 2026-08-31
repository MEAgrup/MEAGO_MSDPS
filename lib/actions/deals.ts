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

// canManageDeals: siapa boleh "Daftarkan Transaksi" / edit — sama seperti
// canRegister di page.tsx (mgmt/BizDev/CreatorManagement).
function canManageDeals(me: Me | null): boolean {
  return !!me && (me.is_od || me.is_director || me.division === "BizDev" || me.division === "CreatorManagement");
}

// canImportDeals: "Import Master Deal" dibatasi ke mgmt/BizDev saja.
function canImportDeals(me: Me | null): boolean {
  return !!me && (me.is_od || me.is_director || me.division === "BizDev");
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
  if (!canManageDeals(me)) return { ok: false, message: "Tidak berwenang mengedit transaksi deal." };

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

// ---- Import Master Deal -----------------------------------------------------
// Format tetap: Unique_ID, Bentuk_Kerjasama, Nominal, Benefit_Diberikan,
// Visit_Mulai, Visit_Berakhir, Jumlah_Kreator, Jumlah_Konten, Link_Brief.
// Baris yang masuk sengaja TANPA POI/BD/OPS/kategori/PIC/WhatsApp — brand_name
// diisi sementara dengan Unique_ID, kategori_poi dibiarkan kosong (jadi
// penanda "belum lengkap" di tabel Daftar Deal) sampai dilengkapi manual lewat
// "Lengkapi Data".
function splitCsvLine(line: string): string[] {
  return line.split(/[\t;,]/).map((s) => s.trim());
}

// "YYYY-MM-DD" atau "YYYY-MM-DD HH:MM" (pemisah spasi atau T) — format ketat
// sesuai catatan format di form Import Master Deal, bukan parser fleksibel.
function parseDealDateTimeCell(raw: string): { date: string; time: string } | null {
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/);
  if (!m) return null;
  return { date: m[1], time: m[2] ?? "00:00" };
}

function normalizeBentukKerjasamaCell(raw: string): "Berbayar" | "Free/Barter" | null {
  const v = raw.trim().toLowerCase();
  if (v === "berbayar") return "Berbayar";
  if (v === "free" || v === "barter" || v === "free/barter") return "Free/Barter";
  return null;
}

export async function importMasterDeal(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canImportDeals(me)) return { ok: false, message: "Tidak berwenang mengimpor master deal." };

  const raw = String(formData.get("csv") || "").trim();
  if (!raw) return { ok: false, message: "Isi data CSV." };

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let dataLines = lines;
  if (lines.length > 0 && /unique_id/i.test(lines[0])) {
    dataLines = lines.slice(1);
  }

  let inserted = 0;
  const skipped: { row: number; reason: string }[] = [];

  for (let i = 0; i < dataLines.length; i++) {
    const rowNum = i + 1;
    const cells = splitCsvLine(dataLines[i]);
    const [
      unique_id_raw,
      bentukRaw,
      nominalRaw,
      benefitRaw,
      visitMulaiRaw,
      visitBerakhirRaw,
      kreatorRaw,
      kontenRaw,
      briefRaw,
    ] = cells;

    const unique_id = (unique_id_raw ?? "").trim();
    if (!unique_id) {
      skipped.push({ row: rowNum, reason: "Unique_ID kosong" });
      continue;
    }
    const bentuk_kerjasama = normalizeBentukKerjasamaCell(bentukRaw ?? "");
    if (!bentuk_kerjasama) {
      skipped.push({ row: rowNum, reason: `Bentuk_Kerjasama tidak dikenal: "${bentukRaw ?? ""}"` });
      continue;
    }

    const nominal_harga = bentuk_kerjasama === "Free/Barter" ? 0 : parseRupiah(nominalRaw) ?? 0;
    const benefit = (benefitRaw ?? "").trim() || null;
    const visitMulai = parseDealDateTimeCell(visitMulaiRaw ?? "");
    const visitBerakhir = parseDealDateTimeCell(visitBerakhirRaw ?? "");
    const kreator_needed = parseIntTolerant(kreatorRaw ?? "");
    const konten_needed = parseIntTolerant(kontenRaw ?? "");
    const brief_link = (briefRaw ?? "").trim() || null;

    const { error } = await supabase.from("brand_deals").insert({
      brand_name: unique_id,
      unique_id,
      sourced_by_role: "bd",
      bentuk_kerjasama,
      nominal_harga,
      benefit,
      visit_start_date: visitMulai?.date ?? null,
      visit_start_time: visitMulai?.time ?? null,
      visit_end_date: visitBerakhir?.date ?? null,
      visit_end_time: visitBerakhir?.time ?? null,
      kreator_needed,
      konten_needed,
      brief_link,
    });
    if (error) {
      if (error.code === "23505") skipped.push({ row: rowNum, reason: `Unique_ID duplikat (${unique_id})` });
      else skipped.push({ row: rowNum, reason: error.message });
      continue;
    }
    inserted++;
  }

  revalidatePath("/deals");
  const preview = skipped
    .slice(0, 10)
    .map((s) => `baris ${s.row}: ${s.reason}`)
    .join("; ");
  const more = skipped.length > 10 ? ` (+${skipped.length - 10} lagi)` : "";
  return {
    ok: inserted > 0,
    message: `Import selesai: ${inserted} baris masuk (tandai "Lengkapi Data"), ${skipped.length} dilewati${
      skipped.length ? ` — ${preview}${more}` : ""
    }.`,
  };
}

// deleteDealTransaction — hapus satu transaksi deal
export async function deleteDealTransaction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageDeals(me)) return { ok: false, message: "Tidak berwenang menghapus transaksi deal." };

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
  if (!canManageDeals(me)) return { ok: false, message: "Tidak berwenang menghapus transaksi deal." };

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
