"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fileHash8, buildBatchId, readWorkbookSheets } from "@/lib/mcn/file-read";
import {
  parsePlatformRows,
  aggregateRows,
  type IngestConfig,
  type PriceBounds,
} from "@/lib/mcn/ingest";
import {
  parseCreatorAnalysisWorkbook,
  isCreatorAnalysisWorkbook,
  type CreatorAnalysisRow,
  type WorkbookSheet,
} from "@/lib/mcn/creator-analysis";
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

// Padanan numChanged untuk kolom teks (sync master): next null = jangan menimpa lama.
function strChanged(cur: unknown, next: string | null): boolean {
  if (next === null) return false;
  if (cur === null || cur === undefined) return true;
  return String(cur) !== next;
}

// Guard overlap periode: batch processed lain dgn period_start beda tapi rentang overlap.
// Dipakai kedua jalur ingest (legacy & Creator Analysis). null = tidak ada overlap.
async function checkOverlapGuard(
  supabase: SupabaseClient,
  periodStart: string,
  periodEnd: string
): Promise<ActionResult | null> {
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
  return null;
}

// Upsert upload_batches ke staging (idempoten via batch_id; dup 23505 → reset ke staging).
// Dipakai kedua jalur ingest. Return batchRowId atau pesan error.
async function upsertStagingBatch(
  supabase: SupabaseClient,
  args: { batch_id: string; source_type: string; periodStart: string; periodEnd: string; hash8: string }
): Promise<{ ok: true; batchRowId: string } | { ok: false; message: string }> {
  const { batch_id, source_type, periodStart, periodEnd, hash8 } = args;
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
      return { ok: true, batchRowId: upd.id };
    }
    return { ok: false, message: `Gagal membuat batch: ${insErr.message}` };
  }
  if (!ins) return { ok: false, message: "Gagal membuat batch (tidak ada id kembali)." };
  return { ok: true, batchRowId: ins.id };
}

