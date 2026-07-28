"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fileHashFull, readWorkbookSheets } from "@/lib/mcn/file-read";
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

// Label source_type khusus jalur video di upload_batches — memisahkan batch video dari
// batch "Upload Data Mingguan" (source_type 'tiktok') yang mengisi creator_period_summary,
// supaya guard duplikat/overlap & sweep retensi tiap jalur tidak saling mengganggu.
const VIDEO_SOURCE_TYPE = "tiktok_video";
// Platform master kreator (mcn_creators.platform) — MEAGO TikTok-only.
const CREATOR_PLATFORM = "tiktok";

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
    .eq("source_type", VIDEO_SOURCE_TYPE)
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
    .eq("source_type", VIDEO_SOURCE_TYPE)
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
  // Prefix "video-" memisahkan arsip jalur ini dari arsip jalur summary yang memakai
  // bucket & skema path yang sama (`<period_start>/<hash8>.json`).
  const archive_path = `${args.periodStart}/video-${args.hash8}.json`;

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

  // Hapus baris agregat video kedaluwarsa. Tabel summary/subcat/top_products TIDAK
  // disentuh di sini — itu tanggung jawab sweep jalur summary (mcn-ingest.ts).
  await supabase.from("creator_video_gmv").delete().lt("period_start", cutoff);

  // Hapus arsip Storage kedaluwarsa MILIK JALUR VIDEO saja. Tanpa filter source_type,
  // sweep ini akan menghapus arsip batch summary padahal baris agregatnya tidak ikut
  // dipangkas di sini (audit trail jalur lain jadi hilang tanpa sebab).
  const { data: expiredRaw } = await supabase
    .from("upload_batches")
    .select("id, archive_path")
    .eq("source_type", VIDEO_SOURCE_TYPE)
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

