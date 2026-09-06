"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readWorkbookSheets } from "@/lib/mcn/file-read";
import { parseContentAnalysisWorkbook, isContentAnalysisWorkbook } from "@/lib/mcn/content-analysis";

export type ActionResult = { ok: boolean; message: string };

type Me = { id: string; division: string; is_od: boolean; is_director: boolean };

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, me: null as Me | null };
  const { data: me } = await supabase
    .from("employees")
    .select("id, division, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  return { supabase, user, me: me as Me | null };
}

function canRunIngest(me: Me | null): boolean {
  return !!me && (me.is_od || me.is_director || ["BizDev", "CampaignSpecialist", "Account"].includes(me.division));
}

// runCampaignPostIngest — upload export TikTok "Content Analysis › Video List"
// (lib/mcn/content-analysis.ts). Mengisi tiktok_post_index GLOBAL (upsert per
// post_id, migrasi 0346) — TIDAK menghitung kelayakan bukti campaign apa pun
// di sini, itu tugas runValidateCampaignPosts (RPC validate_campaign_posts,
// dijalankan per campaign dari /meago/campaigns/[id]).
export async function runCampaignPostIngest(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canRunIngest(me)) return { ok: false, message: "Tidak berwenang mengingest export TikTok." };

  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, message: "File upload tidak ditemukan." };
  }
  const file = fileEntry;
  if (file.size === 0) return { ok: false, message: "File kosong." };

  let sheets: Awaited<ReturnType<typeof readWorkbookSheets>>;
  try {
    sheets = await readWorkbookSheets(file);
  } catch (e) {
    return { ok: false, message: `Gagal membaca file: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!isContentAnalysisWorkbook(sheets)) {
    return {
      ok: false,
      message: 'File bukan format "Content Analysis › Video List" yang diharapkan. Cek kolom: Post ID, Location ID, Creator ID.',
    };
  }

  const parsed = parseContentAnalysisWorkbook(sheets);
  if (!parsed.ok) return { ok: false, message: parsed.error };

  const rows = parsed.rows.map((r) => ({
    post_id: r.postId,
    post_title: r.postTitle,
    post_date: r.postDate,
    duration_sec: r.durationSec,
    status: r.status,
    task_type: r.taskType,
    creator_type: r.creatorType,
    location_id: r.locationId,
    location_name: r.locationName,
    location_city: r.locationCity,
    location_industry: r.locationIndustry,
    creator_username: r.creatorUsername.toLowerCase(),
    creator_name: r.creatorName,
    creator_city: r.creatorCity,
    creator_level: r.creatorLevel,
    sales_value: r.salesValue,
    orders: r.orders,
    redemption_amount: r.redemptionAmount,
    redeemed_orders: r.redeemedOrders,
    video_views: r.videoViews,
    ctr: r.ctr,
    cvr: r.cvr,
    aov: r.aov,
    video_completion_rate: r.videoCompletionRate,
    like_rate: r.likeRate,
    comment_rate: r.commentRate,
    ingested_at: new Date().toISOString(),
    ingested_by: user.id,
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from("tiktok_post_index").upsert(rows, { onConflict: "post_id" });
    if (error) return { ok: false, message: `Gagal menyimpan index: ${error.message}` };
  }

  revalidatePath("/meago/campaigns");

  const skippedPreview = parsed.skipped
    .slice(0, 10)
    .map((s) => `baris ${s.rowIndex}: ${s.reason}`)
    .join("; ");
  const more = parsed.skipped.length > 10 ? ` (+${parsed.skipped.length - 10} lagi)` : "";
  const unknownMsg = parsed.unknownIndustries.length
    ? ` Industri tak dikenal: ${parsed.unknownIndustries.join(", ")}.`
    : "";

  return {
    ok: true,
    message: `Ingest selesai: ${rows.length} post (window ${parsed.windowStart}..${parsed.windowEnd}), ${parsed.skipped.length} dilewati${
      parsed.skipped.length ? ` — ${skippedPreview}${more}` : ""
    }.${unknownMsg}`,
  };
}

// runValidateCampaignPosts — "Validasi Bukti" per campaign di
// /meago/campaigns/[id]. Otoritas final urutan verdict ada di RPC
// validate_campaign_posts (migrasi 0346) — action ini hanya meneruskan hasil.
export async function runValidateCampaignPosts(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const deal_id = String(formData.get("deal_id") || "").trim();
  if (!deal_id) return { ok: false, message: "Campaign tidak valid." };

  const { data, error } = await supabase.rpc("validate_campaign_posts", { p_deal_id: deal_id });
  if (error) return { ok: false, message: `Gagal menjalankan validasi: ${error.message}` };

  const rows = (Array.isArray(data) ? data : []) as { verdict: string; cnt: number }[];
  const summary = rows.map((r) => `${r.verdict}: ${r.cnt}`).join(", ");

  revalidatePath(`/meago/campaigns/${deal_id}`);
  return { ok: true, message: `Validasi selesai — ${summary || "belum ada bukti untuk divalidasi"}.` };
}
