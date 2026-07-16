"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseCommission, parseFlexibleDate, parseRupiah } from "@/lib/mcn/parsers";

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

// registerDeal: form registrasi deal tervalidasi. fieldErrors dikumpulkan lalu digabung
// jadi satu pesan terstruktur. shop_id (bila diisi) numeric-only + cek duplikat dulu.
// Produk dinamis dibaca dari entries product_name_0.., mewarisi niche/exp/komisi deal.
export async function registerDeal(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const brand_name = String(formData.get("brand_name") || "").trim();
  const shop_id = String(formData.get("shop_id") || "").trim() || null;
  const merchant_id = String(formData.get("merchant_id") || "").trim() || null;
  const niche = String(formData.get("niche") || "").trim() || null;
  const brand_link = String(formData.get("brand_link") || "").trim() || null;
  const campaign_name = String(formData.get("campaign_name") || "").trim() || null;
  const campaign_id = String(formData.get("campaign_id") || "").trim() || null;
  const pic_tap = String(formData.get("pic_tap") || "").trim() || null;
  const expRaw = String(formData.get("exp_date") || "").trim();
  const komisiKreatorRaw = String(formData.get("komisi_kreator") || "").trim();
  const komisiMeaRaw = String(formData.get("komisi_mea") || "").trim();
  const sourced_by_role = String(formData.get("sourced_by_role") || "").trim() || "bd";

  const fieldErrors: Record<string, string> = {};

  if (!brand_name) fieldErrors.brand_name = "brand wajib diisi (persis nama tampilan platform)";

  // shop_id: numeric-only bila diisi + cek duplikat sebelum insert.
  if (shop_id !== null && !/^[0-9]+$/.test(shop_id)) {
    fieldErrors.shop_id = "shop ID harus angka saja";
  } else if (shop_id !== null) {
    const { data: dup } = await supabase
      .from("brand_deals")
      .select("code, brand_name")
      .eq("shop_id", shop_id)
      .maybeSingle();
    if (dup) fieldErrors.shop_id = `shop ID sudah dipakai deal ${dup.code} — ${dup.brand_name}`;
  }

  // exp_date wajib valid.
  let exp_date: string | null = null;
  if (!expRaw) {
    fieldErrors.exp_date = "tanggal exp wajib diisi";
  } else {
    exp_date = parseFlexibleDate(expRaw);
    if (!exp_date) fieldErrors.exp_date = "tanggal exp tidak valid";
  }

  // Komisi kreator (opsional; bila diisi wajib parse & 0-100, max>=min).
  let komisi_kreator_raw: string | null = null;
  let komisi_kreator_pct: number | null = null;
  if (komisiKreatorRaw) {
    const c = parseCommission(komisiKreatorRaw);
    if (!c) fieldErrors.komisi_kreator = "komisi kreator tidak valid (0-100, max>=min)";
    else {
      komisi_kreator_raw = c.raw;
      komisi_kreator_pct = c.pct;
    }
  }
  let komisi_mea_raw: string | null = null;
  let komisi_mea_pct: number | null = null;
  if (komisiMeaRaw) {
    const c = parseCommission(komisiMeaRaw);
    if (!c) fieldErrors.komisi_mea = "komisi MEA tidak valid (0-100, max>=min)";
    else {
      komisi_mea_raw = c.raw;
      komisi_mea_pct = c.pct;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    const detail = Object.entries(fieldErrors)
      .map(([f, msg]) => `• ${f}: ${msg}`)
      .join("\n");
    return { ok: false, message: `Registrasi deal gagal — perbaiki:\n${detail}` };
  }

  const { data: deal, error } = await supabase
    .from("brand_deals")
    .insert({
      brand_name,
      shop_id,
      merchant_id,
      niche,
      brand_link,
      campaign_name,
      campaign_id,
      exp_date,
      komisi_kreator_raw,
      komisi_kreator_pct,
      komisi_mea_raw,
      komisi_mea_pct,
      pic_tap,
      sourced_by_role,
    })
    .select("id, code")
    .single();
  if (error) {
    if (error.code === "23505") return { ok: false, message: "shop ID sudah terdaftar di deal lain." };
    return { ok: false, message: `Gagal menyimpan deal: ${error.message}` };
  }

  // Produk dinamis: product_name_0, product_id_0, product_link_0, product_niche_0, ...
  const products: Record<string, unknown>[] = [];
  for (let i = 0; formData.has(`product_name_${i}`); i++) {
    const pname = String(formData.get(`product_name_${i}`) || "").trim();
    if (!pname) continue;
    const pNicheRaw = String(formData.get(`product_niche_${i}`) || "").trim();
    const pExpRaw = String(formData.get(`product_exp_${i}`) || "").trim();
    const pKomisiRaw = String(formData.get(`product_komisi_${i}`) || "").trim();
    const pExp = pExpRaw ? parseFlexibleDate(pExpRaw) : null;
    const pKomisi = pKomisiRaw ? parseCommission(pKomisiRaw) : null;
    products.push({
      deal_id: deal.id,
      product_name: pname,
      product_id: String(formData.get(`product_id_${i}`) || "").trim() || null,
      product_link: String(formData.get(`product_link_${i}`) || "").trim() || null,
      // Produk mewarisi niche/exp/komisi deal bila kosong.
      niche: pNicheRaw || niche,
      exp_date: pExp ?? exp_date,
      komisi_kreator_pct: pKomisi ? pKomisi.pct : komisi_kreator_pct,
    });
  }
  let productMsg = "";
  if (products.length > 0) {
    const { error: pErr } = await supabase.from("deal_products").insert(products);
    productMsg = pErr
      ? ` (deal tersimpan, namun ${products.length} produk gagal: ${pErr.message})`
      : ` + ${products.length} produk`;
  }

  revalidatePath("/deals");
  return { ok: true, message: `Deal ${deal.code} — ${brand_name} terdaftar${productMsg}.` };
}

// Alias header legacy → field kanonik (termasuk typo nyata `nama_campiagn`, `nama_bd`, `ads`).
const LEGACY_HEADER_ALIASES: Record<string, string> = {
  brand: "brand_name",
  "nama brand": "brand_name",
  nama_brand: "brand_name",
  brand_name: "brand_name",
  merchant: "brand_name",
  "shop id": "shop_id",
  shop_id: "shop_id",
  shopid: "shop_id",
  "id toko": "shop_id",
  "nama campiagn": "campaign_name",
  nama_campiagn: "campaign_name",
  "nama campaign": "campaign_name",
  nama_campaign: "campaign_name",
  campaign: "campaign_name",
  campaign_name: "campaign_name",
  "nama_bd": "pic_name",
  "nama bd": "pic_name",
  bd: "pic_name",
  pic: "pic_name",
  exp: "exp_date",
  "exp date": "exp_date",
  exp_date: "exp_date",
  expired: "exp_date",
  "tanggal exp": "exp_date",
  komisi: "komisi_kreator",
  "komisi kreator": "komisi_kreator",
  komisi_kreator: "komisi_kreator",
  commission: "komisi_kreator",
  "komisi mea": "komisi_mea",
  komisi_mea: "komisi_mea",
  niche: "niche",
  kategori: "niche",
  ads: "ads_budget",
  "ads budget": "ads_budget",
  ads_budget: "ads_budget",
  budget: "ads_budget",
};

function resolveLegacyHeader(raw: string): string | null {
  const key = raw.toLowerCase().trim().replace(/\s+/g, " ");
  return LEGACY_HEADER_ALIASES[key] ?? null;
}

function splitLegacy(line: string): string[] {
  return line.split(/[\t;,]/).map((s) => s.trim());
}

// importLegacyDeals: paste textarea → split manual. JANGAN PERNAH crash/tolak baris.
// Probe baris header (skip judul non-header); field kotor → null + review_flags jsonb;
// expired tetap insert (active_flag false via trigger); duplikat shop_id → skip.
export async function importLegacyDeals(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const raw = String(formData.get("data") || "").trim();
  if (!raw) return { ok: false, message: "Tempel data legacy dulu." };

  const lines = raw.split(/\r?\n/).map((l) => l.trimEnd());
  const skipped: { row: number; reason: string }[] = [];

  // Cari baris header: baris pertama dgn >=2 sel yang cocok alias header.
  let headerFields: (string | null)[] | null = null;
  let dataStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const cells = splitLegacy(lines[i]);
    const mapped = cells.map(resolveLegacyHeader);
    const matched = mapped.filter((m) => m !== null).length;
    if (matched >= 2) {
      headerFields = mapped;
      dataStart = i + 1;
      break;
    }
    skipped.push({ row: i + 1, reason: "baris judul/non-header dilewati" });
  }

  if (!headerFields) {
    return { ok: false, message: "Header tidak dikenali — tidak ada baris yang bisa diimpor." };
  }

  let inserted = 0;
  for (let i = dataStart; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const rowNum = i + 1;
    const cells = splitLegacy(lines[i]);

    const values: Record<string, string> = {};
    for (let c = 0; c < headerFields.length; c++) {
      const field = headerFields[c];
      if (!field) continue;
      const v = (cells[c] ?? "").trim();
      if (v !== "" && !(field in values)) values[field] = v; // kolom pertama menang
    }

    const brand_name = values["brand_name"] ?? "";
    if (!brand_name) {
      skipped.push({ row: rowNum, reason: "brand_name kosong" });
      continue;
    }

    const review_flags: Record<string, unknown> = {};

    // shop_id: numeric-only; kotor → null + flag.
    let shop_id: string | null = null;
    if (values["shop_id"]) {
      if (/^[0-9]+$/.test(values["shop_id"])) shop_id = values["shop_id"];
      else review_flags.shop_id = `nilai kotor diabaikan: "${values["shop_id"]}"`;
    }

    // exp_date: invalid → null + flag (expired tetap insert via trigger active_flag).
    let exp_date: string | null = null;
    if (values["exp_date"]) {
      exp_date = parseFlexibleDate(values["exp_date"]);
      if (!exp_date) review_flags.exp_date = `tanggal tak terparse: "${values["exp_date"]}"`;
    }

    let komisi_kreator_raw: string | null = null;
    let komisi_kreator_pct: number | null = null;
    if (values["komisi_kreator"]) {
      const c = parseCommission(values["komisi_kreator"]);
      if (c) {
        komisi_kreator_raw = c.raw;
        komisi_kreator_pct = c.pct;
      } else review_flags.komisi_kreator = `komisi tak terparse: "${values["komisi_kreator"]}"`;
    }
    let komisi_mea_raw: string | null = null;
    let komisi_mea_pct: number | null = null;
    if (values["komisi_mea"]) {
      const c = parseCommission(values["komisi_mea"]);
      if (c) {
        komisi_mea_raw = c.raw;
        komisi_mea_pct = c.pct;
      } else review_flags.komisi_mea = `komisi tak terparse: "${values["komisi_mea"]}"`;
    }

    let ads_budget: number | null = null;
    if (values["ads_budget"]) {
      ads_budget = parseRupiah(values["ads_budget"]);
      if (ads_budget === null) review_flags.ads_budget = `nominal tak terparse: "${values["ads_budget"]}"`;
    }
    if (values["pic_name"]) review_flags.pic_name = values["pic_name"]; // nama BD tak bisa dipetakan ke uuid

    const { error } = await supabase.from("brand_deals").insert({
      brand_name,
      shop_id,
      niche: values["niche"] ?? null,
      campaign_name: values["campaign_name"] ?? null,
      exp_date,
      komisi_kreator_raw,
      komisi_kreator_pct,
      komisi_mea_raw,
      komisi_mea_pct,
      ads_budget,
      sourced_by_role: "bd",
      review_flags: Object.keys(review_flags).length > 0 ? review_flags : null,
    });
    if (error) {
      if (error.code === "23505") skipped.push({ row: rowNum, reason: `shop_id duplikat (${shop_id})` });
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
    message: `Import legacy: ${inserted} deal masuk, ${skipped.length} dilewati${
      skipped.length ? ` — ${preview}${more}` : ""
    }.`,
  };
}

// setPipelineStage: ubah pipeline_stage (ter-audit otomatis via trigger).
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

// ============================================================================
// POI Dealing — dealing BD dengan venue/POI (TTD/Accomodation/Dining) untuk
// visit kreator (program MEA GO). Baris brand_deals dgn kategori_poi terisi.
// ============================================================================

export const KATEGORI_POI_OPTIONS = ["TTD", "Accomodation", "Dining"] as const;
export const BENTUK_KERJASAMA_OPTIONS = ["Free", "Berbayar"] as const;
export const PAYMENT_INTENT_OPTIONS = [
  "Lunas",
  "Bayar Sebagian",
  "Termin",
  "Bayar di Belakang",
] as const;

// registerPoiDeal: registrasi deal POI (venue/merchant utk visit kreator), field
// persis urutan Google Form BD. bd_id = BD yang login. poin TIDAK PERNAH dikirim
// (derived, dihitung trigger). Bila Berbayar & insert sukses -> panggil RPC
// create_poi_finance; kegagalan RPC TIDAK membatalkan deal (deal tetap tersimpan,
// pesan kembali berisi peringatan + alasan).
export async function registerPoiDeal(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const nama_poi = String(formData.get("nama_poi") || "").trim();
  const kategori_poi = String(formData.get("kategori_poi") || "").trim();
  const pic_name = String(formData.get("pic_name") || "").trim();
  const pic_whatsapp = String(formData.get("pic_whatsapp") || "").trim();
  const bentuk_kerjasama = String(formData.get("bentuk_kerjasama") || "").trim();
  const nominalRaw = String(formData.get("nominal_harga") || "").trim();
  const payment_intent_raw = String(formData.get("payment_intent") || "").trim();
  const benefit = String(formData.get("benefit") || "").trim() || null;
  const visit_start_date = String(formData.get("visit_start_date") || "").trim();
  const visit_start_time = String(formData.get("visit_start_time") || "").trim();
  const visit_end_date = String(formData.get("visit_end_date") || "").trim();
  const visit_end_time = String(formData.get("visit_end_time") || "").trim();
  const kreatorRaw = String(formData.get("kreator_needed") || "").trim();
  const kontenRaw = String(formData.get("konten_needed") || "").trim();
  const brief_link = String(formData.get("brief_link") || "").trim() || null;

  const fieldErrors: Record<string, string> = {};

  if (!nama_poi) fieldErrors.nama_poi = "nama POI wajib diisi";
  if (!KATEGORI_POI_OPTIONS.includes(kategori_poi as (typeof KATEGORI_POI_OPTIONS)[number])) {
    fieldErrors.kategori_poi = "kategori POI wajib dipilih";
  }
  if (!pic_name) fieldErrors.pic_name = "nama PIC wajib diisi";
  if (!pic_whatsapp) fieldErrors.pic_whatsapp = "no. WhatsApp PIC wajib diisi";
  if (
    !BENTUK_KERJASAMA_OPTIONS.includes(
      bentuk_kerjasama as (typeof BENTUK_KERJASAMA_OPTIONS)[number]
    )
  ) {
    fieldErrors.bentuk_kerjasama = "bentuk kerjasama wajib dipilih (Free/Berbayar)";
  }

  let nominal_harga: number | null = null;
  let payment_intent: string | null = null;
  if (bentuk_kerjasama === "Berbayar") {
    nominal_harga = nominalRaw ? parseRupiah(nominalRaw) : null;
    if (nominal_harga === null || !(nominal_harga > 0)) {
      fieldErrors.nominal_harga =
        "nominal harga wajib diisi & lebih dari 0 untuk kerjasama Berbayar";
    }
    payment_intent = payment_intent_raw || "Lunas";
    if (!PAYMENT_INTENT_OPTIONS.includes(payment_intent as (typeof PAYMENT_INTENT_OPTIONS)[number])) {
      fieldErrors.payment_intent = "metode pembayaran tidak valid";
    }
  }

  // benefit wajib diisi utk deal POI (ditegakkan juga oleh trigger DB).
  if (!benefit) fieldErrors.benefit = "benefit wajib dipilih";

  if (!visit_start_date) fieldErrors.visit_start_date = "tanggal visit mulai wajib diisi";
  if (!visit_start_time) fieldErrors.visit_start_time = "jam visit mulai wajib diisi";
  if (!visit_end_date) fieldErrors.visit_end_date = "tanggal visit berakhir wajib diisi";
  if (!visit_end_time) fieldErrors.visit_end_time = "jam visit berakhir wajib diisi";
  if (visit_start_date && visit_end_date && visit_end_date < visit_start_date) {
    fieldErrors.visit_end_date = "tanggal berakhir tidak boleh sebelum tanggal mulai";
  }

  const kreator_needed = kreatorRaw ? parseInt(kreatorRaw, 10) : NaN;
  if (!kreatorRaw || !Number.isFinite(kreator_needed) || kreator_needed <= 0) {
    fieldErrors.kreator_needed = "jumlah kreator dibutuhkan wajib diisi angka > 0";
  }
  const konten_needed = kontenRaw ? parseInt(kontenRaw, 10) : NaN;
  if (!kontenRaw || !Number.isFinite(konten_needed) || konten_needed <= 0) {
    fieldErrors.konten_needed = "jumlah konten dibutuhkan wajib diisi angka > 0";
  }

  if (Object.keys(fieldErrors).length > 0) {
    const detail = Object.entries(fieldErrors)
      .map(([f, msg]) => `• ${f}: ${msg}`)
      .join("\n");
    return { ok: false, message: `Input Deal POI gagal — perbaiki:\n${detail}` };
  }

  const { data: deal, error } = await supabase
    .from("brand_deals")
    .insert({
      brand_name: nama_poi,
      kategori_poi,
      pic_name,
      pic_whatsapp,
      bentuk_kerjasama,
      nominal_harga,
      benefit,
      visit_start_date,
      visit_start_time,
      visit_end_date,
      visit_end_time,
      kreator_needed,
      konten_needed,
      brief_link,
      bd_id: user.id,
      sourced_by_role: "bd",
    })
    .select("id, code")
    .single();
  if (error) return { ok: false, message: `Gagal menyimpan Deal POI: ${error.message}` };

  let trxMsg = "";
  if (bentuk_kerjasama === "Berbayar") {
    const { data: trx, error: trxErr } = await supabase.rpc("create_poi_finance", {
      p_deal_id: deal.id,
      p_payment_intent: payment_intent,
    });
    trxMsg = trxErr
      ? ` Peringatan: transaksi gagal dibuat otomatis — ${trxErr.message}. Deal tetap tersimpan, gunakan tombol "Buat Transaksi" pada baris ini.`
      : ` Transaksi ${trx} dibuat.`;
  }

  revalidatePath("/deals");
  return { ok: true, message: `Deal POI ${deal.code} — ${nama_poi} terdaftar.${trxMsg}` };
}

// updatePoiRealisasi: isi/perbarui realisasi visit POI (boleh diisi semua tim
// yang bisa melihat halaman deal). Field kosong dikirim null ke RPC.
export async function updatePoiRealisasi(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Deal tidak ditemukan." };

  const listingRaw = String(formData.get("listing_date") || "").trim();
  const visitRaw = String(formData.get("visit_realized_date") || "").trim();
  const kreatorRaw = String(formData.get("kreator_realized") || "").trim();
  const videoRaw = String(formData.get("video_realized") || "").trim();
  const p_visit_checked = formData.get("visit_checked") === "on";

  let p_kreator_realized: number | null = null;
  if (kreatorRaw) {
    p_kreator_realized = parseInt(kreatorRaw, 10);
    if (!Number.isFinite(p_kreator_realized) || p_kreator_realized < 0) {
      return { ok: false, message: "Kreator realized harus angka >= 0." };
    }
  }
  let p_video_realized: number | null = null;
  if (videoRaw) {
    p_video_realized = parseInt(videoRaw, 10);
    if (!Number.isFinite(p_video_realized) || p_video_realized < 0) {
      return { ok: false, message: "Video realized harus angka >= 0." };
    }
  }

  const { error } = await supabase.rpc("update_poi_realisasi", {
    p_deal_id: id,
    p_listing_date: listingRaw || null,
    p_visit_realized_date: visitRaw || null,
    p_kreator_realized,
    p_video_realized,
    p_visit_checked,
  });
  if (error) return { ok: false, message: `Gagal menyimpan realisasi: ${error.message}` };

  revalidatePath("/deals");
  return { ok: true, message: "Realisasi Deal POI tersimpan." };
}

// createPoiFinanceAction: buat transaksi utk deal POI Berbayar lama yang belum
// punya transaction_id (RPC juga dipakai otomatis di registerPoiDeal).
export async function createPoiFinanceAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Deal tidak ditemukan." };
  const payment_intent = String(formData.get("payment_intent") || "").trim() || "Lunas";
  if (!PAYMENT_INTENT_OPTIONS.includes(payment_intent as (typeof PAYMENT_INTENT_OPTIONS)[number])) {
    return { ok: false, message: "Metode pembayaran tidak valid." };
  }

  const { data, error } = await supabase.rpc("create_poi_finance", {
    p_deal_id: id,
    p_payment_intent: payment_intent,
  });
  if (error) return { ok: false, message: `Gagal membuat transaksi: ${error.message}` };

  revalidatePath("/deals");
  return { ok: true, message: `Transaksi ${data} dibuat.` };
}

// addDealProduct: tambah satu produk ke deal existing.
export async function addDealProduct(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const deal_id = String(formData.get("deal_id") || "");
  const product_name = String(formData.get("product_name") || "").trim();
  if (!deal_id || !product_name) return { ok: false, message: "Deal & nama produk wajib diisi." };

  const expRaw = String(formData.get("exp_date") || "").trim();
  const komisiRaw = String(formData.get("komisi_kreator") || "").trim();
  const komisi = komisiRaw ? parseCommission(komisiRaw) : null;

  const { error } = await supabase.from("deal_products").insert({
    deal_id,
    product_name,
    product_id: String(formData.get("product_id") || "").trim() || null,
    product_link: String(formData.get("product_link") || "").trim() || null,
    niche: String(formData.get("niche") || "").trim() || null,
    exp_date: expRaw ? parseFlexibleDate(expRaw) : null,
    komisi_kreator_pct: komisi ? komisi.pct : null,
  });
  if (error) return { ok: false, message: `Gagal menambah produk: ${error.message}` };

  revalidatePath("/deals");
  return { ok: true, message: `Produk "${product_name}" ditambahkan.` };
}
