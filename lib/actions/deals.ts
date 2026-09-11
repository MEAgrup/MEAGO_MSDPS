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

// canEditDeleteDeals: siapa boleh MENERAPKAN Edit & Hapus transaksi deal
// langsung — dibatasi ke role "leader dan atasnya"; konsep leader lintas
// divisi belum ada di skema, jadi untuk saat ini dipakai is_director() saja
// (sesuai instruksi eksplisit). RLS brand_deals (migrasi 0341/0348) sudah
// menegakkan ini juga di level DB; ini hanya utk pesan error yang ramah.
function canEditDeleteDeals(me: Me | null): boolean {
  return !!me && me.is_director;
}

// canRequestDealChange: BD/CM boleh MENGAJUKAN edit/hapus (tombol "Edit",
// "Lengkapi Data", "Hapus" muncul lagi untuk mereka), tapi hasilnya menunggu
// approval Director — lihat migrasi 0349 (deal_change_requests).
function canRequestDealChange(me: Me | null): boolean {
  return canManageDeals(me) && !canEditDeleteDeals(me);
}

// Field form "Daftarkan Transaksi" apa adanya (belum dinormalisasi) — dipakai
// sebagai payload permintaan approval, supaya saat Director menyetujui,
// validasinya diulang lewat readDealFields() yang sama persis, bukan percaya
// nilai yang sudah tersimpan di DB.
const DEAL_FORM_KEYS = [
  "lead_id",
  "bd_id",
  "ops_name",
  "kategori_poi",
  "pic_name",
  "pic_whatsapp",
  "bentuk_kerjasama",
  "nominal_harga",
  "benefit",
  "visit_mulai",
  "visit_berakhir",
  "kreator_needed",
  "konten_needed",
  "total_jam_live",
  "brief_link",
  "tanggal_mulai_kontrak",
  "tanggal_akhir_kontrak",
] as const;

export type DealFormSnapshot = Partial<Record<(typeof DEAL_FORM_KEYS)[number], string>>;

function dealFormSnapshot(formData: FormData): DealFormSnapshot {
  const snapshot: DealFormSnapshot = {};
  for (const key of DEAL_FORM_KEYS) snapshot[key] = String(formData.get(key) ?? "").trim();
  return snapshot;
}

function formDataFromSnapshot(payload: unknown): FormData {
  const formData = new FormData();
  const obj = (payload ?? {}) as Record<string, unknown>;
  for (const key of DEAL_FORM_KEYS) formData.set(key, String(obj[key] ?? ""));
  return formData;
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

// createPoiFinance (B0, bridge MSDPS→CDPS Fase 1) — menyambungkan
// create_poi_finance() (SQL, sudah ada di staging+production sejak
// 0352_reconcile_function_drift.sql, direbut oleh apa pun sampai sekarang)
// ke UI. Fungsi SQL sudah memuat gerbang dan pesan BI-nya sendiri
// ([deal ini bukan deal POI], [deal ini bukan kerjasama berbayar], [transaksi
// untuk deal ini sudah dibuat]) — diteruskan apa adanya, RLS/RPC tetap
// penjaga terakhir (dipanggil lewat sesi pengguna, bukan service-role).
// Nol SQL baru: satu-satunya yang kurang selama ini adalah pemanggilnya.
export async function createPoiFinance(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageDeals(me)) return { ok: false, message: "Tidak berwenang membuat transaksi Finance." };

  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!dealId) return { ok: false, message: "Deal tidak valid." };
  const paymentIntent = String(formData.get("payment_intent") ?? "Lunas");

  const { data, error } = await supabase.rpc("create_poi_finance", {
    p_deal_id: dealId,
    p_payment_intent: paymentIntent,
  });
  if (error) return { ok: false, message: error.message };

  revalidatePath("/deals");
  return { ok: true, message: `Transaksi Finance ${data as string} dibuat — verifikasi lewat halaman Finance.` };
}

// dealLabels — snapshot kode & nama POI utk baris deal_change_requests, supaya
// permintaan "Hapus" yang sudah disetujui tetap terbaca setelah deal-nya hilang.
async function dealLabels(
  supabase: SupabaseClientLike,
  dealIds: string[]
): Promise<Map<string, { code: string | null; brand_name: string }>> {
  const { data } = await supabase.from("brand_deals").select("id, code, brand_name").in("id", dealIds);
  return new Map(
    ((data as { id: string; code: string | null; brand_name: string }[] | null) ?? []).map((d) => [
      d.id,
      { code: d.code, brand_name: d.brand_name },
    ])
  );
}

// Pesan error insert antrian approval yang ramah — pelanggaran yang paling
// mungkin terjadi adalah unique index deal_change_requests_one_pending.
function requestInsertError(message: string): string {
  if (message.includes("deal_change_requests_one_pending")) {
    return "Sudah ada permintaan perubahan yang menunggu approval Director untuk deal ini.";
  }
  return `Gagal mengirim permintaan: ${message}`;
}

