"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { readFileToCells, fileHash8, buildBatchId } from "@/lib/mcn/file-read";
import {
  parsePlatformRows,
  aggregateRows,
  type IngestConfig,
  type PriceBounds,
} from "@/lib/mcn/ingest";
import { validateW1W5Period } from "@/lib/mcn/weeks";
import { buildMonthlyAverages, type AverageRow } from "@/lib/mcn/weeks";

export type ActionResult = { ok: boolean; message: string };

const DEFAULT_PRICE_BOUNDS: PriceBounds = { low: 180000, entry: 800000, sweet: 3600000, high: 8000000 };
// Ambang jenis_creator dari rasio GMV live:video — >70% salah satu sisi menang, else 'mixed'.
const JENIS_RATIO = 0.7;

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

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type HistRow = {
  mcn_creator_id: string;
  period_start: string;
  created_at: string;
  affiliate_gmv: number | null;
  affiliate_live_gmv: number | null;
  affiliate_video_gmv: number | null;
};

function numChanged(cur: unknown, next: number | null): boolean {
  if (next === null) return false; // jangan menimpa dgn null (derived kosong = biarkan lama)
  if (cur === null || cur === undefined) return true;
  return Math.abs(Number(cur) - next) > 0.01;
}

// runIngest: pipeline Upload Data Mingguan (process-on-ingest, drop-raw).
export async function runIngest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  // 1. File → cells + hash8.
  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, message: "File upload tidak ditemukan." };
  }
  const file = fileEntry;
  if (file.size === 0) return { ok: false, message: "File kosong." };
  const source_type = String(formData.get("source_type") || "").trim() || "tiktok";
  const platform = source_type; // MEAGO TikTok-only; platform mengikuti source_type.

  let cells: string[][];
  let hash8: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    hash8 = fileHash8(buf);
    cells = await readFileToCells(file);
  } catch (e) {
    return { ok: false, message: `Gagal membaca file: ${e instanceof Error ? e.message : String(e)}` };
  }

  // 2. Parse. 0 baris valid → diagnostik header.
  const parsed = parsePlatformRows(cells);
  if (parsed.rows.length === 0) {
    const diag = parsed.headerDiagnostics;
    const found = diag && diag.found.length ? diag.found.join(", ") : "(tidak ada header dikenali)";
    const expected = diag ? diag.expectedAny.join(", ") : "";
    return {
      ok: false,
      message: `0 baris valid dari file. Header ditemukan: ${found}. Diharapkan (salah satu): ${expected}.`,
    };
  }
  if (!parsed.periodStart || !parsed.periodEnd) {
    return {
      ok: false,
      message: "Kolom tanggal periode tidak ditemukan — tak bisa menentukan window W1-W5.",
    };
  }
  const periodStart = parsed.periodStart;
  const periodEnd = parsed.periodEnd;

  // 3. Window W1-W5.
  const win = validateW1W5Period(periodStart, periodEnd);
  if (!win.ok) return { ok: false, message: win.message };

  // 4. Guard overlap: batch processed lain dgn period_start beda tapi rentang overlap.
  const { data: overlaps, error: ovErr } = await supabase
    .from("upload_batches")
    .select("batch_id, period_start, period_end")
    .eq("status", "processed")
    .neq("period_start", periodStart)
    .lte("period_start", periodEnd)
    .gte("period_end", periodStart);
  if (ovErr) return { ok: false, message: `Gagal cek overlap batch: ${ovErr.message}` };
  if (overlaps && overlaps.length > 0) {
    const list = overlaps.map((o) => `${o.period_start}..${o.period_end}`).join(", ");
    return {
      ok: false,
      message: `Periode ${periodStart}..${periodEnd} tumpang tindih dengan batch processed lain (${list}) — ditolak.`,
    };
  }

  // 5. batch_id idempoten.
  const batch_id = buildBatchId(periodStart, hash8);

  // 6. Config + agregasi.
  const { data: cfgRows } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", ["mcn.top_n_products", "mcn.price_bounds", "mcn.perf_drop"]);
  const cfg = new Map<string, unknown>((cfgRows ?? []).map((r) => [r.key, r.value]));
  const config: IngestConfig = {
    topNProducts: cfg.has("mcn.top_n_products") ? Number(cfg.get("mcn.top_n_products")) : 20,
    priceBounds: (cfg.get("mcn.price_bounds") as PriceBounds) ?? DEFAULT_PRICE_BOUNDS,
  };
  const perfDrop = cfg.has("mcn.perf_drop") ? Number(cfg.get("mcn.perf_drop")) : 0.15;

  const agg = aggregateRows(parsed.rows, config);

  // 7. Resolve kreator (unique index EXPRESSION lower(name) → select + insert-yang-belum-ada).
  const wantedByLower = new Map<string, string>(); // lower → nama original (occurrence pertama)
  for (const s of agg.summaries) {
    const name = s.creatorName.trim();
    if (name === "") continue;
    const lower = name.toLowerCase();
    if (!wantedByLower.has(lower)) wantedByLower.set(lower, name);
  }

  const { data: existingCreators, error: exErr } = await supabase
    .from("mcn_creators")
    .select("id, name")
    .eq("platform", platform);
  if (exErr) return { ok: false, message: `Gagal membaca master kreator: ${exErr.message}` };

  const nameToId = new Map<string, string>(); // lower → id
  for (const c of existingCreators ?? []) nameToId.set(String(c.name).toLowerCase(), c.id);

  const autoCreated: string[] = [];
  const toInsert: { name: string; platform: string; status: string }[] = [];
  for (const [lower, original] of wantedByLower) {
    if (!nameToId.has(lower)) {
      toInsert.push({ name: original, platform, status: "aktif" }); // dari report performa → aktif
      autoCreated.push(original);
    }
  }
  if (toInsert.length > 0) {
    const { data: created, error: cErr } = await supabase
      .from("mcn_creators")
      .insert(toInsert)
      .select("id, name");
    if (cErr) return { ok: false, message: `Gagal membuat kreator baru: ${cErr.message}` };
    for (const c of created ?? []) nameToId.set(String(c.name).toLowerCase(), c.id);
  }

  // 7b. Upsert upload_batches (staging). Dup batch_id (23505) → reset row existing ke staging.
  let batchRowId: string;
  const { data: ins, error: insErr } = await supabase
    .from("upload_batches")
    .insert({
      batch_id,
      source_type,
      period_start: periodStart,
      period_end: periodEnd,
      file_hash: hash8,
      status: "staging",
    })
    .select("id")
    .maybeSingle();
  if (insErr) {
    if (insErr.code === "23505") {
      const { data: upd, error: uErr } = await supabase
        .from("upload_batches")
        .update({ status: "staging", error: null, source_type, period_end: periodEnd, file_hash: hash8 })
        .eq("batch_id", batch_id)
        .select("id")
        .maybeSingle();
      if (uErr || !upd) {
        return { ok: false, message: `Gagal menyiapkan batch: ${uErr?.message ?? "row tidak ditemukan"}` };
      }
      batchRowId = upd.id;
    } else {
      return { ok: false, message: `Gagal membuat batch: ${insErr.message}` };
    }
  } else if (ins) {
    batchRowId = ins.id;
  } else {
    return { ok: false, message: "Gagal membuat batch (tidak ada id kembali)." };
  }

  const failBatch = async (msg: string): Promise<ActionResult> => {
    await supabase.from("upload_batches").update({ status: "failed", error: msg }).eq("id", batchRowId);
    return { ok: false, message: msg };
  };

  // 8. Bangun baris insert (drop unattributed / creatorName kosong).
  const idFor = (name: string): string | null =>
    name.trim() === "" ? null : nameToId.get(name.trim().toLowerCase()) ?? null;

  const idSet = new Set<string>();
  let unattributed = 0;

  const summaryRows = [];
  for (const s of agg.summaries) {
    const cid = idFor(s.creatorName);
    if (!cid) {
      if (s.creatorName.trim() === "") unattributed++;
      continue;
    }
    idSet.add(cid);
    summaryRows.push({
      mcn_creator_id: cid,
      period_start: periodStart,
      period_end: periodEnd,
      upload_batch: batch_id,
      gmv_total: s.gmvTotal,
      affiliate_gmv: s.affiliateGmv,
      affiliate_live_gmv: s.affiliateLiveGmv,
      affiliate_video_gmv: s.affiliateVideoGmv,
      live_orders: s.liveOrders,
      video_orders: s.videoOrders,
      orders: s.orders,
      items_sold: s.itemsSold,
      refund_gmv: s.refundGmv,
      ctr: s.ctr,
      ctor: s.ctor,
      live_pct: s.livePct,
    });
  }

  const subcatRows = [];
  for (const sc of agg.subcatSegments) {
    const cid = idFor(sc.creatorName);
    if (!cid) continue;
    subcatRows.push({
      mcn_creator_id: cid,
      period_start: periodStart,
      upload_batch: batch_id,
      category_l2: sc.categoryL2,
      price_segment: sc.priceSegment,
      gmv: sc.gmv,
      items_sold: sc.itemsSold,
    });
  }

  const topRows = [];
  for (const tp of agg.topProducts) {
    const cid = idFor(tp.creatorName);
    if (!cid) continue;
    topRows.push({
      mcn_creator_id: cid,
      period_start: periodStart,
      upload_batch: batch_id,
      product_id: tp.productId,
      product_name: tp.productName,
      shop_id: tp.shopId,
      shop_name: tp.shopName,
      gmv: tp.gmv,
      items_sold: tp.itemsSold,
      rank: tp.rank,
    });
  }

  const ids = [...idSet];
  if (ids.length === 0) return failBatch("Tidak ada kreator ter-resolve dari file (semua baris tanpa nama kreator).");

  // 9. Replace scoped per (creator × minggu): delete SEMUA batch pada period_start ini
  //    lalu insert batch besar per tabel.
  for (const table of ["creator_period_summary", "creator_subcat_segment_gmv", "creator_top_products"]) {
    const { error: dErr } = await supabase
      .from(table)
      .delete()
      .in("mcn_creator_id", ids)
      .eq("period_start", periodStart);
    if (dErr) return failBatch(`Gagal membersihkan ${table}: ${dErr.message}`);
  }
  if (summaryRows.length > 0) {
    const { error } = await supabase.from("creator_period_summary").insert(summaryRows);
    if (error) return failBatch(`Gagal menulis summary: ${error.message}`);
  }
  if (subcatRows.length > 0) {
    const { error } = await supabase.from("creator_subcat_segment_gmv").insert(subcatRows);
    if (error) return failBatch(`Gagal menulis subcat/segmen: ${error.message}`);
  }
  if (topRows.length > 0) {
    const { error } = await supabase.from("creator_top_products").insert(topRows);
    if (error) return failBatch(`Gagal menulis top produk: ${error.message}`);
  }

  // 10-11. Auto-fill master + refresh growth alerts (best-effort — kegagalan derivasi
  //         tidak menggagalkan ingest inti yang sudah tertulis).
  try {
    await autoFillAndAlerts(supabase, ids, perfDrop);
  } catch {
    // sengaja diabaikan; ingest inti sudah sukses.
  }

  // 12. Tandai processed.
  const { error: pErr } = await supabase
    .from("upload_batches")
    .update({
      status: "processed",
      row_count_raw: parsed.rows.length,
      creators_count: ids.length,
      processed_at: new Date().toISOString(),
    })
    .eq("id", batchRowId);
  if (pErr) return failBatch(`Gagal menandai processed: ${pErr.message}`);

  revalidatePath("/mcn/workspace");
  revalidatePath("/mcn/creators");

  const skippedPreview = parsed.skipped
    .slice(0, 10)
    .map((s) => `baris ${s.row}: ${s.reason}`)
    .join("; ");
  const skippedMore = parsed.skipped.length > 10 ? ` (+${parsed.skipped.length - 10} lagi)` : "";
  const autoMsg = autoCreated.length
    ? ` Auto-created: ${autoCreated.slice(0, 10).join(", ")}${autoCreated.length > 10 ? ` (+${autoCreated.length - 10})` : ""}.`
    : "";
  const unattrMsg = unattributed > 0 ? ` ${unattributed} grup tanpa nama kreator diabaikan.` : "";
  const skipMsg = parsed.skipped.length
    ? ` Skipped ${parsed.skipped.length}: ${skippedPreview}${skippedMore}.`
    : "";

  return {
    ok: true,
    message: `Ingest ${periodStart}..${periodEnd} selesai: ${parsed.rows.length} baris, ${ids.length} kreator.${autoMsg}${unattrMsg}${skipMsg}`,
  };
}

