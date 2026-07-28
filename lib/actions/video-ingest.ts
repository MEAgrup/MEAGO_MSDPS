"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileHashFull, buildBatchId, readWorkbookSheets } from "@/lib/mcn/file-read";
import {
  parseVideoGmvWorkbook,
  isVideoGmvWorkbook,
  type VideoGmvRow,
  type WorkbookSheet,
} from "@/lib/mcn/video-ingest";
import { validateW1W5Period } from "@/lib/mcn/weeks";

export type ActionResult = { ok: boolean; message: string };

const ARCHIVE_BUCKET = "weekly-archives";
const DEFAULT_RETENTION_MONTHS = 6;

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

type CreatorMaster = {
  id: string;
  username: string | null;
  name: string | null;
  owner_cpm_id: string | null;
  status: string | null;
};

// Guard duplikat: file dgn hash penuh identik sudah pernah diproses (status 'processed').
async function checkDuplicateGuard(
  supabase: SupabaseClient,
  hashFull: string,
  force: boolean
): Promise<ActionResult | null> {
  if (force) return null;
  const { data: dup, error } = await supabase
    .from("upload_batches")
    .select("batch_id, period_start, period_end, uploaded_at")
    .eq("file_hash_full", hashFull)
    .eq("status", "processed")
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, message: `Gagal cek duplikat file: ${error.message}` };
  if (dup) {
    return {
      ok: false,
      message:
        `File identik sudah diproses sebelumnya untuk periode ${dup.period_start}..${dup.period_end} ` +
        `(batch ${dup.batch_id}, diunggah ${dup.uploaded_at}). Centang "Proses ulang jika file duplikat" ` +
        `pada form bila memang ingin memproses ulang (menimpa data periode tersebut).`,
    };
  }
  return null;
}