// Ambil SELURUH master kreator dengan paginasi .range(). PostgREST memotong hasil di
// 1000 baris bila tidak di-range — dengan >1000 kreator, sisanya akan dianggap "belum
// ada" dan ter-auto-create sebagai duplikat (akar masalah yang sama seperti bug daftar
// prospek terpotong). Jangan ganti dengan select tanpa range.
const CREATOR_PAGE = 1000;
async function fetchAllCreators(
  supabase: SupabaseClient,
  platform: string
): Promise<{ ok: true; rows: CreatorMaster[] } | { ok: false; message: string }> {
  const all: CreatorMaster[] = [];
  for (let from = 0; ; from += CREATOR_PAGE) {
    const { data, error } = await supabase
      .from("mcn_creators")
      .select("id, username, name, owner_cpm_id, status")
      .eq("platform", platform)
      .order("id", { ascending: true })
      .range(from, from + CREATOR_PAGE - 1);
    if (error) return { ok: false, message: `Gagal membaca master kreator: ${error.message}` };
    const page = (data ?? []) as CreatorMaster[];
    all.push(...page);
    if (page.length < CREATOR_PAGE) return { ok: true, rows: all };
  }
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
  // source_type = LABEL batch (membedakan jalur video dari jalur summary di
  // upload_batches). platform = kolom master kreator, TETAP 'tiktok' — jangan
  // disamakan dengan source_type, kalau tidak lookup kreator tak akan pernah cocok
  // dan semua kreator ter-auto-create sebagai duplikat.
  const source_type = VIDEO_SOURCE_TYPE;
  const platform = CREATOR_PLATFORM;
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

  // Router format: tolak file yang salah jenis sebelum parsing penuh. Export Creator
  // Analysis biasa (yang mengisi creator_period_summary lewat form "Upload Data
  // Mingguan") punya "Live streams" dan TIDAK punya "Video views"/"CTR" — supaya tidak
  // tertukar, form ini hanya menerima slice PostOnly.
  if (!isVideoGmvWorkbook(sheets)) {
    return {
      ok: false,
      message:
        'File bukan export "Creator Analysis — PostOnly" yang diharapkan (kolom "Video views" & "CTR" tidak ditemukan). ' +
        'Export performa biasa yang berisi "Live streams" diunggah lewat card "Upload Data Mingguan" di halaman Data Kreator.',
    };
  }

  // 2. Parse workbook. Gagal → pesan error (belum ada batch row).
  const parsed = parseVideoGmvWorkbook(sheets);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  const { periodStart, periodEnd, rows, skipped } = parsed;

  // 2b. Guard duplikat.
  const dupErr = await checkDuplicateGuard(supabase, hashFull, force);
  if (dupErr) return dupErr;

  // 3. Guard overlap periode.
  const overlapErr = await checkOverlapGuard(supabase, periodStart, periodEnd);
  if (overlapErr) return overlapErr;

  // 4. batch_id idempoten.
  // batch_id BUKAN buildBatchId(): helper itu menghasilkan `ingest:<start>:<hash8>` yang
  // dipakai jalur summary. File PostOnly ini juga dikenali oleh jalur summary, jadi kalau
  // file yang sama diunggah ke kedua form, hash8-nya identik → batch_id identik → batch
  // jalur lain ikut ter-reset ke staging. Namespace terpisah mencegah tabrakan itu.
  const batch_id = `video:${periodStart}:${hash8}`;

  // 5. Resolve kreator BY USERNAME (fallback name; else insert baru).
  const masters = await fetchAllCreators(supabase, platform);
  if (!masters.ok) return { ok: false, message: masters.message };
  const existing = masters.rows;

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
  // lower(name) yang sudah terpakai — master existing + yang dijadwalkan insert.
  // mcn_creators unik pada (platform, lower(name)), jadi dua kreator berbeda dengan
  // nama tampilan sama akan menabrak 23505 dan menggagalkan SELURUH batch.
  const nameTaken = new Set<string>(byName.keys());

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
      // Nama bentrok dgn kreator lain (nama tampilan TikTok tidak unik) → bedakan
      // dengan username supaya insert tidak gagal; username tetap identitas aslinya.
      let name = row.name;
      if (nameTaken.has(name.toLowerCase())) name = `${row.name} (${row.username})`;
      nameTaken.add(name.toLowerCase());
      toInsert.push({ name, username: row.username, platform, status: "aktif" });
      autoCreated.push(row.username);
    }
  }

  // Backfill username (best-effort).
  for (const b of backfillIds) {
    const { error } = await supabase.from("mcn_creators").update({ username: b.username }).eq("id", b.id);
    if (error) return { ok: false, message: `Gagal backfill username: ${error.message}` };
  }

  // Insert kreator baru → daftarkan ke byUsername. Dipotong per 500 supaya file besar
  // (±1.900 kreator) tidak menabrak batas ukuran request.
  if (toInsert.length > 0) {
    const insertData = new Map(toInsert.map((t) => [t.username.toLowerCase(), t]));
    const created: { id: string; username: string | null }[] = [];
    for (let i = 0; i < toInsert.length; i += 500) {
      const { data, error: cErr } = await supabase
        .from("mcn_creators")
        .insert(toInsert.slice(i, i + 500))
        .select("id, username");
      if (cErr) return { ok: false, message: `Gagal membuat kreator baru: ${cErr.message}` };
      created.push(...((data ?? []) as { id: string; username: string | null }[]));
    }
    for (const c of created) {
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

  // 7. Build baris insert (delete-then-insert per kreator+periode).
  // Dedup per kreator: satu kreator bisa muncul lebih dari sekali di file. Tanpa dedup,
  // insert menabrak unique (creator_id, period_start) dan MENGGAGALKAN seluruh batch
  // dengan error Postgres mentah. Occurrence terakhir menang (bukan dijumlahkan — baris
  // berulang adalah pengulangan data yang sama, bukan tambahan).
  const byCreator = new Map<string, Record<string, unknown>>();
  let unmatchedCount = 0;
  let dedupedCount = 0;

  for (const row of rows) {
    const master = byUsername.get(row.username.toLowerCase());
    if (!master) {
      unmatchedCount++;
      continue; // seharusnya tidak terjadi setelah resolve
    }

    if (byCreator.has(master.id)) dedupedCount++;
    byCreator.set(master.id, {
      creator_id: master.id,
      batch_id,
      period_start: periodStart,
      period_end: periodEnd,
      sales_value: row.salesValue,
      orders: row.orders,
      aov: row.aov,
      redemption_amount: row.redemptionAmount,
      redeemed_orders: row.redeemedOrders,
      new_posts: row.newPosts,
      posts_with_views: row.postsWithViews,
      posts_with_sales: row.postsWithSales,
      video_views: row.videoViews,
      ctr: row.ctr,
      cvr: row.cvr,
      avg_views_per_post: row.avgViewsPerPost,
      avg_sales_value_per_post: row.avgSalesValuePerPost,
      binding_status: row.bindingStatus,
      creator_level: row.creatorLevel,
      city: row.city,
    });
  }

  const videoRowsToInsert = [...byCreator.values()];
  const creatorIds = new Set(byCreator.keys());
  if (videoRowsToInsert.length === 0) {
    return failBatch(`Tidak ada kreator ter-resolve dari file (${unmatchedCount} baris unmatched).`);
  }

  // Bersihkan baris minggu ini untuk kreator yang sama sebelum insert ulang, supaya
  // proses ulang periode yang sama tidak menabrak unique constraint. Minggu LAIN tidak
  // tersentuh — riwayat mingguan tetap utuh.
  const { error: dErr } = await supabase
    .from("creator_video_gmv")
    .delete()
    .in("creator_id", [...creatorIds])
    .eq("period_start", periodStart);
  if (dErr) return failBatch(`Gagal membersihkan GMV video: ${dErr.message}`);

  // Insert per potongan: file mingguan berisi ~1.900 kreator, satu insert raksasa mudah
  // kena batas ukuran request PostgREST.
  const INSERT_CHUNK = 500;
  for (let i = 0; i < videoRowsToInsert.length; i += INSERT_CHUNK) {
    const chunk = videoRowsToInsert.slice(i, i + INSERT_CHUNK);
    const { error } = await supabase.from("creator_video_gmv").insert(chunk);
    if (error) {
      return failBatch(
        `Gagal menulis GMV video (baris ${i + 1}–${i + chunk.length} dari ${videoRowsToInsert.length}): ${error.message}`
      );
    }
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

  // Ringkasan WAJIB menyebut semua yang tidak masuk apa adanya — kreator baru yang
  // dibuat otomatis, baris yang di-skip parser, duplikat yang digabung, dan baris tanpa
  // kreator ter-resolve. Tidak ada yang dibuang diam-diam.
  const autoMsg = autoCreated.length
    ? ` Kreator baru dibuat otomatis (${autoCreated.length}, CM belum di-assign): ${autoCreated.slice(0, 10).join(", ")}${autoCreated.length > 10 ? ` (+${autoCreated.length - 10} lagi)` : ""}.`
    : "";
  const skippedPreview = skipped
    .slice(0, 10)
    .map((s) => `baris ${s.rowIndex}: ${s.reason}`)
    .join("; ");
  const skipMsg = skipped.length
    ? ` Skipped ${skipped.length}: ${skippedPreview}${skipped.length > 10 ? ` (+${skipped.length - 10})` : ""}.`
    : "";
  const dedupMsg = dedupedCount > 0 ? ` ${dedupedCount} baris video duplikat digabung (nilai terakhir dipakai).` : "";
  const unmatchedMsg = unmatchedCount > 0 ? ` Unmatched: ${unmatchedCount} baris tanpa kreator ter-resolve.` : "";

  return {
    ok: true,
    message: `Ingest Video GMV ${periodStart}..${periodEnd} selesai: ${rows.length} baris, ${creatorIds.size} kreator, ${videoRowsToInsert.length} video.${autoMsg}${dedupMsg}${unmatchedMsg}${skipMsg}${archiveMsg}`,
  };
}
