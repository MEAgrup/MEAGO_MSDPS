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
 * Create a special project.
 * Only lead / OD / Director can create.
 */
export async function createProject(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  // Check permission: lead, od, director
  if (
    !me.is_director &&
    !me.is_od &&
    !(me.rank === 'lead')
  ) {
    return {
      ok: false,
      message: '[hanya Lead, OD, atau Director dapat membuat project]',
    };
  }

  const name = String(formData.get('name') || '').trim();
  const industryCategory = String(
    formData.get('industry_category') || ''
  ).trim();
  const startDateStr = String(formData.get('start_date') || '').trim();
  const endDateStr = String(formData.get('end_date') || '').trim();
  const creatorsNeededStr = String(
    formData.get('creators_needed') || ''
  ).trim();
  const adsBudget = String(formData.get('ads_budget') || '').trim() || null;
  const targetGmv = String(formData.get('target_gmv') || '').trim() || null;
  const description = String(formData.get('description') || '').trim() || null;

  // Validate
  if (!name) return { ok: false, message: '[nama project wajib]' };
  if (!industryCategory) return { ok: false, message: '[kategori wajib]' };
  if (!startDateStr || !endDateStr)
    return { ok: false, message: '[tanggal start–end wajib]' };

  const creatorsNeeded = parseInt(creatorsNeededStr, 10);
  if (isNaN(creatorsNeeded) || creatorsNeeded <= 0) {
    return { ok: false, message: '[jumlah kreator harus > 0]' };
  }

  const budget = adsBudget ? parseFloat(adsBudget) : null;
  const gmv = targetGmv ? parseFloat(targetGmv) : null;

  try {
    const client = createClient();
    const { error } = await client.from('special_projects').insert({
      name,
      industry_category: industryCategory,
      start_date: startDateStr,
      end_date: endDateStr,
      creators_needed: creatorsNeeded,
      ads_budget: budget,
      target_gmv: gmv,
      description,
      created_by: user?.id,
    });

    if (error) {
      if (error.message.includes('[')) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/projects');
    return { ok: true, message: `[project ${name} dibuat]` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Update project status via state machine.
 */
export async function setProjectStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  // Check permission: lead, od, director
  if (!me.is_director && !me.is_od && !(me.rank === 'lead')) {
    return {
      ok: false,
      message: '[hanya Lead, OD, atau Director dapat update status]',
    };
  }

  const projectId = String(formData.get('project_id') || '').trim();
  const newStatus = String(formData.get('status') || '').trim();

  if (!projectId || !newStatus) {
    return { ok: false, message: '[project dan status wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('special_projects')
      .update({
        status: newStatus,
        status_changed_by: user?.id,
        status_changed_at: new Date().toISOString(),
      })
      .eq('id', projectId);

    if (error) {
      if (error.message.includes('[')) {
        return { ok: false, message: error.message };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/projects');
    return { ok: true, message: `[status: ${newStatus}]` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Add merchant to project.
 */
export async function addProjectMerchant(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const projectId = String(formData.get('project_id') || '').trim();
  const merchantId = String(formData.get('merchant_id') || '').trim();

  if (!projectId || !merchantId) {
    return { ok: false, message: '[project dan merchant wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client.from('special_project_merchants').insert({
      project_id: projectId,
      merchant_id: merchantId,
      added_by: user?.id,
    });

    if (error) {
      if (error.code === '23505') {
        return { ok: false, message: '[merchant sudah di-assign ke project ini]' };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/projects');
    return { ok: true, message: '[merchant ditambahkan]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Remove merchant from project.
 */
export async function removeProjectMerchant(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const projectMerchantId = String(
    formData.get('project_merchant_id') || ''
  ).trim();

  if (!projectMerchantId) {
    return { ok: false, message: '[project_merchant ID wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('special_project_merchants')
      .delete()
      .eq('id', projectMerchantId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/projects');
    return { ok: true, message: '[merchant dihapus dari project]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Assign creator to project.
 * filled_by derived from divisi actor: CM → 'cm', Acquisition → 'acquisition', mgmt → flexible.
 */
export async function assignProjectCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const projectId = String(formData.get('project_id') || '').trim();
  const creatorId = String(formData.get('mcn_creator_id') || '').trim();
  const filledByRaw = String(formData.get('filled_by') || '').trim();

  if (!projectId || !creatorId) {
    return { ok: false, message: '[project dan creator wajib]' };
  }

  // Determine filled_by from divisi if not provided
  let filledBy = filledByRaw;
  if (!filledBy) {
    if (me.division === 'CreatorManagement') {
      filledBy = 'cm';
    } else if (me.division === 'Acquisition') {
      filledBy = 'acquisition';
    } else {
      return {
        ok: false,
        message: '[divisi tidak dapat assign kreator (CM atau Acquisition)',
      };
    }
  }

  if (!['cm', 'acquisition'].includes(filledBy)) {
    return {
      ok: false,
      message: '[filled_by harus cm atau acquisition]',
    };
  }

  try {
    const client = createClient();
    const { error } = await client.from('special_project_creators').insert({
      project_id: projectId,
      mcn_creator_id: creatorId,
      filled_by: filledBy,
      assigned_by: user?.id,
    });

    if (error) {
      if (error.code === '23505') {
        return {
          ok: false,
          message: '[kreator sudah di-assign ke project ini]',
        };
      }
      return { ok: false, message: error.message };
    }

    revalidatePath('/projects');
    return { ok: true, message: `[kreator assigned (${filledBy})]` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Unassign creator from project.
 */
export async function unassignProjectCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const projectCreatorId = String(
    formData.get('project_creator_id') || ''
  ).trim();

  if (!projectCreatorId) {
    return { ok: false, message: '[project_creator ID wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('special_project_creators')
      .delete()
      .eq('id', projectCreatorId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/projects');
    return { ok: true, message: '[kreator unassigned]' };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}
