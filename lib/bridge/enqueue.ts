// Bridge MSDPS→CDPS otomatis (migrasi 0377) — enqueue logic.
//
// Mengubah rencana layanan (deal_cdps_plans) menjadi satu baris cdps_outbox
// BEGITU pembayaran deal terverifikasi Finance (DP pun cukup). Delivery-nya
// tetap lib/bridge/deliver.ts — file ini tidak pernah memanggil CDPS.
//
// Dipanggil dari tiga tempat, semuanya service-role (createAdminClient()):
//   1. app/api/internal/bridge/deliver (Vercel Cron) — runEnqueueSweep(), jaring
//      pengaman untuk verifikasi lewat jalur apa pun.
//   2. verifyPayment() (lib/actions/finance.ts) — langsung, best-effort.
//   3. saveCdpsPlan() (lib/actions/bridge.ts) — rencana diisi SESUDAH bayar.
// Aman dipanggil berulang/paralel: enqueue_bridge_order() mengunci baris
// rencana dan mundur bila outbox deal itu sudah ada.
//
// Dipisah dari route supaya bisa diuji dengan admin client palsu
// (scripts/test_bridge_enqueue.mjs) — pola yang sama dengan deliver.ts.

import { buildBridgePayload, bridgeIdempotencyKey, paidPercent } from "./payload";
import { parsePlanLines } from "./plan";

