'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

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
 * Add new MCN creator (prospek status, manual entry).
 */
export async function addCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const name = String(formData.get('name') || '').trim();
  const platform = String(formData.get('platform') || 'tiktok').trim();
  const niche = String(formData.get('niche') || '').trim() || null;
  const notes = String(formData.get('notes') || '').trim() || null;

  if (!name) {
    return { ok: false, message: '[nama kreator wajib diisi]' };
  }

  try {
    const client = createClient();
    const { error } = await client.from('mcn_creators').insert({
      name,
      platform,
      niche,
      status: 'prospek',
      notes,
      created_by: user?.id,
    });

    if (error) {
      if (error.code === '23505') {
        return { ok: false, message: '[kreator sudah terdaftar di platform ini]' };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/mcn/creators');
    return { ok: true, message: `[${name} ditambahkan sebagai prospek]` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Assign CPM owner to creator.
 */
export async function assignOwner(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  // Check permission
  if (
    !me.is_director &&
    !me.is_od &&
    !(me.division === 'CreatorManagement' && me.rank === 'lead')
  ) {
    return {
      ok: false,
      message: '[hanya CM Lead atau management dapat assign owner]',
    };
  }

  const creatorId = String(formData.get('creator_id') || '').trim();
  const ownerCpmId = String(formData.get('owner_cpm_id') || '').trim();

  if (!creatorId || !ownerCpmId) {
    return { ok: false, message: '[creator dan owner wajib dipilih]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('mcn_creators')
      .update({ owner_cpm_id: ownerCpmId })
      .eq('id', creatorId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/mcn/creators');
    return { ok: true, message: '[owner CPM berhasil diupdate]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Toggle live_roster flag.
 */
export async function toggleRoster(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const creatorId = String(formData.get('creator_id') || '').trim();
  const newRoster = formData.get('live_roster') === 'true';

  if (!creatorId) {
    return { ok: false, message: '[creator wajib dipilih]' };
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

    revalidatePath('/mcn/creators');
    return {
      ok: true,
      message: `[live roster: ${newRoster ? 'aktif' : 'tidak aktif'}]`,
    };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Set ads budget cap.
 */
export async function setAdsBudgetCap(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const creatorId = String(formData.get('creator_id') || '').trim();
  const capStr = String(formData.get('ads_budget_cap') || '').trim();

  if (!creatorId) {
    return { ok: false, message: '[creator wajib dipilih]' };
  }

  const cap = capStr ? parseFloat(capStr) : null;
  if (capStr && (isNaN(cap!) || cap! < 0)) {
    return { ok: false, message: '[budget cap harus angka positif atau kosong]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('mcn_creators')
      .update({ ads_budget_cap: cap })
      .eq('id', creatorId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/mcn/creators');
    return {
      ok: true,
      message: `[ads budget cap: ${cap ? `${cap}` : 'tidak ada limit'}]`,
    };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Update creator status via state machine.
 */
export async function setCreatorStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const creatorId = String(formData.get('creator_id') || '').trim();
  const newStatus = String(formData.get('status') || '').trim();

  if (!creatorId || !newStatus) {
    return { ok: false, message: '[creator dan status wajib' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('mcn_creators')
      .update({
        status: newStatus,
        status_changed_by: user?.id,
        status_changed_at: new Date().toISOString(),
      })
      .eq('id', creatorId);

    if (error) {
      if (error.message.includes('[')) {
        // Error from trigger
        return { ok: false, message: error.message };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/mcn/creators');
    return { ok: true, message: `[status diupdate ke ${newStatus}]` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}
