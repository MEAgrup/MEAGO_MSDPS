"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseIntTolerant, parseRupiah } from "@/lib/mcn/parsers";
import {
  isCampaignMode,
  isCampaignTrack,
  isFundingSource,
  validateBudgetFields,
} from "@/lib/campaign-budget";
import { isCampaignStage } from "@/lib/campaign-stage";
import { isCampaignOwner } from "@/lib/campaign-access";

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

// canManageCampaigns — sama dengan cakupan RLS brand_deals_insert/update
// (migrasi 0342 §7, diperluas ke SPV Creator Management oleh 0358). Account
// TIDAK termasuk di sini karena aksesnya dibatasi per-baris
// (operational_owner_id) oleh RLS sendiri — action ini tetap dipanggil, DB
// yang menolak baris yang bukan miliknya.
const canManageCampaigns = isCampaignOwner;

function splitStringList(raw: FormDataEntryValue | null): string[] | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

// createCampaign — form "Buat Campaign" (/meago/campaigns). Isi kolom fondasi
// G.1 saja (funding, budget, target, segmentasi) — pendaftaran kreator (G.2),
// bukti (G.3), payout (G.4) belum ada di sini.
export async function createCampaign(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageCampaigns(me)) return { ok: false, message: "Tidak berwenang membuat campaign." };

  const brand_name = String(formData.get("brand_name") || "").trim();
  const funding_source = String(formData.get("funding_source") || "").trim();
  const campaign_track = String(formData.get("campaign_track") || "").trim();
  const campaign_mode_raw = String(formData.get("campaign_mode") || "").trim();
  const target_location_id = String(formData.get("target_location_id") || "").trim();
  const operational_owner_id = String(formData.get("operational_owner_id") || "").trim();
  const brief = String(formData.get("brief") || "").trim();
  const has_free_meal = formData.get("has_free_meal") === "on";

  if (!brand_name) return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  if (!isFundingSource(funding_source)) return { ok: false, message: "[funding source tidak dikenal]" };
  if (!isCampaignTrack(campaign_track)) return { ok: false, message: "[track campaign tidak dikenal]" };
  if (campaign_mode_raw && !isCampaignMode(campaign_mode_raw)) {
    return { ok: false, message: "[mode campaign tidak dikenal]" };
  }

  // Keputusan #3/#4: budget internal dikerjakan sendiri oleh tim campaign;
  // BizDev melempar ke AM di Account (operational_team=Account, wajib pilih AM).
  // Koreksi 0358: tim campaign yang nyata adalah Creator Management (tidak ada
  // karyawan berdivisi CampaignSpecialist), jadi campaign internal yang dibuat
  // SPV CM dicatat sebagai operational_team=CreatorManagement — bukan divisi
  // kosong yang tidak bisa dihubungi siapa pun saat baris ini dibaca ulang.
  const internalTeam = me.division === "CreatorManagement" ? "CreatorManagement" : "CampaignSpecialist";
  const operational_team = funding_source === "internal" ? internalTeam : "Account";
  if (funding_source === "brand" && !operational_owner_id) {
    return { ok: false, message: "[AM penerima (Account) wajib dipilih untuk campaign budget brand]" };
  }

  const base_fee = parseRupiah(String(formData.get("base_fee") || ""));
  const creator_quota = parseIntTolerant(String(formData.get("creator_quota") || ""));
  const creator_budget = parseRupiah(String(formData.get("creator_budget") || ""));
  const ads_budget_planned = parseRupiah(String(formData.get("ads_budget_planned") || ""));
  const target_gmv = parseRupiah(String(formData.get("target_gmv") || ""));
  const target_views = parseIntTolerant(String(formData.get("target_views") || ""));
  const min_gmv = parseRupiah(String(formData.get("min_gmv") || ""));
  const min_gmv_period_days = parseIntTolerant(String(formData.get("min_gmv_period_days") || ""));

  const over_budget_reason = String(formData.get("over_budget_reason") || "").trim();
  const check = validateBudgetFields({
    baseFee: base_fee,
    creatorQuota: creator_quota,
    creatorBudget: creator_budget,
    overBudget: !!over_budget_reason,
    overBudgetReason: over_budget_reason,
    me,
  });
  if (!check.ok) return { ok: false, message: check.error };

  const { data: deal, error } = await supabase
    .from("brand_deals")
    .insert({
      brand_name,
      campaign_type: "paid",
      campaign_enabled: true,
      funding_source,
      campaign_track,
      campaign_mode: campaign_mode_raw || null,
      operational_team,
      operational_owner_id: operational_owner_id || null,
      base_fee,
      creator_quota,
      creator_budget,
      ads_budget_planned,
      over_budget: !!over_budget_reason,
      over_budget_reason: over_budget_reason || null,
      target_location_id: target_location_id || null,
      target_gmv,
      target_views,
      post_window_start: String(formData.get("post_window_start") || "").trim() || null,
      post_window_end: String(formData.get("post_window_end") || "").trim() || null,
      submission_deadline: String(formData.get("submission_deadline") || "").trim() || null,
      brief: brief || null,
      has_free_meal,
      eligible_industries: splitStringList(formData.get("eligible_industries")),
      eligible_cities: splitStringList(formData.get("eligible_cities")),
      eligible_levels: splitStringList(formData.get("eligible_levels")),
      eligible_creator_types: splitStringList(formData.get("eligible_creator_types")),
      eligible_roster_status: splitStringList(formData.get("eligible_roster_status")),
      eligible_status_kontrak: splitStringList(formData.get("eligible_status_kontrak")),
      min_gmv,
      min_gmv_metric: String(formData.get("min_gmv_metric") || "").trim() || null,
      min_gmv_period_days,
    })
    .select("id, code")
    .single();
  if (error) return { ok: false, message: `Gagal menyimpan campaign: ${error.message}` };

  revalidatePath("/meago/campaigns");
  return { ok: true, message: `Campaign ${deal.code} — ${brand_name} tersimpan sebagai Draft.` };
}

