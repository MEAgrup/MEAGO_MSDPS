'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { parseCommission } from '@/lib/mcn/parsers';

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
 * Register a new deal with form validation.
 * Validates: brand_name persis display platform, shop_id numeric+unique, exp_date picker, komisi 0–100 range.
 * Returns fieldErrors or success message.
 */
export async function registerDeal(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const brandName = String(formData.get('brand_name') || '').trim();
  const shopId = String(formData.get('shop_id') || '').trim();
  const merchantId = String(formData.get('merchant_id') || '').trim() || null;
  const niche = String(formData.get('niche') || '').trim() || null;
  const expDateStr = String(formData.get('exp_date') || '').trim();
  const komisiKreatorRaw = String(formData.get('komisi_kreator_raw') || '').trim();
  const komisiMeaRaw = String(formData.get('komisi_mea_raw') || '').trim() || null;
  const picTapId = String(formData.get('pic_tap_id') || '').trim() || null;
  const campaignType = String(formData.get('campaign_type') || 'paid').trim();
  const notes = String(formData.get('notes') || '').trim() || null;

  // Validate
  const errors: Record<string, string> = {};

  if (!brandName) errors['brand_name'] = 'nama brand wajib';
  if (!shopId) errors['shop_id'] = 'shop ID wajib';
  else if (!/^\d+$/.test(shopId)) errors['shop_id'] = 'shop ID harus numeric';
  if (!expDateStr) errors['exp_date'] = 'tanggal expire wajib';
  if (!komisiKreatorRaw) errors['komisi_kreator_raw'] = 'komisi kreator wajib';

  // Parse komisi
  const komisiKreator = parseCommission(komisiKreatorRaw);
  if (komisiKreatorRaw && !komisiKreator) {
    errors['komisi_kreator_raw'] = 'format komisi invalid (e.g., 5% atau 5-10%)';
  }

  const komisiMea = komisiMeaRaw ? parseCommission(komisiMeaRaw) : null;
  if (komisiMeaRaw && !komisiMea) {
    errors['komisi_mea_raw'] = 'format komisi invalid';
  }

  if (Object.keys(errors).length > 0) {
    const errorMsg = Object.entries(errors)
      .map(([k, v]) => `${k}: ${v}`)
      .join('; ');
    return { ok: false, message: `[validasi: ${errorMsg}]` };
  }

  try {
    const client = createClient();

    // Check shop_id uniqueness
    const { data: existing } = await client
      .from('brand_deals')
      .select('id, code')
      .eq('shop_id', shopId)
      .single();

    if (existing) {
      return {
        ok: false,
        message: `[shop ID sudah terdaftar: ${existing.code}]`,
      };
    }

    // Insert deal
    const { error: dealError } = await client.from('brand_deals').insert({
      brand_name: brandName,
      shop_id: shopId || null,
      merchant_id: merchantId || null,
      niche,
      exp_date: expDateStr,
      komisi_kreator_raw: komisiKreatorRaw,
      komisi_kreator_pct: komisiKreator?.pct,
      komisi_mea_raw: komisiMeaRaw,
      komisi_mea_pct: komisiMea?.pct,
      pic_tap: picTapId,
      campaign_type: campaignType,
      notes,
      created_by: user?.id,
      sourced_by_role: me.division === 'CreatorManagement' ? 'cm' : 'bd',
    });

    if (dealError) {
      if (dealError.code === '23505') {
        return { ok: false, message: '[deal sudah ada (shop_id duplikat)]' };
      }
      return { ok: false, message: dealError.message };
    }

    revalidatePath('/deals');
    return { ok: true, message: `[deal ${brandName} terdaftar]` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Import legacy deals from textarea (paste CSV).
 * Tolerant: no crash, field kotor → null + review_flags.
 */
export async function importLegacyDeals(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk, user, me } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const csvText = String(formData.get('csv_text') || '').trim();

  if (!csvText) {
    return { ok: false, message: '[CSV tidak boleh kosong]' };
  }

  // Parse CSV manually
  const lines = csvText.split('\n').filter((l) => l.trim());
  if (lines.length < 2) {
    return { ok: false, message: '[minimal 2 baris (header + data)]' };
  }

  // Guess header row
  const headerLine = lines[0];
  const headerParts = headerLine.split(/[,\t]/).map((p) => p.trim().toLowerCase());

  // Aliases
  const aliases: Record<string, string> = {
    'nama brand': 'brand_name',
    'brand': 'brand_name',
    'shop id': 'shop_id',
    'shop': 'shop_id',
    'exp date': 'exp_date',
    'expire': 'exp_date',
    'komisi': 'komisi_kreator_pct',
    'komisi kreator': 'komisi_kreator_pct',
  };

  const headerMap: Record<string, number> = {};
  for (let i = 0; i < headerParts.length; i++) {
    const normalized = aliases[headerParts[i]] || headerParts[i];
    headerMap[normalized] = i;
  }

  // Parse data rows
  const deals: Array<{
    brandName: string;
    shopId: string | null;
    komisiPct: number | null;
    expDate: string | null;
    reviewFlags?: string[];
  }> = [];
  const insertedCount = { count: 0 };
  const failures: Array<{ row: number; reason: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(/[,\t]/).map((p) => p.trim());

    const brandName = parts[headerMap['brand_name'] ?? -1] || null;
    const shopIdRaw = parts[headerMap['shop_id'] ?? -1] || null;
    const komisiRaw = parts[headerMap['komisi_kreator_pct'] ?? -1] || null;
    const expDateRaw = parts[headerMap['exp_date'] ?? -1] || null;

    if (!brandName) {
      failures.push({ row: i + 1, reason: 'brand_name kosong' });
      continue;
    }

    const reviewFlags: string[] = [];

    // Parse shop_id (numeric)
    let shopId: string | null = null;
    if (shopIdRaw) {
      if (!/^\d+$/.test(shopIdRaw)) {
        reviewFlags.push('shop_id non-numeric');
      } else {
        shopId = shopIdRaw;
      }
    }

    // Parse komisi (0–100)
    let komisiPct: number | null = null;
    if (komisiRaw) {
      const num = parseFloat(komisiRaw);
      if (isNaN(num) || num < 0 || num > 100) {
        reviewFlags.push('komisi invalid range');
      } else {
        komisiPct = num;
      }
    }

    // Parse exp_date
    let expDate: string | null = null;
    if (expDateRaw) {
      // Assume YYYY-MM-DD format or accept as-is
      if (/^\d{4}-\d{2}-\d{2}$/.test(expDateRaw)) {
        expDate = expDateRaw;
      } else {
        reviewFlags.push(`exp_date format unclear: ${expDateRaw}`);
        expDate = expDateRaw; // Keep for manual review
      }
    }

    deals.push({
      brandName,
      shopId,
      komisiPct,
      expDate,
      reviewFlags: reviewFlags.length > 0 ? reviewFlags : undefined,
    });
  }

  // Bulk insert
  if (deals.length > 0) {
    try {
      const client = createClient();

      for (const deal of deals) {
        const { error } = await client.from('brand_deals').insert({
          brand_name: deal.brandName,
          shop_id: deal.shopId || null,
          exp_date: deal.expDate || new Date().toISOString().split('T')[0],
          komisi_kreator_pct: deal.komisiPct,
          campaign_type: 'paid',
          review_flags: deal.reviewFlags
            ? { issues: deal.reviewFlags }
            : null,
          created_by: user?.id,
          sourced_by_role:
            me.division === 'CreatorManagement' ? 'cm' : 'bd',
        });

        if (!error) {
          insertedCount.count++;
        } else if (error.code === '23505') {
          failures.push({
            row: deals.indexOf(deal) + 2,
            reason: 'shop_id duplikat',
          });
        }
      }

      revalidatePath('/deals');
      const msg = `[berhasil: ${insertedCount.count} deal; gagal: ${failures.length}]`;
      return { ok: true, message: msg };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }

  return { ok: false, message: '[tidak ada deal valid untuk diimport]' };
}

/**
 * Set pipeline stage for a deal.
 */
export async function setPipelineStage(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const ctxRes = await ctx();
  if ('error' in ctxRes) return ctxRes as ActionResult;

  const { ok: ctxOk } = ctxRes;
  if (!ctxOk) return { ok: false, message: '[konteks gagal]' };

  const dealId = String(formData.get('deal_id') || '').trim();
  const stage = String(formData.get('stage') || '').trim();

  if (!dealId || !stage) {
    return { ok: false, message: '[deal dan stage wajib]' };
  }

  try {
    const client = createClient();
    const { error } = await client
      .from('brand_deals')
      .update({ pipeline_stage: stage })
      .eq('id', dealId);

    if (error) {
      return { ok: false, message: error.message };
    }

    revalidatePath('/deals');
    return { ok: true, message: `[stage: ${stage}]` };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}
