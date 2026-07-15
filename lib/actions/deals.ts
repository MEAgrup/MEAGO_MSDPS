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