// Factory failBatch: tandai batch failed lalu kembalikan ActionResult error.
function makeFailBatch(supabase: SupabaseClient, batchRowId: string) {
  return async (msg: string): Promise<ActionResult> => {
    await supabase.from("upload_batches").update({ status: "failed", error: msg }).eq("id", batchRowId);
    return { ok: false, message: msg };
  };
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

  let sheets: WorkbookSheet[];
  let hash8: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    hash8 = fileHash8(buf);
    sheets = await readWorkbookSheets(file);
  } catch (e) {
    return { ok: false, message: `Gagal membaca file: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Router format: workbook "Creator Analysis" (2 sheet Filter+Data) → jalur baru.
  // Selain itu → jalur legacy (report performa single-sheet, cells = sheet pertama).
  if (isCreatorAnalysisWorkbook(sheets)) {
    return runCreatorAnalysisIngest(supabase, sheets, source_type, platform, hash8);
  }
  const cells: string[][] = sheets[0]?.cells ?? [];

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
  const overlapErr = await checkOverlapGuard(supabase, periodStart, periodEnd);
  if (overlapErr) return overlapErr;

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
  const staging = await upsertStagingBatch(supabase, {
    batch_id,
    source_type,
    periodStart,
    periodEnd,
    hash8,
  });
  if (!staging.ok) return { ok: false, message: staging.message };
  const batchRowId = staging.batchRowId;
  const failBatch = makeFailBatch(supabase, batchRowId);

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
    await autoFillGmvAndPerfDrop(supabase, ids, perfDrop);
    await autoFillNicheJenis(supabase, ids);
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

  revalidatePath("/meago/workspace");
  revalidatePath("/meago/creators");

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

// Master kreator yang di-resolve pada jalur Creator Analysis (kolom yg dibaca utk resolve+sync).
type CreatorMaster = {
  id: string;
  username: string | null;
  name: string | null;
  city: string | null;
  creator_level: string | null;
  binding_status: string | null;
  owner_cpm_id: string | null;
  status: string | null;
};

// Jalur ingest format "Creator Analysis" (workbook Filter+Data). Identitas by USERNAME.
// Menyimpan summary (sales value + redemption), sync master (info saja), alert binding_lost,
// auto-fill gmv + perf_drop. TIDAK menyentuh subcat/top_products (dorman utk format ini).
async function runCreatorAnalysisIngest(
  supabase: SupabaseClient,
  sheets: WorkbookSheet[],
  source_type: string,
  platform: string,
  hash8: string
): Promise<ActionResult> {
  // a. Parse workbook. Gagal → pesan error (belum ada batch row).
  const parsed = parseCreatorAnalysisWorkbook(sheets);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const { periodStart, periodEnd, rows, skipped } = parsed;

  // b. Guard overlap periode (sama logika legacy).
  const overlapErr = await checkOverlapGuard(supabase, periodStart, periodEnd);
  if (overlapErr) return overlapErr;

  // c. batch_id idempoten.
  const batch_id = buildBatchId(periodStart, hash8);

  // Config perf_drop utk auto-fill.
  const { data: cfgRows } = await supabase
    .from("app_config")
    .select("key, value")
    .in("key", ["mcn.perf_drop"]);
  const cfg = new Map<string, unknown>((cfgRows ?? []).map((r) => [r.key, r.value]));
  const perfDrop = cfg.has("mcn.perf_drop") ? Number(cfg.get("mcn.perf_drop")) : 0.15;

  // d. Resolve kreator BY USERNAME (fallback name → backfill username; else insert baru).
  const { data: existingRaw, error: exErr } = await supabase
    .from("mcn_creators")
    .select("id, username, name, city, creator_level, binding_status, owner_cpm_id, status")
    .eq("platform", platform);
  if (exErr) return { ok: false, message: `Gagal membaca master kreator: ${exErr.message}` };
  const existing = (existingRaw ?? []) as CreatorMaster[];

  const byUsername = new Map<string, CreatorMaster>(); // lower(username) → master
  const byName = new Map<string, CreatorMaster>(); // lower(name) → master
  for (const c of existing) {
    if (c.username) byUsername.set(c.username.toLowerCase(), c);
    if (c.name) byName.set(c.name.toLowerCase(), c);
  }

  const autoCreated: string[] = [];
  const toInsert: { name: string; username: string; platform: string; status: string }[] = [];
  const insertSeen = new Set<string>(); // lower(username) yg sudah dijadwalkan insert
  const backfillIds: { id: string; username: string }[] = [];

  for (const row of rows) {
    const uKey = row.username.toLowerCase();
    if (byUsername.has(uKey)) continue; // sudah cocok by username

    const nameMatch = byName.get(row.name.toLowerCase());
    if (nameMatch) {
      // Fallback name: pakai master itu + BACKFILL kolom username.
      nameMatch.username = row.username;
      byUsername.set(uKey, nameMatch);
      backfillIds.push({ id: nameMatch.id, username: row.username });
      continue;
    }

    if (!insertSeen.has(uKey)) {
      insertSeen.add(uKey);
      toInsert.push({ name: row.name, username: row.username, platform, status: "aktif" });
      autoCreated.push(row.username);
    }
  }

  // Backfill username pada kreator yang cocok by name (best-effort per row).
  for (const b of backfillIds) {
    const { error } = await supabase.from("mcn_creators").update({ username: b.username }).eq("id", b.id);
    if (error) return { ok: false, message: `Gagal backfill username: ${error.message}` };
  }

  // Insert kreator baru (batch) → daftarkan ke byUsername.
  if (toInsert.length > 0) {
    const { data: created, error: cErr } = await supabase
      .from("mcn_creators")
      .insert(toInsert)
      .select("id, username");
    if (cErr) return { ok: false, message: `Gagal membuat kreator baru: ${cErr.message}` };
    const insertData = new Map(toInsert.map((t) => [t.username.toLowerCase(), t]));
    for (const c of created ?? []) {
      const uname = (c.username as string | null) ?? "";
      const src = insertData.get(uname.toLowerCase());
      byUsername.set(uname.toLowerCase(), {
        id: c.id as string,
        username: uname,
        name: src?.name ?? uname,
        city: null,
        creator_level: null,
        binding_status: null,
        owner_cpm_id: null,
        status: "aktif",
      });
    }
  }

  // e. Upsert upload_batches (staging) + failBatch.
  const staging = await upsertStagingBatch(supabase, {
    batch_id,
    source_type,
    periodStart,
    periodEnd,
    hash8,
  });
  if (!staging.ok) return { ok: false, message: staging.message };
  const failBatch = makeFailBatch(supabase, staging.batchRowId);

  // Peta creatorId → master & fileRow (dedup by id, occurrence terakhir menang utk file).
  const masterById = new Map<string, CreatorMaster>();
  const fileByCreatorId = new Map<string, CreatorAnalysisRow>();
  for (const row of rows) {
    const master = byUsername.get(row.username.toLowerCase());
    if (!master) continue; // seharusnya tak terjadi (semua ter-resolve/insert)
    masterById.set(master.id, master);
    fileByCreatorId.set(master.id, row);
  }
  const ids = [...masterById.keys()];
  if (ids.length === 0) return failBatch("Tidak ada kreator ter-resolve dari file.");

  // f. Insert summary (delete-then-insert per ids+period_start). Kolom legacy lain tak diisi.
  const summaryRows = ids.map((id) => {
    const row = fileByCreatorId.get(id)!;
    return {
      mcn_creator_id: id,
      period_start: periodStart,
      period_end: periodEnd,
      upload_batch: batch_id,
      affiliate_gmv: row.salesValue,
      orders: row.orders,
      aov: row.aov,
      redemption_amount: row.redemptionAmount,
      redeemed_orders: row.redeemedOrders,
      new_posts: row.newPosts,
      posts_with_sales: row.postsWithSales,
      live_streams: row.liveStreams,
      valid_live_streams: row.validLiveStreams,
    };
  });

  const { error: dErr } = await supabase
    .from("creator_period_summary")
    .delete()
    .in("mcn_creator_id", ids)
    .eq("period_start", periodStart);
  if (dErr) return failBatch(`Gagal membersihkan summary: ${dErr.message}`);
  if (summaryRows.length > 0) {
    const { error } = await supabase.from("creator_period_summary").insert(summaryRows);
    if (error) return failBatch(`Gagal menulis summary: ${error.message}`);
  }

  // g+h. Sync master (info saja: name/city/creator_level/binding_status) + alert binding_lost.
  //      Best-effort — kegagalan sync/alert tak menggagalkan ingest inti yang sudah tertulis.
  let bindingLostNew = 0;
  try {
    const { data: openBindingRaw } = await supabase
      .from("platform_alerts")
      .select("id, mcn_creator_id")
      .eq("alert_type", "binding_lost")
      .eq("resolved", false)
      .in("mcn_creator_id", ids);
    const openBindingByCreator = new Map<string, string>();
    for (const a of openBindingRaw ?? []) openBindingByCreator.set(a.mcn_creator_id as string, a.id as string);

    for (const id of ids) {
      const master = masterById.get(id)!;
      const row = fileByCreatorId.get(id)!;

      // g. Sync master — hanya field yg berubah (null di file = jangan menimpa). TANPA status/jenis/niche.
      const patch: Record<string, unknown> = {};
      if (strChanged(master.name, row.name)) patch.name = row.name;
      if (strChanged(master.city, row.city)) patch.city = row.city;
      if (strChanged(master.creator_level, row.creatorLevel)) patch.creator_level = row.creatorLevel;
      if (strChanged(master.binding_status, row.bindingStatus)) patch.binding_status = row.bindingStatus;
      if (Object.keys(patch).length > 0) {
        await supabase.from("mcn_creators").update(patch).eq("id", id);
      }

      // h. Alert binding_lost saat binding_status berubah → 'Previously bound creators'.
      const newBinding = row.bindingStatus;
      const openAlertId = openBindingByCreator.get(id);
      if (newBinding === "Previously bound creators") {
        if (!openAlertId) {
          await supabase.from("platform_alerts").insert({
            alert_type: "binding_lost",
            mcn_creator_id: id,
            target_member_id: master.owner_cpm_id ?? null,
            detail: { from: master.binding_status, to: newBinding, period_start: periodStart },
          });
          bindingLostNew++;
        }
      } else if (newBinding === "Bound creators") {
        if (openAlertId) {
          await supabase.from("platform_alerts").update({ resolved: true }).eq("id", openAlertId);
        }
      }
    }
  } catch {
    // sengaja diabaikan; sync/alert bersifat info, ingest inti sudah sukses.
  }

  // i. Auto-fill master: gmv rata-rata bulanan + alert perf_drop (basis affiliate_gmv).
  try {
    await autoFillGmvAndPerfDrop(supabase, ids, perfDrop);
  } catch {
    // sengaja diabaikan; ingest inti sudah sukses.
  }

  // j. Tandai processed + revalidate.
  const { error: pErr } = await supabase
    .from("upload_batches")
    .update({
      status: "processed",
      row_count_raw: rows.length,
      creators_count: ids.length,
      processed_at: new Date().toISOString(),
    })
    .eq("id", staging.batchRowId);
  if (pErr) return failBatch(`Gagal menandai processed: ${pErr.message}`);

  revalidatePath("/meago/workspace");
  revalidatePath("/meago/creators");

  const autoMsg = autoCreated.length
    ? ` Auto-created: ${autoCreated.slice(0, 10).join(", ")}${autoCreated.length > 10 ? ` (+${autoCreated.length - 10})` : ""}.`
    : "";
  const skippedPreview = skipped
    .slice(0, 10)
    .map((s) => `baris ${s.rowIndex}: ${s.reason}`)
    .join("; ");
  const skipMsg = skipped.length
    ? ` Skipped ${skipped.length}: ${skippedPreview}${skipped.length > 10 ? ` (+${skipped.length - 10})` : ""}.`
    : "";
  const bindingMsg = bindingLostNew > 0 ? ` ${bindingLostNew} alert binding_lost baru.` : "";

  return {
    ok: true,
    message: `Ingest Creator Analysis ${periodStart}..${periodEnd} selesai: ${rows.length} baris, ${ids.length} kreator.${autoMsg}${bindingMsg}${skipMsg}`,
  };
}

// Auto-fill master GMV rata-rata bulanan (dari affiliate_gmv) + growth alert perf_drop.
// Dipakai KEDUA jalur ingest (legacy & Creator Analysis) — basis kolom affiliate_gmv saja.
async function autoFillGmvAndPerfDrop(
  supabase: SupabaseClient,
  ids: string[],
  perfDrop: number
): Promise<void> {
  const { data: histAllRaw } = await supabase
    .from("creator_period_summary")
    .select("mcn_creator_id, period_start, created_at, affiliate_gmv, affiliate_live_gmv, affiliate_video_gmv")
    .in("mcn_creator_id", ids);
  const histAll = (histAllRaw ?? []) as HistRow[];

  const { data: fileCreatorsRaw } = await supabase
    .from("mcn_creators")
    .select("id, owner_cpm_id, gmv, gmv_live, gmv_video")
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

  for (const id of ids) {
    const hist = histByCreator.get(id) ?? [];
    const cur = fileCreators.get(id) ?? {};
    const patch: Record<string, unknown> = {};

    // (a) GMV rata-rata bulanan dari seluruh histori.
    const avg = buildMonthlyAverages(hist as AverageRow[]);
    if (numChanged(cur.gmv, avg.gmv)) patch.gmv = avg.gmv;
    if (numChanged(cur.gmv_live, avg.gmv_live)) patch.gmv_live = avg.gmv_live;
    if (numChanged(cur.gmv_video, avg.gmv_video)) patch.gmv_video = avg.gmv_video;

    if (Object.keys(patch).length > 0) {
      await supabase.from("mcn_creators").update(patch).eq("id", id);
    }

    // (d) Growth alert perf_drop: bandingkan 2 minggu TERISI terakhir (basis affiliate_gmv).
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

// Auto-fill niche/top_niches (ranking GMV category_l2) + jenis_creator (rasio live:video).
// HANYA jalur legacy (report performa) — format Creator Analysis tak mengisi field ini.
async function autoFillNicheJenis(supabase: SupabaseClient, ids: string[]): Promise<void> {
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
    .select("id, niche, jenis_creator, top_niches")
    .in("id", ids);
  const fileCreators = new Map<string, Record<string, unknown>>(
    (fileCreatorsRaw ?? []).map((c) => [c.id as string, c as Record<string, unknown>])
  );

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
  }
}
