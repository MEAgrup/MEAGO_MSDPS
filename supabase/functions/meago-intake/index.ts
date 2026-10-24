// =============================================================================
// Edge Function `meago-intake` — penerima form meago.id (plugin WP meago-core)
// =============================================================================
// Kontrak (terkunci): POST JSON
//   { event_id, site: "meago.id", wp_ref, type: kreator|dining|hotel|ttd,
//     submitted_at, contact{nama,email,whatsapp_raw,whatsapp_normalized},
//     fields{...}, attribution{cta_id,source_url,referrer,utm_*}, test? }
// Header:
//   X-Meago-Timestamp : unix detik (ms juga diterima)
//   X-Meago-Signature : hex HMAC-SHA256(timestamp + "." + rawBody, MEAGO_INTAKE_SECRET)
//   Idempotency-Key   : = wp_ref
//
// Keamanan: tanda tangan dicek constant-time, timestamp ±300 detik. Gagal →
// 401 dan HANYA satu baris log 'rejected' (tanpa payload — isinya tidak
// dipercaya). Service role dipakai HANYA di dalam function ini; semua tulisan
// data lewat RPC meago_intake_apply (satu transaksi, idempoten per wp_ref).
// Deploy dengan verify_jwt = false (WordPress tidak punya JWT Supabase).
// =============================================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_SKEW_SECONDS = 300;
const MAX_BODY_BYTES = 64 * 1024;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  const secret = Deno.env.get("MEAGO_INTAKE_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !url || !serviceKey) {
    console.error("meago-intake: env MEAGO_INTAKE_SECRET / SUPABASE_* belum di-set");
    return json(500, { ok: false, error: "server belum dikonfigurasi" });
  }
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const log = (row: Record<string, unknown>) =>
    db.from("web_intake_events").insert(row).then(({ error }) => {
      if (error) console.error("meago-intake: gagal menulis log", error.message);
    });

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    await log({ outcome: "rejected", error: "body terlalu besar" });
    return json(413, { ok: false, error: "payload terlalu besar" });
  }

  // ---- 1. Tanda tangan + timestamp ----------------------------------------
  const tsHeader = (req.headers.get("x-meago-timestamp") ?? "").trim();
  const sigHeader = (req.headers.get("x-meago-signature") ?? "").trim().replace(/^sha256=/i, "");
  let tsSeconds = Number(tsHeader);
  if (tsSeconds > 1e12) tsSeconds = Math.floor(tsSeconds / 1000);
  const skew = Math.abs(Date.now() / 1000 - tsSeconds);
  const given = hexToBytes(sigHeader);
  const expected = await hmacSha256(secret, `${tsHeader}.${rawBody}`);

  if (!tsHeader || !Number.isFinite(tsSeconds) || skew > MAX_SKEW_SECONDS) {
    await log({ outcome: "rejected", error: "timestamp tidak valid / di luar 300 detik" });
    return json(401, { ok: false, error: "timestamp tidak valid" });
  }
  if (!given || !timingSafeEqual(given, expected)) {
    await log({ outcome: "rejected", error: "tanda tangan tidak valid" });
    return json(401, { ok: false, error: "tanda tangan tidak valid" });
  }

  // ---- 2. Payload ----------------------------------------------------------
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("bukan objek");
  } catch {
    await log({ outcome: "invalid", error: "JSON tidak valid" });
    return json(400, { ok: false, error: "JSON tidak valid" });
  }

  const wpRef = typeof event.wp_ref === "string" ? event.wp_ref.trim() : "";
  const idemKey = (req.headers.get("idempotency-key") ?? "").trim();
  const base = {
    event_id: typeof event.event_id === "string" ? event.event_id : null,
    wp_ref: wpRef || null,
    site: typeof event.site === "string" ? event.site : null,
    type: typeof event.type === "string" ? event.type : null,
    payload: event,
  };
  if (!wpRef) {
    await log({ ...base, outcome: "invalid", error: "wp_ref wajib" });
    return json(400, { ok: false, error: "wp_ref wajib" });
  }
  if (idemKey && idemKey !== wpRef) {
    await log({ ...base, outcome: "invalid", error: "Idempotency-Key tidak sama dengan wp_ref" });
    return json(400, { ok: false, error: "Idempotency-Key harus sama dengan wp_ref" });
  }
  if (event.site !== "meago.id") {
    await log({ ...base, outcome: "invalid", error: "site tidak dikenal" });
    return json(400, { ok: false, error: "site tidak dikenal" });
  }

  // ---- 3. Terapkan (satu transaksi, idempoten) ------------------------------
  const { data, error } = await db.rpc("meago_intake_apply", { p_event: event });
  if (error) {
    const userError = error.message.startsWith("[");
    await log({ ...base, outcome: userError ? "invalid" : "error", error: error.message });
    return json(userError ? 422 : 500, {
      ok: false,
      error: userError ? error.message : "gagal memproses pendaftaran",
    });
  }

  const result = data as Record<string, unknown>;
  if (result?.test === true) {
    await log({ ...base, outcome: "test", result });
  }
  return json(200, {
    ok: true,
    kind: result.kind,
    msdps_code: result.msdps_code ?? null,
    linked_existing: result.linked_existing ?? false,
    ...(result.test === true ? { test: true } : {}),
  });
});
