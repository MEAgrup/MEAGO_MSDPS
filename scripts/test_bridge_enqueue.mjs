// QC lib/bridge/enqueue.ts — antrian OTOMATIS Bridge MSDPS→CDPS (migrasi 0377).
//
// Admin client palsu (tanpa DB/jaringan) untuk membuktikan:
//   - deal ber-rencana layanan TIDAK diantre selama pembayaran belum
//     terverifikasi, lalu OTOMATIS diantre begitu DP terverifikasi — dengan
//     info persentase DP di catatan payload;
//   - sweep berikutnya tidak mengantre ulang; "Tidak perlu CDPS" tidak pernah
//     diantre; deal Free/Barter dilewati;
//   - data belum lengkap ⇒ last_error + TEPAT satu alert (dedup), dan alert
//     ditutup begitu deal akhirnya berhasil diantre;
//   - error RPC ⇒ incomplete, bukan exception yang menghentikan sweep.
//
// Pakai: node scripts/test_bridge_enqueue.mjs

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

const outDir = mkdtempSync(join(tmpdir(), "qc-bridge-enqueue-"));
try {
  execFileSync(
    "npx",
    ["tsc", join(ROOT, "lib/bridge/enqueue.ts"), "--outDir", outDir, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
  );
} catch (e) {
  console.error("Gagal transpile lib/bridge/enqueue.ts:", e.stdout?.toString() || e.message);
  process.exit(1);
}
const { runEnqueueSweep, enqueueDealIfReady, merchantTargetEnabled } = require(join(outDir, "enqueue.js"));

// ---- Admin client palsu ------------------------------------------------------
function makeFakeAdmin(initial, rpcImpl) {
  const state = structuredClone(initial);
  const rpcCalls = [];

  function table(name) {
    state[name] ??= [];
    const filters = [];
    let op = "select";
    let patch = null;

    const run = () => {
      const rows = state[name].filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of rows) Object.assign(r, patch);
        return { data: null, error: null };
      }
      return { data: structuredClone(rows), error: null };
    };

    const builder = {
      select() {
        return builder;
      },
      eq(col, val) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      in(col, vals) {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      is(col, val) {
        filters.push((r) => (r[col] ?? null) === val);
        return builder;
      },
      contains(col, obj) {
        filters.push((r) => Object.entries(obj).every(([k, v]) => r[col]?.[k] === v));
        return builder;
      },
      update(p) {
        op = "update";
        patch = p;
        return builder;
      },
      insert(row) {
        const rows = Array.isArray(row) ? row : [row];
        for (const r of rows) state[name].push({ id: `${name}-${state[name].length + 1}`, resolved: false, ...r });
        return Promise.resolve({ data: null, error: null });
      },
      maybeSingle() {
        const { data } = run();
        return Promise.resolve({ data: data[0] ?? null, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };
    return builder;
  }

  return {
    state,
    rpcCalls,
    admin: {
      from: table,
      rpc(fn, args) {
        rpcCalls.push({ fn, args });
        return Promise.resolve(rpcImpl ? rpcImpl(fn, args, state) : defaultRpc(fn, args, state));
      },
    },
  };
}

// Meniru enqueue_bridge_order(): idempoten per deal.
function defaultRpc(fn, args, state) {
  if (fn !== "enqueue_bridge_order") return { data: null, error: { message: `rpc tak dikenal ${fn}` } };
  if (state.cdps_outbox.some((o) => o.deal_id === args.p_deal_id)) return { data: false, error: null };
  state.cdps_outbox.push({ id: `ob-${args.p_deal_id}`, deal_id: args.p_deal_id, payload: args.p_payload, idempotency_key: args.p_idempotency_key, status: "pending" });
  return { data: true, error: null };
}

const baseDeal = {
  code: "DEAL-202611-0001",
  brand_name: "Kedai Uji",
  shop_id: null,
  kategori_poi: "TTD",
  pic_name: "Budi",
  pic_whatsapp: "6281234567890",
  tanggal_mulai_kontrak: "2026-11-10",
  tanggal_akhir_kontrak: "2027-02-10",
  bd_id: "emp-bd",
  bentuk_kerjasama: "Berbayar",
  // Migrasi 0379 — diisi BD; hanya dikirim bila BRIDGE_KIRIM_MERCHANT_TARGET=1.
  merchant_gmv_baseline: 10000000,
  merchant_target_gmv: 40000000,
  link_akun_merchant: "https://shop.tiktok.com/kedai-uji",
  kategori_merchant: "F&B",
};

function fixture() {
  return {
    deal_cdps_plans: [
      { deal_id: "D1", tidak_perlu: false, lines: [{ jenis: "Account", qty: 1, catatan: "paket 3 bln" }, { jenis: "Live Stream", qty: 2, nilai_cross_charge: "500000" }], last_error: null },
      { deal_id: "D2", tidak_perlu: true, lines: [], last_error: null },
      { deal_id: "D3", tidak_perlu: false, lines: [{ jenis: "Ads", qty: 1 }], last_error: null },
      { deal_id: "D4", tidak_perlu: false, lines: [{ jenis: "Ads", qty: 1 }], last_error: null },
    ],
    brand_deals: [
      { id: "D1", ...baseDeal, transaction_id: "T1" },
      { id: "D2", ...baseDeal, code: "DEAL-202611-0002", transaction_id: "T2" },
      // D3: tanggal kontrak kosong — payload v1 menolak.
      { id: "D3", ...baseDeal, code: "DEAL-202611-0003", transaction_id: "T3", tanggal_mulai_kontrak: null },
      // D4: rencana basi, deal sudah diubah jadi Free/Barter.
      { id: "D4", ...baseDeal, code: "DEAL-202611-0004", transaction_id: "T4", bentuk_kerjasama: "Free/Barter" },
    ],
    transactions: [
      { id: "T1", code: "TRX-202611-0001", total_agreed_value: 15000000, amount_verified: 0, released_to_account_at: null, merchant_id: "M1", status_changed_by: null },
      { id: "T2", code: "TRX-202611-0002", total_agreed_value: 15000000, amount_verified: 15000000, released_to_account_at: "2026-11-03T02:00:00Z", merchant_id: "M1", status_changed_by: "emp-fin" },
      { id: "T3", code: "TRX-202611-0003", total_agreed_value: 10000000, amount_verified: 10000000, released_to_account_at: "2026-11-03T02:00:00Z", merchant_id: "M1", status_changed_by: "emp-fin" },
      { id: "T4", code: "TRX-202611-0004", total_agreed_value: 10000000, amount_verified: 10000000, released_to_account_at: "2026-11-03T02:00:00Z", merchant_id: "M1", status_changed_by: "emp-fin" },
    ],
    employees: [
      { id: "emp-bd", full_name: "Andi BD" },
      { id: "emp-fin", full_name: "Rina Finance" },
    ],
    merchants: [{ id: "M1", kota: "Bandung" }],
    cdps_outbox: [],
    platform_alerts: [],
  };
}

// ===== 1. Belum terverifikasi → menunggu, nol RPC ==============================
{
  const f = makeFakeAdmin(fixture());
  const r = await runEnqueueSweep(f.admin);
  eq("sweep 1: D1/D3/D4 diperiksa (D2 Tidak perlu CDPS dilewati)", r.checked, 3);
  eq("sweep 1: nol yang diantre", r.enqueued, 0);
  eq("sweep 1: D1 menunggu pembayaran", r.waiting, 1);
  eq("sweep 1: D3 incomplete (tanggal kontrak kosong)", r.incomplete, 1);
  check("sweep 1: D1 TIDAK memanggil enqueue_bridge_order", !f.rpcCalls.some((c) => c.args.p_deal_id === "D1"));
  check("sweep 1: D4 Free/Barter TIDAK diantre", !f.rpcCalls.some((c) => c.args.p_deal_id === "D4"));
  check("sweep 1: D2 Tidak perlu CDPS TIDAK diantre", !f.rpcCalls.some((c) => c.args.p_deal_id === "D2"));

  const p3 = f.state.deal_cdps_plans.find((p) => p.deal_id === "D3");
  check("D3: last_error terisi, menyebut tanggal kontrak", /tanggal_mulai_kontrak/.test(p3.last_error ?? ""), p3.last_error);
  eq("D3: satu alert cdps_bridge_incomplete ke BD", f.state.platform_alerts.filter((a) => a.alert_type === "cdps_bridge_incomplete" && a.detail.deal_id === "D3").map((a) => a.target_member_id), ["emp-bd"]);

  // ===== 2. Finance memverifikasi DP 30% → otomatis diantre =================
  Object.assign(f.state.transactions.find((t) => t.id === "T1"), {
    amount_verified: 4500000,
    released_to_account_at: "2026-11-03T03:00:00Z",
    status_changed_by: "emp-fin",
  });
  const r2 = await runEnqueueSweep(f.admin);
  eq("sweep 2: D1 diantre", r2.enqueued, 1);
  const call = f.rpcCalls.find((c) => c.args.p_deal_id === "D1");
  check("sweep 2: enqueue_bridge_order dipanggil untuk D1", !!call);
  eq("idempotency key", call?.args.p_idempotency_key, "DEAL-202611-0001:1");
  const note = "[Pembayaran klien saat diteruskan: DP 30% — Rp 4.500.000 dari Rp 15.000.000]";
  eq("payload catatan baris 1 = catatan + info DP", call?.args.p_payload.lines[0].catatan, `paket 3 bln ${note}`);
  eq("payload catatan baris 2 (tanpa catatan) = info DP", call?.args.p_payload.lines[1].catatan, note);
  eq("payload nilai_cross_charge baris 2", call?.args.p_payload.lines[1].nilai_cross_charge, "500000.00");
  eq("payload diverifikasi_oleh_external = Finance, bukan BD", call?.args.p_payload.attestation.diverifikasi_oleh_external, "Finance MSDPS — Rina Finance");
  eq("payload bd_identitas", call?.args.p_payload.bd_identitas, "Andi BD");
  eq("flag 0379 mati (default): payload TANPA merchant_target", call?.args.p_payload.merchant_target, undefined);

  // ===== 3. Sweep berikutnya: tidak mengantre ulang, alert D3 tidak dobel ====
  const before = f.rpcCalls.length;
  const r3 = await runEnqueueSweep(f.admin);
  eq("sweep 3: D1 tidak diperiksa lagi (sudah di outbox)", r3.checked, 2);
  check("sweep 3: nol RPC untuk D1", !f.rpcCalls.slice(before).some((c) => c.args.p_deal_id === "D1"));
  eq("sweep 3: alert D3 tetap SATU (dedup)", f.state.platform_alerts.filter((a) => a.detail.deal_id === "D3").length, 1);

  // ===== 4. BD melengkapi tanggal kontrak → diantre + alert ditutup =========
  f.state.brand_deals.find((d) => d.id === "D3").tanggal_mulai_kontrak = "2026-11-10";
  const out = await enqueueDealIfReady(f.admin, "D3");
  eq("D3 sesudah dilengkapi: enqueued, lunas 100%", out, { status: "enqueued", paid_percent: 100 });
  check("D3: alert ditutup (resolved)", f.state.platform_alerts.filter((a) => a.detail.deal_id === "D3").every((a) => a.resolved === true));
  const c3 = f.rpcCalls.find((c) => c.args.p_deal_id === "D3");
  eq("D3 catatan = info LUNAS", c3?.args.p_payload.lines[0].catatan, "[Pembayaran klien: LUNAS 100% — Rp 10.000.000]");

  eq("D1 dipanggil langsung lagi → already", await enqueueDealIfReady(f.admin, "D1"), { status: "already" });
  eq("D2 dipanggil langsung → skipped tidak perlu CDPS", (await enqueueDealIfReady(f.admin, "D2")).status, "skipped");
  eq("deal tanpa rencana → skipped", (await enqueueDealIfReady(f.admin, "DX")).status, "skipped");
}

// ===== 5. Error RPC → incomplete, sweep tidak berhenti =========================
{
  const fx = fixture();
  fx.transactions[0].released_to_account_at = "2026-11-03T03:00:00Z";
  fx.transactions[0].amount_verified = 15000000;
  fx.brand_deals[2].tanggal_mulai_kontrak = "2026-11-10";
  const f = makeFakeAdmin(fx, (fn, args) =>
    args.p_deal_id === "D1" ? { data: null, error: { message: "[pembayaran belum terverifikasi]" } } : defaultRpc(fn, args, f.state)
  );
  const r = await runEnqueueSweep(f.admin);
  eq("RPC error D1: dihitung incomplete", r.incomplete, 1);
  eq("RPC error D1: D3 tetap diantre di sweep yang sama", r.enqueued, 1);
  check(
    "RPC error D1: last_error memuat pesan DB",
    /pembayaran belum terverifikasi/.test(f.state.deal_cdps_plans.find((p) => p.deal_id === "D1").last_error ?? "")
  );
}

// ===== 6. Flag 0379 hidup → merchant_target ikut payload =====================
{
  eq("merchantTargetEnabled: default mati", merchantTargetEnabled({}), false);
  eq("merchantTargetEnabled: '1' hidup", merchantTargetEnabled({ BRIDGE_KIRIM_MERCHANT_TARGET: "1" }), true);
  const fx = fixture();
  fx.transactions[0].released_to_account_at = "2026-11-03T03:00:00Z";
  fx.transactions[0].amount_verified = 15000000;
  const f = makeFakeAdmin(fx, (fn, args) => defaultRpc(fn, args, f.state));
  process.env.BRIDGE_KIRIM_MERCHANT_TARGET = "1";
  try {
    await enqueueDealIfReady(f.admin, "D1");
  } finally {
    delete process.env.BRIDGE_KIRIM_MERCHANT_TARGET;
  }
  eq(
    "flag hidup: merchant_target dari kolom brand_deals",
    f.rpcCalls.find((c) => c.args.p_deal_id === "D1")?.args.p_payload.merchant_target,
    { gmv_baseline: "10000000.00", target_gmv: "40000000.00", link_akun: "https://shop.tiktok.com/kedai-uji", kategori: "F&B" }
  );
}

rmSync(outDir, { recursive: true, force: true });

console.log(`\nQC bridge enqueue: ${pass} lolos, ${fail} gagal`);
if (fail > 0) {
  console.error("\nGAGAL:");
  for (const x of failures) console.error("  ✗ " + x);
  process.exit(1);
}
