'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { buildCopiedSlots, targetWeekHasSlots } from '@/lib/mcn/copy-week';

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
 * Create a live schedule slot.
 */
export async function createLiveSlot(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const creatorId = String(formData.get('mcn_creator_id') || '').trim();
  const dateStr = String(formData.get('schedule_date') || '').trim();
  const startTime = String(formData.get('start_time') || '').trim() || null;
  const endTime = String(formData.get('end_time') || '').trim() || null;
  const status = String(formData.get('status') || 'scheduled').trim();
  const brandName = String(formData.get('brand_name') || '').trim() || null;
  const dealId = String(formData.get('deal_id') || '').trim() || null;

  if (!creatorId || !dateStr) {
    return { ok: false, message: '[kreator dan tanggal wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client.from('live_schedule_slots').insert({
      mcn_creator_id: creatorId,
      schedule_date: dateStr,
      start_time: startTime,
      end_time: endTime,
      status,
      brand_name: brandName,
      deal_id: dealId || null,
      created_by: user?.id,
    });

    if (error) {
      if (error.message.includes('[')) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/mcn/schedule');
    return { ok: true, message: '[slot dibuat]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Update a live schedule slot.
 */
export async function updateLiveSlot(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const slotId = String(formData.get('slot_id') || '').trim();
  const status = String(formData.get('status') || '').trim() || undefined;
  const startTime = String(formData.get('start_time') || '').trim() || null;
  const endTime = String(formData.get('end_time') || '').trim() || null;
  const brandName = String(formData.get('brand_name') || '').trim() || null;
  const pkReady = formData.get('pk_ready') === 'true';
  const productConnectedTap = formData.get('product_connected_tap') === 'true';

  if (!slotId) {
    return { ok: false, message: '[slot ID wajib]' };
  }

  try {
    const client = createClient();
    const updates: Record<string, any> = {
      updated_by: user?.id,
    };

    if (status) updates.status = status;
    if (startTime !== null) updates.start_time = startTime;
    if (endTime !== null) updates.end_time = endTime;
    if (brandName !== null) updates.brand_name = brandName;
    updates.pk_ready = pkReady;
    updates.product_connected_tap = productConnectedTap;

    const { error } = await client
      .from('live_schedule_slots')
      .update(updates)
      .eq('id', slotId);

    if (error) {
      if (error.message.includes('[')) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/mcn/schedule');
    return { ok: true, message: '[slot diupdate]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Delete a live schedule slot.
 */
export async function deleteLiveSlot(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const slotId = String(formData.get('slot_id') || '').trim();

  if (!slotId) {
    return { ok: false, message: '[slot ID wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('live_schedule_slots')
      .delete()
      .eq('id', slotId);

    if (error) {
      if (error.message.includes('[')) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/mcn/schedule');
    return { ok: true, message: '[slot dihapus]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Verify a live schedule slot (mark done with verification).
 */
export async function verifyLiveSlot(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const slotId = String(formData.get('slot_id') || '').trim();
  const actualStart = String(formData.get('actual_start') || '').trim();
  const actualEnd = String(formData.get('actual_end') || '').trim() || null;

  if (!slotId || !actualStart) {
    return { ok: false, message: '[slot dan actual_start wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('live_schedule_slots')
      .update({
        status: 'done',
        actual_start: actualStart,
        actual_end: actualEnd,
        verified_by: user?.id,
        verified_at: new Date().toISOString(),
        status_changed_by: user?.id,
        status_changed_at: new Date().toISOString(),
      })
      .eq('id', slotId);

    if (error) {
      if (error.message.includes('[')) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/mcn/schedule');
    return { ok: true, message: '[slot terverifikasi]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Copy a week of slots to a target week.
 */
export async function copyWeek(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const creatorId = String(formData.get('mcn_creator_id') || '').trim();
  const targetMonday = String(formData.get('target_monday') || '').trim();

  if (!creatorId || !targetMonday) {
    return { ok: false, message: '[kreator dan target minggu wajib]' };
  }

  try {
    const client = createClient();

    // Fetch source week slots
    const { data: sourceSlots } = await client
      .from('live_schedule_slots')
      .select('*')
      .eq('mcn_creator_id', creatorId);

    if (!sourceSlots || sourceSlots.length === 0) {
      return { ok: false, message: '[tidak ada slot untuk dicopy]' };
    }

    // Check target week is empty
    if (targetWeekHasSlots(sourceSlots, targetMonday)) {
      return {
        ok: false,
        message: '[minggu target sudah memiliki slot, hapus terlebih dahulu]',
      };
    }

    // Build copied slots
    const copiedSlots = buildCopiedSlots(sourceSlots, targetMonday);

    if (copiedSlots.length === 0) {
      return { ok: false, message: '[tidak ada slot non-OFF untuk dicopy]' };
    }

    // Insert copied slots
    const { error: insertError } = await client
      .from('live_schedule_slots')
      .insert(
        copiedSlots.map((slot) => ({
          ...slot,
          created_by: user?.id,
        }))
      );

    if (insertError) {
      return { ok: false, message: insertError.message };
    }

    revalidatePath('/mcn/schedule');
    return {
      ok: true,
      message: `[${copiedSlots.length} slot dicopy ke minggu ${targetMonday}]`,
    };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Toggle live_roster flag for a creator.
 */
export async function toggleLiveRoster(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const creatorId = String(formData.get('mcn_creator_id') || '').trim();
  const newRoster = formData.get('live_roster') === 'true';

  if (!creatorId) {
    return { ok: false, message: '[kreator wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('mcn_creators')
      .update({ live_roster: newRoster })
      .eq('id', creatorId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/mcn/schedule');
    return {
      ok: true,
      message: `[live roster: ${newRoster ? 'aktif' : 'tidak aktif'}]`,
    };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}
