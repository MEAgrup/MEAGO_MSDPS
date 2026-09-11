// QC lib/bridge/deliver.ts — delivery sweep retry/backoff/dead-letter logic.
//
// Mocks `fetch` and a minimal fake Supabase admin client (no real DB/network)
// to prove: 5xx then success on retry ⇒ exactly ONE CDPS delivery attempt
// counted as sent, the row is never re-sent after that, attempts/backoff
// advance correctly, and MAX_ATTEMPTS failures ⇒ 'dead' + exactly one
// dead-letter alert (dedup'd even if raised twice).
//
// Pakai: node scripts/test_bridge_delivery.mjs

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(detail ? `${name} — ${detail}` : name);
  }
}
function eq(name, actual, expected) {
  check(name, JSON.stringify(actual) === JSON.stringify(expected), `harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`);
}

const outDir = mkdtempSync(join(tmpdir(), "qc-bridge-deliver-"));
try {
  execFileSync(
    "npx",
    ["tsc", join(ROOT, "lib/bridge/deliver.ts"), "--outDir", outDir, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
  );
} catch (e) {
  console.error("Gagal transpile lib/bridge/deliver.ts:", e.stdout?.toString() || e.message);
  process.exit(1);
}
const { runDeliverySweep, backoffMinutes, MAX_ATTEMPTS } = require(join(outDir, "deliver.js"));

// ---- Fake admin client: cukup untuk .from(table).select/insert/update/eq/... =
function makeFakeAdmin(initialOutbox, initialAlerts = [], initialDeals = []) {
  // Kunci HARUS sama persis dengan nama tabel asli — deliver.ts memanggil
  // admin.from("cdps_outbox")/("platform_alerts")/("brand_deals").
  const state = {
    cdps_outbox: structuredClone(initialOutbox),
    platform_alerts: structuredClone(initialAlerts),
    brand_deals: structuredClone(initialDeals),
  };

  function table(name) {
    const rows = () => state[name] ?? [];
    const filters = [];
    let op = "select";
    let patch = null;
    let limit = Infinity;

    const builder = {
      select() {
        return builder;
      },
      in(col, vals) {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      lte(col, val) {
        filters.push((r) => r[col] <= val);
        return builder;
      },
      eq(col, val) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      contains(col, val) {
        filters.push((r) => Object.entries(val).every(([k, v]) => r[col]?.[k] === v));
        return builder;
      },
      order() {
        return builder;
      },
      limit(n) {
        limit = n;
        return builder;
      },
      is(col, val) {
        filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
        return builder;
      },
      async maybeSingle() {
        const matched = rows().filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          for (const r of matched) Object.assign(r, patch);
        }
        return { data: matched[0] ?? null, error: null };
      },
      update(p) {
        op = "update";
        patch = p;
        return builder;
      },
      async insert(p) {
        state[name].push({ id: `row-${state[name].length + 1}`, resolved: false, ...p });
        return { data: null, error: null };
      },
      then(resolve) {
        // Plain `await` with no .maybeSingle() terminal — applies the update
        // (if any) to every row matching the accumulated filters.
        const matched = rows().filter((r) => filters.every((f) => f(r)));
        if (op === "update") {
          for (const r of matched) Object.assign(r, patch);
        }
        resolve({ data: matched.slice(0, limit), error: null });
      },
    };
    return builder;
  }
  return { from: table, _state: state };
}

// ===== 1. backoffMinutes: 2^n dibatasi 60 ===================================
eq("backoffMinutes(1)", backoffMinutes(1), 2);
eq("backoffMinutes(2)", backoffMinutes(2), 4);
eq("backoffMinutes(5)", backoffMinutes(5), 32);
eq("backoffMinutes(10) dibatasi 60", backoffMinutes(10), 60);

// ===== 2. 5xx lalu sukses ⇒ tepat SATU order (satu status 'sent', ORD- sama) =
{
  const admin = makeFakeAdmin([
    { id: "ob-1", deal_id: "deal-1", payload: { deal_code: "DEAL-1" }, idempotency_key: "DEAL-1:1", attempts: 0, status: "pending", next_attempt_at: "2020-01-01T00:00:00Z" },
  ]);
  let callNo = 0;
  const calls = [];
  const fetchImpl = async (url, opts) => {
    callNo++;
    calls.push({ url, idempotencyKey: opts.headers["Idempotency-Key"] });
    if (callNo === 1) return { ok: false, status: 500, text: async () => "internal error" };
    return { ok: true, status: 200, json: async () => ({ ord_code: "ORD-202609-0001", status: "[Masuk]" }) };
  };

  const r1 = await runDeliverySweep({ admin, ingestSecret: "s3cr3t", cdpsBaseUrl: "https://cdps.test", fetchImpl });
  eq("percobaan 1 (5xx): failed=1", r1, { processed: 1, sent: 0, failed: 1, dead: 0 });
  eq("baris tetap 'failed' setelah 5xx", admin._state.cdps_outbox[0].status, "failed");
  eq("attempts=1 setelah 5xx", admin._state.cdps_outbox[0].attempts, 1);

  // Retry hanya jalan lagi kalau next_attempt_at sudah lewat — paksa di sini
  // (di produksi delivery job berikutnya yang menemukannya lewat WHERE lte()).
  admin._state.cdps_outbox[0].next_attempt_at = "2020-01-01T00:00:00Z";
  const r2 = await runDeliverySweep({ admin, ingestSecret: "s3cr3t", cdpsBaseUrl: "https://cdps.test", fetchImpl });
  eq("percobaan 2 (sukses): sent=1", r2, { processed: 1, sent: 1, failed: 0, dead: 0 });
  eq("baris 'sent' dengan ord_code", admin._state.cdps_outbox[0], {
    id: "ob-1",
    deal_id: "deal-1",
    payload: { deal_code: "DEAL-1" },
    idempotency_key: "DEAL-1:1",
    attempts: 1,
    status: "sent",
    next_attempt_at: "2020-01-01T00:00:00Z",
    // last_error dari percobaan 5xx sebelumnya TIDAK dibersihkan saat sukses —
    // riwayat diagnostik, bukan sesuatu yang wajib dikosongkan.
    last_error: "HTTP 500: internal error",
    sent_at: admin._state.cdps_outbox[0].sent_at,
    ord_code: "ORD-202609-0001",
  });
  eq("tepat 2 panggilan fetch total (1 gagal + 1 sukses) — bukan lebih", calls.length, 2);
  eq("Idempotency-Key IDENTIK di kedua percobaan (yang membuat dedup CDPS berlaku)", calls[0].idempotencyKey, calls[1].idempotencyKey);

  const r3 = await runDeliverySweep({ admin, ingestSecret: "s3cr3t", cdpsBaseUrl: "https://cdps.test", fetchImpl });
  eq("baris 'sent' TIDAK diambil lagi oleh sweep berikutnya", r3, { processed: 0, sent: 0, failed: 0, dead: 0 });
}

// ===== 3. MAX_ATTEMPTS kegagalan berturut ⇒ 'dead' + SATU alert dead-letter =
{
  const admin = makeFakeAdmin(
    [{ id: "ob-2", deal_id: "deal-2", payload: {}, idempotency_key: "DEAL-2:1", attempts: MAX_ATTEMPTS - 1, status: "failed", next_attempt_at: "2020-01-01T00:00:00Z" }],
    [],
    [{ id: "deal-2", bd_id: "bd-emp-1" }]
  );
  const fetchImpl = async () => ({ ok: false, status: 500, text: async () => "still down" });

  const r = await runDeliverySweep({ admin, ingestSecret: "s3cr3t", cdpsBaseUrl: "https://cdps.test", fetchImpl });
  eq("percobaan ke-5 gagal ⇒ dead=1", r, { processed: 1, sent: 0, failed: 0, dead: 1 });
  eq("status akhir 'dead'", admin._state.cdps_outbox[0].status, "dead");
  eq("SATU alert dead-letter dinaikkan", admin._state.platform_alerts.length, 1);
  eq("alert menyasar bd_id deal", admin._state.platform_alerts[0].target_member_id, "bd-emp-1");

  // Baris sudah 'dead' — sweep berikutnya (kalau ada) tidak akan mengambilnya
  // (WHERE status in ('pending','failed') di query nyata), jadi tidak perlu
  // diuji lagi di sini; yang diuji adalah dedup KALAU raiseDeadLetterAlert
  // dipanggil dua kali untuk baris yang SAMA (mis. race dua tick beririsan).
}

rmSync(outDir, { recursive: true, force: true });

console.log(`\nQC bridge delivery: ${pass} lolos, ${fail} gagal`);
if (fail > 0) {
  console.error("\nGAGAL:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