// updateDealTransaction — edit transaksi, termasuk jalur "Lengkapi Data" untuk
// baris hasil Import Master Deal (kategori_poi dkk masih kosong).
// Director menerapkan langsung; BD/CM masuk antrian approval (migrasi 0349).
export async function updateDealTransaction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canEditDeleteDeals(me) && !canRequestDealChange(me)) {
    return { ok: false, message: "Tidak berwenang mengubah transaksi deal." };
  }

  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!deal_id) return { ok: false, message: "Deal tidak valid." };

  const parsed = await readDealFields(supabase, formData);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  if (!canEditDeleteDeals(me)) {
    const label = (await dealLabels(supabase, [deal_id])).get(deal_id);
    if (!label) return { ok: false, message: "Deal tidak ditemukan." };
    const { error } = await supabase.from("deal_change_requests").insert({
      deal_id,
      deal_code: label.code,
      deal_brand_name: label.brand_name,
      action: "update",
      payload: dealFormSnapshot(formData),
      requested_by: me.id,
    });
    if (error) return { ok: false, message: requestInsertError(error.message) };

    revalidatePath("/deals");
    return {
      ok: true,
      message: "Perubahan dikirim ke Director untuk disetujui — data belum berubah sampai di-accept.",
    };
  }

  const { error } = await supabase
    .from("brand_deals")
    .update({ brand_name: parsed.brand_name, ...parsed.fields })
    .eq("id", deal_id);
  if (error) return { ok: false, message: `Gagal menyimpan perubahan: ${error.message}` };

  revalidatePath("/deals");
  revalidatePath("/leads");
  return { ok: true, message: "Transaksi deal diperbarui." };
}

// deleteDealTransaction — hapus satu transaksi deal (Director), atau ajukan
// penghapusan untuk disetujui Director (BD/CM).
export async function deleteDealTransaction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canEditDeleteDeals(me) && !canRequestDealChange(me)) {
    return { ok: false, message: "Tidak berwenang menghapus transaksi deal." };
  }

  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!deal_id) return { ok: false, message: "Deal tidak valid." };

  if (!canEditDeleteDeals(me)) {
    const label = (await dealLabels(supabase, [deal_id])).get(deal_id);
    if (!label) return { ok: false, message: "Deal tidak ditemukan." };
    const { error } = await supabase.from("deal_change_requests").insert({
      deal_id,
      deal_code: label.code,
      deal_brand_name: label.brand_name,
      action: "delete",
      requested_by: me.id,
    });
    if (error) return { ok: false, message: requestInsertError(error.message) };

    revalidatePath("/deals");
    return {
      ok: true,
      message: "Permintaan hapus dikirim ke Director — deal belum dihapus sampai di-accept.",
    };
  }

  const { error } = await supabase.from("brand_deals").delete().eq("id", deal_id);
  if (error) return { ok: false, message: `Gagal menghapus transaksi: ${error.message}` };

  revalidatePath("/deals");
  revalidatePath("/leads");
  return { ok: true, message: "Transaksi deal dihapus." };
}

// deleteDealTransactionsBulk — hapus multiple transaksi deals (Director), atau
// ajukan penghapusannya sekaligus untuk disetujui Director (BD/CM).
export async function deleteDealTransactionsBulk(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canEditDeleteDeals(me) && !canRequestDealChange(me)) {
    return { ok: false, message: "Tidak berwenang menghapus transaksi deal." };
  }

  const deal_ids = formData.getAll("deal_ids") as string[];
  if (deal_ids.length === 0) return { ok: false, message: "Pilih deal yang akan dihapus." };

  if (!canEditDeleteDeals(me)) {
    const labels = await dealLabels(supabase, deal_ids);
    const rows = deal_ids
      .filter((id) => labels.has(id))
      .map((id) => ({
        deal_id: id,
        deal_code: labels.get(id)!.code,
        deal_brand_name: labels.get(id)!.brand_name,
        action: "delete" as const,
        requested_by: me.id,
      }));
    if (rows.length === 0) return { ok: false, message: "Deal tidak ditemukan." };
    const { error } = await supabase.from("deal_change_requests").insert(rows);
    if (error) return { ok: false, message: requestInsertError(error.message) };

    revalidatePath("/deals");
    return {
      ok: true,
      message: `${rows.length} permintaan hapus dikirim ke Director — deal belum dihapus sampai di-accept.`,
    };
  }

  const { error } = await supabase.from("brand_deals").delete().in("id", deal_ids);
  if (error) return { ok: false, message: `Gagal menghapus transaksi: ${error.message}` };

  revalidatePath("/deals");
  revalidatePath("/leads");
  return { ok: true, message: `${deal_ids.length} transaksi deal dihapus.` };
}