// Guard overlap periode: batch processed lain dgn period_start beda tapi rentang overlap.
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
async function upsertStagingBatch(
  supabase: SupabaseClient,
  args: {
    batch_id: string;
    source_type: string;
    periodStart: string;
    periodEnd: string;
    hash8: string;
    hashFull: string;
  }
): Promise<{ ok: true; batchRowId: string } | { ok: false; message: string }> {
  const { batch_id, source_type, periodStart, periodEnd, hash8, hashFull } = args;
  const { data: ins, error: insErr } = await supabase
    .from("upload_batches")
    .insert({
      batch_id,
      source_type,
      period_start: periodStart,
      period_end: periodEnd,
      file_hash: hash8,
      file_hash_full: hashFull,
      status: "staging",
    })
    .select("id")
    .maybeSingle();
  if (insErr) {
    if (insErr.code === "23505") {
      const { data: upd, error: uErr } = await supabase
        .from("upload_batches")
        .update({
          status: "staging",
          error: null,
          source_type,
          period_end: periodEnd,
          file_hash: hash8,
          file_hash_full: hashFull,
        })
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

// Tandai batch failed lalu kembalikan ActionResult error.
function makeFailBatch(supabase: SupabaseClient, batchRowId: string) {
  return async (msg: string): Promise<ActionResult> => {
    await supabase.from("upload_batches").update({ status: "failed", error: msg }).eq("id", batchRowId);
    return { ok: false, message: msg };
  };
}

// Baca app_config 'mcn.retention_months' (default 6 bulan).
async function getRetentionMonths(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "mcn.retention_months")
    .maybeSingle();
  const n = data?.value != null ? Number(data.value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_MONTHS;
}

// Tanggal cutoff retensi = hari ini dikurangi N bulan.
function retentionCutoffDate(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

// Arsip RENDER (hasil agregat per-video) ke bucket privat weekly-archives.
async function archiveVideoGmvRender(
  supabase: SupabaseClient,
  args: {
    batchRowId: string;
    batch_id: string;
    source_type: string;
    periodStart: string;
    periodEnd: string;
    hash8: string;
    rowCountRaw: number;
    creatorsCount: number;
    videoRows: unknown[];
  }
): Promise<string> {
  const payload = {
    batch_id: args.batch_id,
    source_type: args.source_type,
    period_start: args.periodStart,
    period_end: args.periodEnd,
    generated_at: new Date().toISOString(),
    row_count_raw: args.rowCountRaw,
    creators_count: args.creatorsCount,
    videos: args.videoRows,
  };
  const archive_path = `${args.periodStart}/${args.hash8}.json`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from(ARCHIVE_BUCKET)
    .upload(archive_path, Buffer.from(JSON.stringify(payload)), {
      contentType: "application/json",
      upsert: true,
    });
  if (upErr) throw new Error(upErr.message);

  const { error: patchErr } = await supabase
    .from("upload_batches")
    .update({ archive_path, archive_deleted_at: null })
    .eq("id", args.batchRowId);
  if (patchErr) throw new Error(patchErr.message);

  return archive_path;
}

// Sweep retensi: hapus baris agregat DB + arsip Storage kedaluwarsa.
async function sweepExpiredWeeklyData(supabase: SupabaseClient): Promise<void> {
  const months = await getRetentionMonths(supabase);
  const cutoff = retentionCutoffDate(months);

  // Hapus baris agregat DB (termasuk video_gmv).
  for (const table of ["creator_video_gmv"]) {
    await supabase.from(table).delete().lt("period_start", cutoff);
  }

  // Hapus arsip Storage kedaluwarsa.
  const { data: expiredRaw } = await supabase
    .from("upload_batches")
    .select("id, archive_path")
    .not("archive_path", "is", null)
    .lt("period_start", cutoff);
  const expired = (expiredRaw ?? []) as { id: string; archive_path: string | null }[];
  const paths = expired.map((e) => e.archive_path).filter((p): p is string => !!p);
  if (paths.length === 0) return;

  const admin = createAdminClient();
  const { error: rmErr } = await admin.storage.from(ARCHIVE_BUCKET).remove(paths);
  if (rmErr) throw new Error(rmErr.message);

  await supabase
    .from("upload_batches")
    .update({ archive_path: null, archive_deleted_at: new Date().toISOString() })
    .in(
      "id",
      expired.map((e) => e.id)
    );
}

// Baca flag checkbox force_reprocess dari form.
function readForceReprocess(formData: FormData): boolean {
  const raw = formData.get("force_reprocess");
  if (raw === null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

// Main server action: GMV Video Weekly Tracking ingest.
// Jalur: Parse workbook (Filter+Data) → Resolve kreator by username (auto-create) →
// Insert per-video rows → Archive JSON → Sweep retensi.
export async function runVideoGmvIngest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  // 1. File → sheets + hash.
  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return { ok: false, message: "File upload tidak ditemukan." };
  }
  const file = fileEntry;
  if (file.size === 0) return { ok: false, message: "File kosong." };
  const source_type = String(formData.get("source_type") || "").trim() || "tiktok";
  const platform = source_type;
  const force = readForceReprocess(formData);

  let sheets: WorkbookSheet[];
  let hash8: string;
  let hashFull: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    hashFull = fileHashFull(buf);
    hash8 = hashFull.slice(0, 8);
    sheets = await readWorkbookSheets(file);
  } catch (e) {
    return { ok: false, message: `Gagal membaca file: ${e instanceof Error ? e.message : String(e)}` };
  }

  // Router format: jika bukan video GMV → tolak.
  if (!isVideoGmvWorkbook(sheets)) {
    return {
      ok: false,
      message: `File bukan format "GMV Video Weekly Tracking" yang diharapkan. Cek kolom: Creator ID, Video ID, Video GMV.`,
    };
  }

  // 2. Parse workbook. Gagal → pesan error (belum ada batch row).
  const parsed = parseVideoGmvWorkbook(sheets);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const { periodStart, periodEnd, rows } = parsed;

  // 2b. Guard duplikat.
  const dupErr = await checkDuplicateGuard(supabase, hashFull, force);
  if (dupErr) return dupErr;

  // 3. Guard overlap periode.
  const overlapErr = await checkOverlapGuard(supabase, periodStart, periodEnd);
  if (overlapErr) return overlapErr;

  // 4. batch_id idempoten.
  const batch_id = buildBatchId(periodStart, hash8);

  // 5. Resolve kreator BY USERNAME (fallback name; else insert baru).
  const { data: existingRaw, error: exErr } = await supabase
    .from("mcn_creators")
    .select("id, username, name, owner_cpm_id, status")
    .eq("platform", platform);
  if (exErr) return { ok: false, message: `Gagal membaca master kreator: ${exErr.message}` };
  const existing = (existingRaw ?? []) as CreatorMaster[];

  const byUsername = new Map<string, CreatorMaster>();
  const byName = new Map<string, CreatorMaster>();
  for (const c of existing) {
    if (c.username) byUsername.set(c.username.toLowerCase(), c);
    if (c.name) byName.set(c.name.toLowerCase(), c);
  }

  const autoCreated: string[] = [];
  const toInsert: { name: string; username: string; platform: string; status: string }[] = [];
  const insertSeen = new Set<string>();
  const backfillIds: { id: string; username: string }[] = [];

  for (const row of rows) {
    const uKey = row.username.toLowerCase();
    if (byUsername.has(uKey)) continue; // already matched by username

    const nameMatch = byName.get(row.name.toLowerCase());
    if (nameMatch) {
      // Fallback name: use this master + backfill username.
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

  // Backfill username (best-effort).
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
        owner_cpm_id: null,
        status: "aktif",
      });
    }
  }

  // 6. Upsert upload_batches (staging) + failBatch.
  const staging = await upsertStagingBatch(supabase, {
    batch_id,
    source_type,
    periodStart,
    periodEnd,
    hash8,
    hashFull,
  });
  if (!staging.ok) return { ok: false, message: staging.message };
  const failBatch = makeFailBatch(supabase, staging.batchRowId);

  // 7. Build video_gmv insert rows (delete-then-insert per creator+period).
  const videoRowsToInsert: Record<string, unknown>[] = [];
  const creatorIds = new Set<string>();
  let unmatchedCount = 0;

  for (const row of rows) {
    const master = byUsername.get(row.username.toLowerCase());
    if (!master) {
      unmatchedCount++;
      continue; // seharusnya tidak terjadi setelah resolve
    }

    creatorIds.add(master.id);
    videoRowsToInsert.push({
      creator_id: master.id,
      batch_id,
      video_id: row.videoId,
      video_title: row.videoTitle,
      period_start: periodStart,
      period_end: periodEnd,
      views: row.views ?? 0,
      likes: row.likes ?? 0,
      comments: row.comments ?? 0,
      shares: row.shares ?? 0,
      sales_value: row.salesValue ?? 0,
      orders: row.orders ?? 0,
      conversion_rate: row.conversionRate ?? 0,
    });
  }

  if (videoRowsToInsert.length === 0) {
    return failBatch(`Tidak ada video ter-resolve dari file (${unmatchedCount} unmatched kreator).`);
  }

  // Delete existing video_gmv rows untuk creator+period (sebelum insert ulang).
  const creatorIdArray = Array.from(creatorIds);
  const { error: dErr } = await supabase
    .from("creator_video_gmv")
    .delete()
    .in("creator_id", creatorIdArray)
    .eq("period_start", periodStart);
  if (dErr) return failBatch(`Gagal membersihkan video GMV: ${dErr.message}`);

  // Insert per-video rows.
  if (videoRowsToInsert.length > 0) {
    const { error } = await supabase.from("creator_video_gmv").insert(videoRowsToInsert);
    if (error) return failBatch(`Gagal menulis video GMV: ${error.message}`);
  }

  // 8. Tandai processed + batch stats.
  const { error: pErr } = await supabase
    .from("upload_batches")
    .update({
      status: "processed",
      row_count_raw: rows.length,
      creators_count: creatorIds.size,
      processed_at: new Date().toISOString(),
    })
    .eq("id", staging.batchRowId);
  if (pErr) return failBatch(`Gagal menandai processed: ${pErr.message}`);

  // 9. Arsip RENDER ke Storage privat (best-effort).
  let archiveMsg = "";
  try {
    const retentionMonths = await getRetentionMonths(supabase);
    const archivePath = await archiveVideoGmvRender(supabase, {
      batchRowId: staging.batchRowId,
      batch_id,
      source_type,
      periodStart,
      periodEnd,
      hash8,
      rowCountRaw: rows.length,
      creatorsCount: creatorIds.size,
      videoRows: videoRowsToInsert,
    });
    archiveMsg = ` Arsip tersimpan: ${ARCHIVE_BUCKET}/${archivePath} (retensi ${retentionMonths} bulan).`;
  } catch (e) {
    archiveMsg = ` (Arsip gagal disimpan: ${e instanceof Error ? e.message : String(e)})`;
  }

  // 10. Sweep retensi (best-effort).
  try {
    await sweepExpiredWeeklyData(supabase);
  } catch {
    // sengaja diabaikan; sweep hanya safety net tambahan.
  }

  revalidatePath("/meago/workspace");
  revalidatePath("/meago/gmv-video");

  const autoMsg = autoCreated.length
    ? ` Auto-created: ${autoCreated.slice(0, 10).join(", ")}${autoCreated.length > 10 ? ` (+${autoCreated.length - 10})` : ""}.`
    : "";
  const unmatchedMsg = unmatchedCount > 0 ? ` Unmatched: ${unmatchedCount} baris (no username match).` : "";

  return {
    ok: true,
    message: `Ingest Video GMV ${periodStart}..${periodEnd} selesai: ${rows.length} baris, ${creatorIds.size} kreator, ${videoRowsToInsert.length} video.${autoMsg}${unmatchedMsg}${archiveMsg}`,
  };
}