// Auto-fill master (gmv rata-rata bulanan, niche/top_niches, jenis_creator) + growth alerts.
async function autoFillAndAlerts(
  supabase: SupabaseClient,
  ids: string[],
  perfDrop: number
): Promise<void> {
  const { data: histAllRaw } = await supabase
    .from("creator_period_summary")
    .select("mcn_creator_id, period_start, created_at, affiliate_gmv, affiliate_live_gmv, affiliate_video_gmv")
    .in("mcn_creator_id", ids);
  const histAll = (histAllRaw ?? []) as HistRow[];

  const { data: subAllRaw } = await supabase
    .from("creator_subcat_segment_gmv")
    .select("mcn_creator_id, category_l2, gmv")
    .in("mcn_creator_id", ids);
  const subAll = (subAllRaw ?? []) as { mcn_creator_id: string; category_l2: string | null; gmv: number | null }[];

  const { data: fileCreatorsRaw } = await supabase
    .from("mcn_creators")
    .select("id, owner_cpm_id, gmv, gmv_live, gmv_video, niche, jenis_creator, top_niches")
    .in("id", ids);
  const fileCreators = new Map<string, Record<string, unknown>>(
    (fileCreatorsRaw ?? []).map((c) => [c.id as string, c as Record<string, unknown>])
  );

  const { data: openAlertsRaw } = await supabase
    .from("platform_alerts")
    .select("id, mcn_creator_id")
    .eq("alert_type", "perf_drop")
    .eq("resolved", false)
    .in("mcn_creator_id", ids);
  const openAlertByCreator = new Map<string, string>();
  for (const a of openAlertsRaw ?? []) openAlertByCreator.set(a.mcn_creator_id as string, a.id as string);

  // Kelompokkan histori per kreator.
  const histByCreator = new Map<string, HistRow[]>();
  for (const h of histAll) {
    const arr = histByCreator.get(h.mcn_creator_id) ?? [];
    arr.push(h);
    histByCreator.set(h.mcn_creator_id, arr);
  }
  const subByCreator = new Map<string, { category_l2: string | null; gmv: number | null }[]>();
  for (const s of subAll) {
    const arr = subByCreator.get(s.mcn_creator_id) ?? [];
    arr.push({ category_l2: s.category_l2, gmv: s.gmv });
    subByCreator.set(s.mcn_creator_id, arr);
  }

  for (const id of ids) {
    const hist = histByCreator.get(id) ?? [];
    const cur = fileCreators.get(id) ?? {};
    const patch: Record<string, unknown> = {};

    // (a) GMV rata-rata bulanan dari seluruh histori.
    const avg = buildMonthlyAverages(hist as AverageRow[]);
    if (numChanged(cur.gmv, avg.gmv)) patch.gmv = avg.gmv;
    if (numChanged(cur.gmv_live, avg.gmv_live)) patch.gmv_live = avg.gmv_live;
    if (numChanged(cur.gmv_video, avg.gmv_video)) patch.gmv_video = avg.gmv_video;

    // (b) niche/top_niches dari ranking GMV category_l2.
    const catSum = new Map<string, number>();
    for (const s of subByCreator.get(id) ?? []) {
      if (!s.category_l2) continue;
      catSum.set(s.category_l2, (catSum.get(s.category_l2) ?? 0) + Number(s.gmv ?? 0));
    }
    const rankedCats = [...catSum.entries()].sort((a, b) => b[1] - a[1]).map(([cat]) => cat);
    if (rankedCats.length > 0) {
      const niche = rankedCats[0];
      const topNiches = rankedCats.slice(0, 5);
      if (niche && niche !== cur.niche) patch.niche = niche;
      if (JSON.stringify(topNiches) !== JSON.stringify(cur.top_niches ?? null)) patch.top_niches = topNiches;
    }

    // (c) jenis_creator dari rasio GMV live:video (>70% live/video, else mixed).
    let liveTot = 0;
    let videoTot = 0;
    for (const h of hist) {
      liveTot += Number(h.affiliate_live_gmv ?? 0);
      videoTot += Number(h.affiliate_video_gmv ?? 0);
    }
    const lvTotal = liveTot + videoTot;
    if (lvTotal > 0) {
      const liveRatio = liveTot / lvTotal;
      const jenis = liveRatio > JENIS_RATIO ? "live" : liveRatio < 1 - JENIS_RATIO ? "video" : "mixed";
      if (jenis !== cur.jenis_creator) patch.jenis_creator = jenis;
    }

    if (Object.keys(patch).length > 0) {
      await supabase.from("mcn_creators").update(patch).eq("id", id);
    }

    // (d) Growth alert perf_drop: bandingkan 2 minggu TERISI terakhir.
    const latestByPeriod = new Map<string, HistRow>();
    for (const h of hist) {
      const ex = latestByPeriod.get(h.period_start);
      if (!ex || h.created_at > ex.created_at) latestByPeriod.set(h.period_start, h);
    }
    const filled = [...latestByPeriod.values()]
      .filter((h) => h.affiliate_gmv !== null)
      .sort((a, b) => (a.period_start < b.period_start ? -1 : a.period_start > b.period_start ? 1 : 0));

    let isDrop = false;
    let dropInfo: { prev: number; last: number; drop: number } | null = null;
    if (filled.length >= 2) {
      const prev = Number(filled[filled.length - 2].affiliate_gmv);
      const last = Number(filled[filled.length - 1].affiliate_gmv);
      if (prev > 0) {
        const drop = (prev - last) / prev;
        if (drop > perfDrop) {
          isDrop = true;
          dropInfo = { prev, last, drop };
        }
      }
    }

    const openAlertId = openAlertByCreator.get(id);
    if (isDrop && !openAlertId) {
      await supabase.from("platform_alerts").insert({
        alert_type: "perf_drop",
        mcn_creator_id: id,
        target_member_id: (cur.owner_cpm_id as string | null) ?? null,
        detail: dropInfo,
      });
    } else if (!isDrop && openAlertId) {
      await supabase.from("platform_alerts").update({ resolved: true }).eq("id", openAlertId);
    }
  }
}
