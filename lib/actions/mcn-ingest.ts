'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { readAndHashFile, parseCsvToRows } from '@/lib/mcn/file-read';
import { parsePlatformRows, aggregateRows } from '@/lib/mcn/ingest';
import { validateW1W5Period } from '@/lib/mcn/weeks';
import { buildMonthlyAverages } from '@/lib/mcn/weeks';

export type ActionResult = { ok: boolean; message: string };

async function ctx() {
  const client = createClient();
  const auth = await client.auth.getUser();
  if (!auth.data.user?.id) {
    return { error: '[tidak ada autentikasi]' };
  }

  const { data: me } = await client
    .from('employees')
    .select('*')
    .eq('id', auth.data.user.id)
    .single();

  if (!me) {
    return { error: '[user tidak ditemukan di employees]' };
  }

  return { ok: true, user: auth.data.user, me };
}

/**
 * Run full ingest pipeline: upload → parse → aggregate → auto-fill → save.
 * Tolerant: skip invalid rows, auto-create new creators, report diagnostics.
 */
export async function runIngest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  // Check permission
  if (
    !me.is_director &&
    !me.is_od &&
    me.division !== 'CreatorManagement'
  ) {
    return {
      ok: false,
      message: '[hanya CM atau management dapat upload ingest]',
    };
  }

  const fileForm = formData.get('file');
  if (!fileForm || !(fileForm instanceof File)) {
    return { ok: false, message: '[file wajib diupload]' };
  }

  try {
    // Step 1: Read & hash file
    const { content, hash8 } = await readAndHashFile(fileForm);
    if (!content && !fileForm.name.endsWith('.xlsx')) {
      return { ok: false, message: '[file kosong]' };
    }

    // Step 2: Parse CSV to rows
    const cells = parseCsvToRows(content);
    if (cells.length < 2) {
      return {
        ok: false,
        message: '[file minimal 2 baris (header + data)]',
      };
    }

    // Step 3: Parse platform rows
    const { rows, skipped, creatorNames, headerDiagnostic } =
      parsePlatformRows(cells);

    if (rows.length === 0) {
      return {
        ok: false,
        message: `[tidak ada baris valid; header ditemukan: ${headerDiagnostic.found.join(', ')}]`,
      };
    }

    // Step 4: Validate period (W1–W5)
    // Extract period from first row or header (TODO: more flexible extraction)
    // For now, user must provide via form field
    const periodStartStr = String(formData.get('period_start') || '').trim();
    const periodEndStr = String(formData.get('period_end') || '').trim();

    if (!periodStartStr || !periodEndStr) {
      return {
        ok: false,
        message: '[periode start dan end wajib (W1-W5 format)]',
      };
    }

    let periodInfo;
    try {
      periodInfo = validateW1W5Period(periodStartStr, periodEndStr);
    } catch (err: any) {
      return { ok: false, message: err.message };
    }

    // Step 5: Aggregate rows
    const { summaries, topProducts } = aggregateRows(
      rows,
      periodStartStr,
      periodEndStr
    );

    // Step 6: Check for batch overlap (same creator, overlapping periods)
    const client = createClient();
    const { data: existingBatches } = await client
      .from('upload_batches')
      .select('*')
      .eq('source_type', 'tiktok')
      .neq('status', 'failed');

    for (const summary of summaries) {
      const overlap = existingBatches?.some((b) => {
        const bStart = new Date(b.period_start);
        const bEnd = new Date(b.period_end);
        const pStart = new Date(periodStartStr);
        const pEnd = new Date(periodEndStr);

        // Overlapping ranges?
        return bStart <= pEnd && pStart <= bEnd;
      });

      if (overlap) {
        return {
          ok: false,
          message: `[batch dengan periode overlap sudah diproses]`,
        };
      }
    }

    // Step 7: Auto-create creators from summaries (if not exist)
    const autoCreated: string[] = [];
    for (const creatorName of creatorNames) {
      const { data: existing } = await client
        .from('mcn_creators')
        .select('id')
        .eq('name', creatorName)
        .eq('platform', 'tiktok')
        .single();

      if (!existing) {
        const { error: createErr } = await client
          .from('mcn_creators')
          .insert({
            name: creatorName,
            platform: 'tiktok',
            status: 'aktif', // Auto from report = aktif
            created_by: user?.id,
          });

        if (!createErr) {
          autoCreated.push(creatorName);
        }
      }
    }

    // Step 8: Save upload batch
    const batchId = `ingest:${periodStartStr}:${hash8}`;
    const { data: uploadBatch, error: batchErr } = await client
      .from('upload_batches')
      .insert({
        batch_id: batchId,
        source_type: 'tiktok',
        uploaded_by: user?.id,
        row_count_raw: rows.length,
        creators_count: creatorNames.size,
        period_start: periodStartStr,
        period_end: periodEndStr,
        file_hash: hash8,
        status: 'staging',
      })
      .select()
      .single();

    if (batchErr) {
      return { ok: false, message: batchErr.message };
    }

    // Step 9: Upsert creator_period_summary
    for (const summary of summaries) {
      const { error: summaryErr } = await client
        .from('creator_period_summary')
        .insert({
          mcn_creator_id: (
            await client
              .from('mcn_creators')
              .select('id')
              .eq('name', summary.creator_name)
              .eq('platform', 'tiktok')
              .single()
          ).data?.id,
          period_start: periodStartStr,
          period_end: periodEndStr,
          upload_batch: batchId,
          gmv_total: summary.gmv_total,
          affiliate_gmv: summary.affiliate_gmv,
          affiliate_live_gmv: summary.affiliate_live_gmv,
          affiliate_video_gmv: summary.affiliate_video_gmv,
          live_orders: summary.live_orders,
          video_orders: summary.video_orders,
          orders: summary.orders,
          items_sold: summary.items_sold,
          refund_gmv: summary.refund_gmv,
          ctr: summary.ctr,
          ctor: summary.ctor,
          live_pct: summary.live_pct,
        });

      // Ignore unique constraint violations (re-run same batch)
      if (summaryErr && summaryErr.code !== '23505') {
        console.error('Summary insert error:', summaryErr);
      }
    }

    // Step 10: Auto-fill master creator (monthly averages)
    for (const creatorName of creatorNames) {
      const { data: creator } = await client
        .from('mcn_creators')
        .select('id')
        .eq('name', creatorName)
        .eq('platform', 'tiktok')
        .single();

      if (creator) {
        // Get all historical summaries for this creator
        const { data: allSummaries } = await client
          .from('creator_period_summary')
          .select('gmv_total, affiliate_gmv, affiliate_live_gmv, affiliate_video_gmv, created_at')
          .eq('mcn_creator_id', creator.id);

        if (allSummaries && allSummaries.length > 0) {
          // Calculate monthly averages
          const gmvAvg = buildMonthlyAverages(
            allSummaries.map((s) => ({
              period_start: '', // Not needed for builMonthlyAverages as we use created_at
              value: s.affiliate_gmv || 0,
              createdAt: s.created_at,
            }))
          );

          // Update master (only if changed)
          const { error: updateErr } = await client
            .from('mcn_creators')
            .update({
              gmv: gmvAvg.avg,
              gmv_live: gmvAvg.avg, // TODO: separate live average
              gmv_video: gmvAvg.avg, // TODO: separate video average
            })
            .eq('id', creator.id);
        }
      }
    }

    // Step 11: Mark batch as processed
    await client
      .from('upload_batches')
      .update({ status: 'processed', processed_at: new Date().toISOString() })
      .eq('id', uploadBatch.id);

    // Step 12: Report results
    const reportMsg = `[ingest selesai: ${rows.length} baris, ${creatorNames.size} kreator, ${autoCreated.length} auto-created, ${skipped.length} skip]`;

    revalidatePath('/mcn/workspace');
    return { ok: true, message: reportMsg };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}