// supabase-js builder sengaja longgar di sini (lihat deliver.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryBuilder = any;
export interface EnqueueAdminLike {
  from(table: string): AnyQueryBuilder;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export type EnqueueOutcome =
  | { status: "enqueued"; paid_percent: number | null }
  | { status: "already" }
  | { status: "waiting_payment" }
  | { status: "skipped"; reason: string }
  | { status: "incomplete"; error: string };

export interface EnqueueSweepResult {
  checked: number;
  enqueued: number;
  waiting: number;
  incomplete: number;
}

const DEAL_COLUMNS =
  "id, code, brand_name, shop_id, kategori_poi, pic_name, pic_whatsapp, tanggal_mulai_kontrak, " +
  "tanggal_akhir_kontrak, bd_id, bentuk_kerjasama, transaction_id";

async function setPlanError(admin: EnqueueAdminLike, dealId: string, bdId: string | null, current: string | null, msg: string) {
  if (current !== msg) {
    await admin.from("deal_cdps_plans").update({ last_error: msg }).eq("deal_id", dealId);
  }
  // Satu alert terbuka per deal (dedup) — pola raiseDeadLetterAlert di deliver.ts.
  try {
    const { data: open } = await admin
      .from("platform_alerts")
      .select("id")
      .eq("alert_type", "cdps_bridge_incomplete")
      .eq("resolved", false)
      .contains("detail", { deal_id: dealId })
      .maybeSingle();
    if (open) return;
    await admin.from("platform_alerts").insert({
      alert_type: "cdps_bridge_incomplete",
      target_member_id: bdId,
      detail: { deal_id: dealId, error: msg },
    });
  } catch (e) {
    console.error("[bridge/enqueue] gagal menaikkan alert cdps_bridge_incomplete:", (e as Error).message);
  }
}

async function resolveIncompleteAlerts(admin: EnqueueAdminLike, dealId: string) {
  try {
    await admin
      .from("platform_alerts")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("alert_type", "cdps_bridge_incomplete")
      .eq("resolved", false)
      .contains("detail", { deal_id: dealId });
  } catch (e) {
    console.error("[bridge/enqueue] gagal menutup alert cdps_bridge_incomplete:", (e as Error).message);
  }
}

/** Coba antre satu deal. Tidak pernah melempar untuk kondisi data — hanya untuk error baca DB. */
export async function enqueueDealIfReady(admin: EnqueueAdminLike, dealId: string): Promise<EnqueueOutcome> {
  const { data: plan } = await admin
    .from("deal_cdps_plans")
    .select("deal_id, tidak_perlu, lines, last_error")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (!plan) return { status: "skipped", reason: "rencana layanan CDPS belum diisi" };
  if (plan.tidak_perlu) return { status: "skipped", reason: "tidak perlu CDPS" };

  const { data: existing } = await admin.from("cdps_outbox").select("id").eq("deal_id", dealId).maybeSingle();
  if (existing) return { status: "already" };

  const { data: deal } = await admin.from("brand_deals").select(DEAL_COLUMNS).eq("id", dealId).maybeSingle();
  if (!deal) return { status: "skipped", reason: "deal tidak ditemukan" };
  if (deal.bentuk_kerjasama !== "Berbayar") return { status: "skipped", reason: "deal bukan Berbayar" };
  if (!deal.transaction_id) return { status: "waiting_payment" };

  const { data: trx } = await admin
    .from("transactions")
    .select("code, total_agreed_value, amount_verified, released_to_account_at, merchant_id, status_changed_by")
    .eq("id", deal.transaction_id)
    .maybeSingle();
  // released_to_account_at terisi pada pembayaran terverifikasi PERTAMA
  // (verify_payment, 0103) — termasuk DP. Itulah gerbangnya (keputusan 2026-11-03).
  if (!trx || !trx.released_to_account_at) return { status: "waiting_payment" };

  const parsedLines = parsePlanLines(plan.lines);
  if ("error" in parsedLines) {
    await setPlanError(admin, dealId, deal.bd_id, plan.last_error, parsedLines.error);
    return { status: "incomplete", error: parsedLines.error };
  }

  const [{ data: bd }, { data: financeVerifier }, { data: merchant }] = await Promise.all([
    deal.bd_id
      ? admin.from("employees").select("full_name").eq("id", deal.bd_id).maybeSingle()
      : Promise.resolve({ data: null }),
    trx.status_changed_by
      ? admin.from("employees").select("full_name").eq("id", trx.status_changed_by).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("merchants").select("id, kota").eq("id", trx.merchant_id).maybeSingle(),
  ]);
  if (!merchant) {
    const msg = "Merchant untuk transaksi Finance deal ini tidak ditemukan.";
    await setPlanError(admin, dealId, deal.bd_id, plan.last_error, msg);
    return { status: "incomplete", error: msg };
  }

  const paymentInfo = { amount_verified: trx.amount_verified ?? 0, total_agreed_value: trx.total_agreed_value };
  let payload;
  try {
    payload = buildBridgePayload({
      deal,
      bd: bd ?? null,
      transaction: trx,
      financeVerifier: financeVerifier ?? null,
      merchant,
      lines: parsedLines.lines,
      paymentInfo,
    });
  } catch (e) {
    const msg = `Data deal belum lengkap untuk diteruskan ke CDPS: ${(e as Error).message}`;
    await setPlanError(admin, dealId, deal.bd_id, plan.last_error, msg);
    return { status: "incomplete", error: msg };
  }

  const { data: created, error } = await admin.rpc("enqueue_bridge_order", {
    p_deal_id: dealId,
    p_payload: payload,
    p_idempotency_key: bridgeIdempotencyKey(deal.code),
  });
  if (error) {
    const msg = `Gagal mengantre ke CDPS: ${error.message}`;
    await setPlanError(admin, dealId, deal.bd_id, plan.last_error, msg);
    return { status: "incomplete", error: msg };
  }
  if (created === false) return { status: "already" };

  await resolveIncompleteAlerts(admin, dealId);
  return { status: "enqueued", paid_percent: paidPercent(paymentInfo) };
}

/** Sweep: semua rencana aktif yang belum diantre. */
export async function runEnqueueSweep(admin: EnqueueAdminLike): Promise<EnqueueSweepResult> {
  const { data: plans, error } = await admin.from("deal_cdps_plans").select("deal_id").eq("tidak_perlu", false);
  if (error) throw new Error(`gagal baca deal_cdps_plans: ${error.message}`);
  const dealIds = ((plans ?? []) as { deal_id: string }[]).map((p) => p.deal_id);
  if (dealIds.length === 0) return { checked: 0, enqueued: 0, waiting: 0, incomplete: 0 };

  const { data: queued, error: qErr } = await admin.from("cdps_outbox").select("deal_id").in("deal_id", dealIds);
  if (qErr) throw new Error(`gagal baca cdps_outbox: ${qErr.message}`);
  const queuedSet = new Set(((queued ?? []) as { deal_id: string }[]).map((q) => q.deal_id));

  const result: EnqueueSweepResult = { checked: 0, enqueued: 0, waiting: 0, incomplete: 0 };
  for (const id of dealIds) {
    if (queuedSet.has(id)) continue;
    result.checked++;
    try {
      const out = await enqueueDealIfReady(admin, id);
      if (out.status === "enqueued") result.enqueued++;
      else if (out.status === "waiting_payment") result.waiting++;
      else if (out.status === "incomplete") result.incomplete++;
    } catch (e) {
      // Satu deal bermasalah tidak boleh menghentikan sweep deal lain.
      result.incomplete++;
      console.error(`[bridge/enqueue] deal ${id}:`, (e as Error).message);
    }
  }
  return result;
}
