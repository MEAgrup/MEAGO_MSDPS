/**
 * GET/POST /api/internal/bridge/deliver — Bridge MSDPS→CDPS Fase 1 delivery
 * job tick (B3). Thin HTTP shell — the actual sweep lives in
 * `lib/bridge/deliver.ts` (kept out of this file so it can be unit-tested;
 * Next.js route files may only export HTTP verb handlers).
 *
 * Runtime = external cron, same Pattern-A convention CDPS itself uses for its
 * own `internal/*∕tick` routes (owner decision 2026-08-19, `AgencyAPP/docs/
 * DECISIONS.md:249` — provider = Vercel Cron, wired in `vercel.json`). See
 * migration `0360_bridge_cdps.sql`'s header comment for why this route (not
 * pg_cron/pg_net) is the delivery mechanism: zero existing pg_net usage in
 * either repo, and no verified production self-URL to hardcode for a
 * self-referential `net.http_post`.
 *
 * Both verbs run the same sweep — POST (curl/GitHub Actions) and GET (Vercel
 * Cron, which can only GET its own deployment and cannot send a body).
 */
import { createAdminClient, hasAdminEnv, ADMIN_ENV_MESSAGE } from "@/lib/supabase/admin";
import { deliverSecretOk } from "@/lib/bridge/deliver-auth";
import { runDeliverySweep } from "@/lib/bridge/deliver";

// Deployment production CDPS `apps/api`, verified & repeatedly documented in
// AgencyAPP/docs/DECISIONS.md (e.g. the 2026-07-31 C-03 entry, the 2026-08-31
// entry) — NOT guessed. Override per environment (staging CDPS) via
// CDPS_BRIDGE_BASE_URL when needed.
const CDPS_BASE_URL = process.env.CDPS_BRIDGE_BASE_URL || "https://agency-app-api.vercel.app";

async function runTick(): Promise<Response> {
  if (!hasAdminEnv()) {
    console.error("[bridge/deliver]", ADMIN_ENV_MESSAGE);
    return Response.json({ error: "admin env missing" }, { status: 500 });
  }

  // OUTBOUND secret (sent TO CDPS) unset ⇒ silent + log, NOT a data failure —
  // don't burn attempts/backoff on a config problem. Different from
  // deliverSecretOk() below (the INBOUND gate, who may trigger this tick).
  const ingestSecret = process.env.CDPS_BRIDGE_INGEST_SECRET;
  if (!ingestSecret) {
    console.warn("[bridge/deliver] CDPS_BRIDGE_INGEST_SECRET belum diset — tick dilewati.");
    return Response.json({ skipped: true, reason: "CDPS_BRIDGE_INGEST_SECRET unset" });
  }

  try {
    const result = await runDeliverySweep({
      admin: createAdminClient(),
      ingestSecret,
      cdpsBaseUrl: CDPS_BASE_URL,
    });
    return Response.json(result);
  } catch (e) {
    console.error("[bridge/deliver]", (e as Error).message);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!deliverSecretOk(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return runTick();
}

export async function GET(request: Request): Promise<Response> {
  if (!deliverSecretOk(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return runTick();
}
