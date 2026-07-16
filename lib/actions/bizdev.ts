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
 * Create a shop lead from CM (enters leads M1 with source 'MCN Shop Lead').
 */
export async function createShopLead(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const shopName = String(formData.get('shop_name') || '').trim();
  const platformLink = String(formData.get('platform_link') || '').trim();
  const niche = String(formData.get('niche') || '').trim() || null;
  const estimatedGmv = String(formData.get('estimated_gmv') || '').trim() || null;
  const notes = String(formData.get('notes') || '').trim() || null;

  if (!shopName) {
    return { ok: false, message: '[nama shop wajib]' };
  }

  try {
    const client = createClient();

    // Insert into leads (M1) with source 'MCN Shop Lead'
    const { error } = await client.from('leads').insert({
      prospect_name: shopName,
      platform_link: platformLink,
      lead_source: 'MCN Shop Lead',
      lead_status: '[Prospek]',
      niche,
      notes,
      owner_id: user?.id,
      created_by: user?.id,
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/leads');
    revalidatePath('/bizdev');
    return { ok: true, message: `[shop lead ${shopName} dicatat]` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Create a campaign request (routing start).
 */
export async function createCampaignRequest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const dealId = String(formData.get('deal_id') || '').trim();
  const creatorId = String(formData.get('mcn_creator_id') || '').trim();
  const needsBrandAcc = formData.get('needs_brand_acc') === 'true';

  if (!dealId || !creatorId) {
    return { ok: false, message: '[deal dan kreator wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client.from('campaign_requests').insert({
      deal_id: dealId,
      mcn_creator_id: creatorId,
      needs_brand_acc: needsBrandAcc,
      brand_acc_status: needsBrandAcc ? 'menunggu' : 'n_a',
      created_by: user?.id,
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/bizdev');
    return { ok: true, message: '[routing dimulai]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Update CM confirm status.
 */
export async function cmConfirmRouting(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const requestId = String(formData.get('campaign_request_id') || '').trim();
  const confirm = formData.get('confirm') === 'true'; // true = mau, false = tidak

  if (!requestId) {
    return { ok: false, message: '[request ID wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('campaign_requests')
      .update({
        cm_confirm_status: confirm ? 'mau' : 'tidak',
      })
      .eq('id', requestId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/bizdev');
    return {
      ok: true,
      message: `[CM: ${confirm ? 'mau' : 'tidak'}]`,
    };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Update brand approval status.
 */
export async function brandAcceptRouting(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const requestId = String(formData.get('campaign_request_id') || '').trim();
  const approved = formData.get('approved') === 'true';

  if (!requestId) {
    return { ok: false, message: '[request ID wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('campaign_requests')
      .update({
        brand_acc_status: approved ? 'approved' : 'ditolak',
      })
      .eq('id', requestId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/bizdev');
    return {
      ok: true,
      message: `[Brand: ${approved ? 'approved' : 'ditolak'}]`,
    };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Mark handover done.
 */
export async function handoverRouting(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const requestId = String(formData.get('campaign_request_id') || '').trim();

  if (!requestId) {
    return { ok: false, message: '[request ID wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('campaign_requests')
      .update({
        final_status: 'proses',
        handover_done: true,
      })
      .eq('id', requestId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/bizdev');
    return { ok: true, message: '[handover selesai]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}