// updateCampaignBudget — form edit budget di detail campaign. Dipisah dari
// createCampaign supaya over-budget override bisa dilakukan Lead+ tanpa
// mengubah field lain (brief/segmentasi).
export async function updateCampaignBudget(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageCampaigns(me)) return { ok: false, message: "Tidak berwenang mengubah budget campaign." };

  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!deal_id) return { ok: false, message: "Campaign tidak valid." };

  const base_fee = parseRupiah(String(formData.get("base_fee") || ""));
  const creator_quota = parseIntTolerant(String(formData.get("creator_quota") || ""));
  const creator_budget = parseRupiah(String(formData.get("creator_budget") || ""));
  const ads_budget_planned = parseRupiah(String(formData.get("ads_budget_planned") || ""));
  const over_budget_reason = String(formData.get("over_budget_reason") || "").trim();

  const check = validateBudgetFields({
    baseFee: base_fee,
    creatorQuota: creator_quota,
    creatorBudget: creator_budget,
    overBudget: !!over_budget_reason,
    overBudgetReason: over_budget_reason,
    me,
  });
  if (!check.ok) return { ok: false, message: check.error };

  const { error } = await supabase
    .from("brand_deals")
    .update({
      base_fee,
      creator_quota,
      creator_budget,
      ads_budget_planned,
      over_budget: !!over_budget_reason,
      over_budget_reason: over_budget_reason || null,
    })
    .eq("id", deal_id);
  // over_budget/over_budget_reason yang sudah tidak relevan dibersihkan otomatis
  // oleh trigger campaign_budget_guard() di DB — action ini tidak perlu menebak.
  if (error) return { ok: false, message: `Gagal menyimpan budget: ${error.message}` };

  revalidatePath("/meago/campaigns");
  revalidatePath(`/meago/campaigns/${deal_id}`);
  return { ok: true, message: "Budget campaign diperbarui." };
}

// changeCampaignStage — dropdown stage di detail campaign. Legalitas transisi
// & wewenang (Lead+ untuk cancel) tetap diputuskan trigger
// enforce_campaign_stage_transition() (migrasi 0342) — pesan error DB
// diteruskan apa adanya kalau ditolak.
export async function changeCampaignStage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageCampaigns(me)) return { ok: false, message: "Tidak berwenang mengubah stage campaign." };

  const deal_id = String(formData.get("deal_id") || "").trim();
  const campaign_stage = String(formData.get("campaign_stage") || "").trim();
  if (!deal_id || !isCampaignStage(campaign_stage)) return { ok: false, message: "Stage tidak valid." };

  const { error } = await supabase.from("brand_deals").update({ campaign_stage }).eq("id", deal_id);
  if (error) return { ok: false, message: `Gagal memindah stage: ${error.message}` };

  revalidatePath("/meago/campaigns");
  revalidatePath(`/meago/campaigns/${deal_id}`);
  return { ok: true, message: `Stage campaign → ${campaign_stage}.` };
}

// addAdsSpend — input manual multi-entri realisasi ads_budget (keputusan #7),
// dipakai hitung ROAS di fase berikutnya.
export async function addAdsSpend(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageCampaigns(me) && me.division !== "Account") {
    return { ok: false, message: "Tidak berwenang mencatat ads spend." };
  }

  const deal_id = String(formData.get("deal_id") || "").trim();
  const spend_date = String(formData.get("spend_date") || "").trim();
  const amount = parseRupiah(String(formData.get("amount") || ""));
  const note = String(formData.get("note") || "").trim();
  if (!deal_id || !spend_date) return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  if (amount === null || amount < 0) return { ok: false, message: "[nominal ads spend tidak valid]" };

  const { error } = await supabase.from("campaign_ads_spend").insert({
    deal_id,
    spend_date,
    amount,
    note: note || null,
  });
  if (error) return { ok: false, message: `Gagal menyimpan ads spend: ${error.message}` };

  revalidatePath(`/meago/campaigns/${deal_id}`);
  return { ok: true, message: "Ads spend tercatat." };
}
