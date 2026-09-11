/**
 * Shared-secret gate for `app/api/internal/bridge/deliver` — the Bridge
 * MSDPS→CDPS delivery job tick. Mirrors CDPS's own `apps/api/src/lib/tick-auth.ts`
 * byte-for-byte in shape (same owner decision 2026-08-19, "Cron provider =
 * Vercel Cron", `AgencyAPP/docs/DECISIONS.md:249` — Pattern A: shared-secret
 * HTTP tick, external scheduler, not pg_cron/pg_net; see migration
 * 0360's header comment for why that pattern was chosen here too).
 *
 * Two credential shapes, same secret:
 *   - header `x-bridge-deliver-secret: <secret>` — GitHub Actions / curl / local.
 *   - header `Authorization: Bearer <secret>`    — Vercel Cron. It can only GET
 *     a path in its own deployment and injects `Authorization: Bearer <CRON_SECRET>`
 *     itself; it cannot send a custom header, so the route must also accept Bearer.
 *
 * Secret read from `BRIDGE_DELIVER_SECRET` OR `CRON_SECRET` (Vercel requires
 * that exact env var name to auto-populate the Bearer header). Set both to the
 * same value to run one logical secret across every provider.
 *
 * BOTH unset ⇒ every request rejected (fail-closed): a missing env var must
 * never turn a privileged system hook into an anonymous one.
 *
 * NOTE: this gates who may TRIGGER the delivery job at all. It is a different
 * secret from `CDPS_BRIDGE_INGEST_SECRET` (the OUTBOUND credential the job
 * itself sends to CDPS) — see route.ts for that one's separate, silent-skip
 * handling when unset.
 */

/** Constant-time-ish equality over two server-held short tokens (length is not secret here). */
function tokenEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function expectedSecrets(): string[] {
  return [process.env.BRIDGE_DELIVER_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s !== ""
  );
}

function presentedSecrets(request: Request): string[] {
  const out: string[] = [];
  const custom = request.headers.get("x-bridge-deliver-secret");
  if (custom) out.push(custom);
  const auth = request.headers.get("authorization");
  if (auth && /^Bearer\s+/i.test(auth)) out.push(auth.replace(/^Bearer\s+/i, ""));
  return out;
}

/** Gates a delivery-tick request. Unconfigured environment ⇒ always false (closed). */
export function deliverSecretOk(request: Request): boolean {
  const expected = expectedSecrets();
  if (expected.length === 0) return false;
  for (const got of presentedSecrets(request)) {
    for (const exp of expected) {
      if (tokenEqual(got, exp)) return true;
    }
  }
  return false;
}
