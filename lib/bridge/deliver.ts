// Bridge MSDPS→CDPS Fase 1 — delivery sweep logic (B3), extracted out of
// `app/api/internal/bridge/deliver/route.ts` so it can be unit-tested with a
// mocked `fetch`/admin client (Next.js route files may only export HTTP verb
// handlers, so the actual logic cannot live there and still be importable by
// a test — see scripts/test_bridge_delivery.mjs).
//
// Never inline from the server action: a CDPS outage must never fail a BD's
// save. Exponential backoff, `dead` after MAX_ATTEMPTS, best-effort
// `platform_alerts` dead-letter (dedup'd, pattern mcn-ingest.ts:782-828).

export const MAX_ATTEMPTS = 5;
export const BATCH_SIZE = 20;

// Narrow slice of the supabase-js client surface this module actually calls —
// lets tests pass a lightweight fake instead of a real SupabaseClient.
export interface AdminLike {
  from(table: string): AnyQueryBuilder;
}
// supabase-js's real builder type is a deep generic; typing it exactly here
// would just re-import it, so this stays structurally loose on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQueryBuilder = any;

export interface OutboxRow {
  id: string;
  deal_id: string | null;
  payload: unknown;
  idempotency_key: string;
  attempts: number;
  status: string;
}

export interface DeliverySweepResult {
  processed: number;
  sent: number;
  failed: number;
  dead: number;
}

/** 2^attempts minutes, capped at 60 — attempt 1..5 = 2,4,8,16,32 minutes. */
export function backoffMinutes(attempts: number): number {
  return Math.min(2 ** attempts, 60);
}

async function markFailure(admin: AdminLike, row: OutboxRow, errMsg: string, now: () => Date): Promise<"failed" | "dead"> {
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await admin.from("cdps_outbox").update({ status: "dead", attempts, last_error: errMsg }).eq("id", row.id);
    await raiseDeadLetterAlert(admin, row, errMsg);
    return "dead";
  }
  const next_attempt_at = new Date(now().getTime() + backoffMinutes(attempts) * 60_000).toISOString();
  await admin
    .from("cdps_outbox")
    .update({ status: "failed", attempts, last_error: errMsg, next_attempt_at })
    .eq("id", row.id);
  return "failed";
}

// Dedup: one open alert per outbox row — pattern mcn-ingest.ts:782-828 (check
// for an open alert first, then insert). Best-effort: a failure here does NOT
// undo the 'dead' status already written above.
async function raiseDeadLetterAlert(admin: AdminLike, row: OutboxRow, errMsg: string): Promise<void> {
  try {
    const { data: open } = await admin
      .from("platform_alerts")
      .select("id")
      .eq("alert_type", "cdps_bridge_dead")
      .eq("resolved", false)
      .contains("detail", { outbox_id: row.id })
      .maybeSingle();
    if (open) return;

    let targetMemberId: string | null = null;
    if (row.deal_id) {
      const { data: deal } = await admin.from("brand_deals").select("bd_id").eq("id", row.deal_id).maybeSingle();
      targetMemberId = deal?.bd_id ?? null;
    }

    await admin.from("platform_alerts").insert({
      alert_type: "cdps_bridge_dead",
      target_member_id: targetMemberId,
      detail: { outbox_id: row.id, deal_id: row.deal_id, idempotency_key: row.idempotency_key, last_error: errMsg },
    });
  } catch (e) {
    console.error("[bridge/deliver] gagal menaikkan platform_alerts dead-letter:", (e as Error).message);
  }
}

async function deliverOne(
  admin: AdminLike,
  row: OutboxRow,
  ingestSecret: string,
  cdpsBaseUrl: string,
  fetchImpl: typeof fetch,
  now: () => Date
): Promise<"sent" | "failed" | "dead"> {
  let res: Response;
  try {
    res = await fetchImpl(`${cdpsBaseUrl}/api/v1/internal/bridge/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ingestSecret}`,
        "Idempotency-Key": row.idempotency_key,
      },
      body: JSON.stringify(row.payload),
    });
  } catch (e) {
    return markFailure(admin, row, `network error: ${(e as Error).message}`, now);
  }

  if (res.ok) {
    let body: { ord_code?: string; status?: string } = {};
    try {
      body = await res.json();
    } catch {
      // 2xx with no parseable body — treated as failure below.
    }
    if (!body.ord_code) return markFailure(admin, row, "2xx tapi ord_code kosong di balasan CDPS", now);

    const sent_at = now().toISOString();
    await admin.from("cdps_outbox").update({ status: "sent", sent_at, ord_code: body.ord_code }).eq("id", row.id);
    // Denormalized onto deal_bridge_lines so /deals can show ORD- without a
    // join to cdps_outbox. `is('ord_code', null)` protects a row that (in
    // theory) already got an ord_code from an earlier attempt.
    if (row.deal_id) {
      await admin.from("deal_bridge_lines").update({ ord_code: body.ord_code }).eq("deal_id", row.deal_id).is("ord_code", null);
    }
    return "sent";
  }

  const text = await res.text().catch(() => "");
  return markFailure(admin, row, `HTTP ${res.status}: ${text.slice(0, 500)}`, now);
}

export interface DeliverySweepDeps {
  admin: AdminLike;
  ingestSecret: string;
  cdpsBaseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/** Reads due cdps_outbox rows and attempts delivery for each. */
export async function runDeliverySweep(deps: DeliverySweepDeps): Promise<DeliverySweepResult> {
  const { admin, ingestSecret, cdpsBaseUrl } = deps;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());

  const nowIso = now().toISOString();
  const { data: rows, error } = await admin
    .from("cdps_outbox")
    .select("id, deal_id, payload, idempotency_key, attempts, status")
    .in("status", ["pending", "failed"])
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(`gagal baca cdps_outbox: ${error.message}`);

  let sent = 0;
  let failed = 0;
  let dead = 0;
  for (const row of (rows ?? []) as OutboxRow[]) {
    const result = await deliverOne(admin, row, ingestSecret, cdpsBaseUrl, fetchImpl, now);
    if (result === "sent") sent++;
    else if (result === "dead") dead++;
    else failed++;
  }
  return { processed: (rows ?? []).length, sent, failed, dead };
}