// ---------------------------------------------------------------------------
// Antrian approval Director (deal_change_requests, migrasi 0349)
// ---------------------------------------------------------------------------

type ChangeRequestRow = {
  id: string;
  deal_id: string | null;
  deal_brand_name: string;
  action: "update" | "delete";
  payload: unknown;
  status: string;
};

// approveDealChangeRequest — Director meng-accept permintaan BD/CM. Perubahan
// diterapkan LEWAT SESI DIRECTOR INI, jadi RLS brand_deals (director-only)
// tetap jadi penjaga terakhir; payload divalidasi ulang dari nol dengan
// readDealFields() yang sama seperti saat form disubmit.
export async function approveDealChangeRequest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canEditDeleteDeals(me)) {
    return { ok: false, message: "Hanya Director yang dapat menyetujui perubahan transaksi deal." };
  }

  const request_id = String(formData.get("request_id") || "").trim();
  if (!request_id) return { ok: false, message: "Permintaan tidak valid." };

  const { data: reqRaw } = await supabase
    .from("deal_change_requests")
    .select("id, deal_id, deal_brand_name, action, payload, status")
    .eq("id", request_id)
    .maybeSingle();
  const req = reqRaw as ChangeRequestRow | null;
  if (!req) return { ok: false, message: "Permintaan tidak ditemukan." };
  if (req.status !== "pending") return { ok: false, message: "Permintaan ini sudah ditinjau." };
  if (!req.deal_id) return { ok: false, message: "Deal terkait sudah tidak ada." };

  if (req.action === "update") {
    const parsed = await readDealFields(supabase, formDataFromSnapshot(req.payload));
    if ("error" in parsed) return { ok: false, message: `Permintaan tidak lagi valid: ${parsed.error}` };

    const { error } = await supabase
      .from("brand_deals")
      .update({ brand_name: parsed.brand_name, ...parsed.fields })
      .eq("id", req.deal_id);
    if (error) return { ok: false, message: `Gagal menerapkan perubahan: ${error.message}` };
  } else {
    const { error } = await supabase.from("brand_deals").delete().eq("id", req.deal_id);
    if (error) return { ok: false, message: `Gagal menghapus transaksi: ${error.message}` };
  }

  // Ditandai SETELAH perubahan diterapkan: kalau update/delete-nya gagal,
  // permintaan tetap pending dan bisa dicoba lagi — bukan hilang diam-diam.
  const { error: markErr } = await supabase
    .from("deal_change_requests")
    .update({
      status: "approved",
      reviewed_by: me.id,
      reviewed_at: new Date().toISOString(),
      review_note: String(formData.get("review_note") || "").trim() || null,
    })
    .eq("id", request_id);
  if (markErr) {
    return {
      ok: false,
      message: `Perubahan sudah diterapkan, tapi status permintaan gagal diperbarui: ${markErr.message}`,
    };
  }

  revalidatePath("/deals");
  revalidatePath("/leads");
  revalidatePath("/bizdev/poi");
  revalidatePath("/bizdev/poi-dining");
  return {
    ok: true,
    message:
      req.action === "update"
        ? `Perubahan ${req.deal_brand_name} disetujui & diterapkan.`
        : `Penghapusan ${req.deal_brand_name} disetujui & diterapkan.`,
  };
}

// rejectDealChangeRequest — Director menolak; data deal tidak disentuh.
export async function rejectDealChangeRequest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canEditDeleteDeals(me)) {
    return { ok: false, message: "Hanya Director yang dapat menolak perubahan transaksi deal." };
  }

  const request_id = String(formData.get("request_id") || "").trim();
  if (!request_id) return { ok: false, message: "Permintaan tidak valid." };

  const { error } = await supabase
    .from("deal_change_requests")
    .update({
      status: "rejected",
      reviewed_by: me.id,
      reviewed_at: new Date().toISOString(),
      review_note: String(formData.get("review_note") || "").trim() || null,
    })
    .eq("id", request_id)
    .eq("status", "pending");
  if (error) return { ok: false, message: `Gagal menolak permintaan: ${error.message}` };

  revalidatePath("/deals");
  return { ok: true, message: "Permintaan ditolak." };
}

// cancelDealChangeRequest — pemohon menarik kembali permintaannya sendiri
// selama belum ditinjau (RLS deal_change_requests_delete).
export async function cancelDealChangeRequest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };

  const request_id = String(formData.get("request_id") || "").trim();
  if (!request_id) return { ok: false, message: "Permintaan tidak valid." };

  const { error } = await supabase
    .from("deal_change_requests")
    .delete()
    .eq("id", request_id)
    .eq("status", "pending");
  if (error) return { ok: false, message: `Gagal membatalkan permintaan: ${error.message}` };

  revalidatePath("/deals");
  return { ok: true, message: "Permintaan dibatalkan." };
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
