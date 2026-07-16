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
 * Record new creator acquisition (binding).
 * Specialist = current actor (forced by DB trigger).
 * Snapshots commission_share, calculates GMV windows.
 */
export async function recordAcquisition(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const creatorId = String(formData.get('mcn_creator_id') || '').trim();
  const bindingDateStr = String(formData.get('binding_date') || '').trim();
  const leadSource = String(formData.get('lead_source') || '').trim();
  const commissionShare = String(formData.get('commission_share') || '').trim() || null;
  const notes = String(formData.get('notes') || '').trim() || null;

  if (!creatorId || !bindingDateStr || !leadSource) {
    return {
      ok: false,
      message: '[kreator, binding date, dan lead source wajib]',
    };
  }

  if (!['inbound', 'outbound', 'platform'].includes(leadSource)) {
    return { ok: false, message: '[lead source invalid]' };
  }

  try {
    const client = createClient();

    // Fetch creator to confirm status = prospek or binding
    const { data: creator } = await client
      .from('mcn_creators')
      .select('*')
      .eq('id', creatorId)
      .single();

    if (!creator) {
      return { ok: false, message: '[kreator tidak ditemukan]' };
    }

    if (!['prospek', 'binding'].includes(creator.status)) {
      return {
        ok: false,
        message: `[hanya prospek/binding dapat di-binding, saat ini ${creator.status}]`,
      };
    }

    // Calculate quarter end
    const bindingDate = new Date(bindingDateStr);
    const quarterStart = new Date(
      bindingDate.getFullYear(),
      Math.floor(bindingDate.getMonth() / 3) * 3,
      1
    );
    const quarterEnd = new Date(quarterStart);
    quarterEnd.setMonth(quarterEnd.getMonth() + 3);
    quarterEnd.setDate(quarterEnd.getDate() - 1);
    const quarterEndStr = quarterEnd.toISOString().split('T')[0];

    // Record acquisition
    const { error: acqErr } = await client.from('acquisitions').insert({
      mcn_creator_id: creatorId,
      specialist_id: user?.id, // Will be forced by trigger
      lead_source: leadSource,
      binding_date: bindingDateStr,
      commission_share_at_binding: commissionShare
        ? parseFloat(commissionShare)
        : creator.commission_share,
      quarter_end: quarterEndStr,
      notes,
    });

    if (acqErr) {
      return { ok: false, message: acqErr.message };
    }

    // Update creator status: prospek → binding
    if (creator.status === 'prospek') {
      await client
        .from('mcn_creators')
        .update({
          status: 'binding',
          status_changed_by: user?.id,
          status_changed_at: new Date().toISOString(),
        })
        .eq('id', creatorId);
    }

    revalidatePath('/acquisition');
    return { ok: true, message: '[acquisition dicatat]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Record a referral (antar-creator or platform).
 * antar_creator requires referrer_creator_id.
 * platform requires referrer_creator_id = null.
 */
export async function recordReferral(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const newCreatorId = String(formData.get('new_creator_id') || '').trim();
  const referralSource = String(formData.get('referral_source') || '').trim();
  const referrerCreatorId = String(
    formData.get('referrer_creator_id') || ''
  ).trim() || null;

  if (!newCreatorId || !referralSource) {
    return { ok: false, message: '[kreator baru dan sumber referral wajib]' };
  }

  if (!['antar_creator', 'platform'].includes(referralSource)) {
    return { ok: false, message: '[referral_source invalid]' };
  }

  if (referralSource === 'antar_creator' && !referrerCreatorId) {
    return {
      ok: false,
      message: '[antar_creator harus memiliki referrer]',
    };
  }

  if (referralSource === 'platform' && referrerCreatorId) {
    return {
      ok: false,
      message: '[platform tidak boleh memiliki referrer]',
    };
  }

  try {
    const client = createClient();
    const { error } = await client.from('referrals').insert({
      new_creator_id: newCreatorId,
      referrer_creator_id: referrerCreatorId,
      referral_source: referralSource,
      recorded_by: user?.id,
    });

    if (error) {
      if (error.message.includes('[')) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/acquisition');
    return { ok: true, message: '[referral dicatat]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Mark referral as paid.
 * Only lead/director/OD can mark paid.
 */
export async function markReferralPaid(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  // Check permission
  if (!me.is_director && !me.is_od && me.rank !== 'lead') {
    return {
      ok: false,
      message: '[hanya Lead, OD, atau Director dapat mark paid]',
    };
  }

  const referralId = String(formData.get('referral_id') || '').trim();

  if (!referralId) {
    return { ok: false, message: '[referral ID wajib]' };
  }

  try {
    const client = createClient();

    // Check if already paid
    const { data: referral } = await client
      .from('referrals')
      .select('commission_status')
      .eq('id', referralId)
      .single();

    if (referral?.commission_status === 'dibayar') {
      return { ok: false, message: '[komisi sudah dibayar sebelumnya]' };
    }

    const { error } = await client
      .from('referrals')
      .update({ commission_status: 'dibayar' })
      .eq('id', referralId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/acquisition');
    return { ok: true, message: '[komisi referral dibayar]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Mark acquisition handoff as done.
 * Blocks until creator has owner_cpm_id (assigned by CM).
 * On success: creator status → aktif.
 */
export async function markHandoffDone(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const acquisitionId = String(formData.get('acquisition_id') || '').trim();

  if (!acquisitionId) {
    return { ok: false, message: '[acquisition ID wajib]' };
  }

  try {
    const client = createClient();

    // Fetch acquisition & creator
    const { data: acq } = await client
      .from('acquisitions')
      .select('mcn_creator_id')
      .eq('id', acquisitionId)
      .single();

    if (!acq) {
      return { ok: false, message: '[acquisition tidak ditemukan]' };
    }

    const { data: creator } = await client
      .from('mcn_creators')
      .select('owner_cpm_id')
      .eq('id', acq.mcn_creator_id)
      .single();

    if (!creator?.owner_cpm_id) {
      return {
        ok: false,
        message: '[kreator belum di-assign CPM; arahkan ke CM Lead]',
      };
    }

    // Update acquisition handoff_done
    const { error: acqErr } = await client
      .from('acquisitions')
      .update({ handoff_done: true })
      .eq('id', acquisitionId);

    if (acqErr) {
      return { ok: false, message: acqErr.message };
    }

    // Update creator status → aktif
    const { error: creatorErr } = await client
      .from('mcn_creators')
      .update({
        status: 'aktif',
        status_changed_by: user?.id,
        status_changed_at: new Date().toISOString(),
      })
      .eq('id', acq.mcn_creator_id);

    if (creatorErr) {
      return { ok: false, message: creatorErr.message };
    }

    revalidatePath('/acquisition');
    return { ok: true, message: '[handoff selesai, kreator aktif]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Refresh GMV post-join for an acquisition.
 * Fetches GMV in window from config (default 90 days after binding).
 */
export async function refreshGmvPostJoin(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const acquisitionId = String(formData.get('acquisition_id') || '').trim();

  if (!acquisitionId) {
    return { ok: false, message: '[acquisition ID wajib]' };
  }

  try {
    const client = createClient();

    // Fetch config (default 90 days)
    const { data: config } = await client
      .from('app_config')
      .select('value')
      .eq('key', 'mcn.gmv_post_join_days')
      .single();

    const windowDays = config ? parseInt(JSON.stringify(config.value), 10) : 90;

    // Fetch acquisition
    const { data: acq } = await client
      .from('acquisitions')
      .select('mcn_creator_id, binding_date')
      .eq('id', acquisitionId)
      .single();

    if (!acq) {
      return { ok: false, message: '[acquisition tidak ditemukan]' };
    }

    // Calculate window: [binding_date, binding_date + window days)
    const bindDate = new Date(acq.binding_date);
    const endDate = new Date(bindDate);
    endDate.setDate(endDate.getDate() + windowDays);

    // Sum GMV in window from creator_period_summary
    const { data: summaries } = await client
      .from('creator_period_summary')
      .select('affiliate_gmv, period_start')
      .eq('mcn_creator_id', acq.mcn_creator_id)
      .gte('period_start', acq.binding_date)
      .lt('period_start', endDate.toISOString().split('T')[0]);

    const gmvPostJoin = summaries?.reduce(
      (sum, s) => sum + (s.affiliate_gmv || 0),
      0
    ) || 0;

    // Update acquisition
    const { error } = await client
      .from('acquisitions')
      .update({ gmv_post_join: gmvPostJoin })
      .eq('id', acquisitionId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/acquisition');
    return { ok: true, message: `[GMV post-join: ${gmvPostJoin.toFixed(2)}]` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}
