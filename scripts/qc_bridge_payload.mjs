// QC lib/bridge/payload.ts — payload builder Bridge MSDPS→CDPS Fase 1.
//
// Membuktikan output builder cocok BENTUK-nya (byte-for-byte pada field yang
// derivable secara mekanis dari sumber) dengan docs/fixtures/bridge_order_v1.json
// — fixture yang sama persis dikomit di kedua repo (D12). String bebas manusia
// (bd_identitas / diverifikasi_oleh_external) TIDAK dicocokkan literal ke
// fixture (itu contoh ilustratif, bukan spek format) — yang diuji adalah bahwa
// keduanya TETAP BEDA (bug nyata yang pernah terjadi: bd_identitas salah
// dipakai ulang untuk diverifikasi_oleh_external, padahal BD != Finance).
//
// Pakai: node scripts/qc_bridge_payload.mjs

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
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
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(detail ? `${name} — ${detail}` : name);
  }
}

function eq(name, actual, expected) {
  check(name, Object.is(actual, expected), `harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`);
}

// ---- Kompilasi lib/bridge/payload.ts ke JS sementara ------------------------
const outDir = mkdtempSync(join(tmpdir(), "qc-bridge-"));
try {
  execFileSync(
    "npx",
    ["tsc", join(ROOT, "lib/bridge/payload.ts"), "--outDir", outDir, "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (e) {
  console.error("Gagal transpile lib/bridge/payload.ts:", e.stdout?.toString() || e.message);
  process.exit(1);
}
const { buildBridgePayload, bridgeIdempotencyKey, PAYLOAD_VERSI, paidPercent, paymentSummaryText } = require(join(outDir, "payload.js"));

const fixture = JSON.parse(readFileSync(join(ROOT, "docs/fixtures/bridge_order_v1.json"), "utf8"));

// ===== 1. Baris sumber yang, kalau builder benar, menghasilkan fixture ======
const sourceRow = {
  deal: {
    code: "DEAL-202609-0001",
    brand_name: "Kedai Kopi Senja",
    shop_id: "SHOP-77012345",
    kategori_poi: "Dining",
    pic_name: "Budi Santoso",
    pic_whatsapp: "081234567890",
    tanggal_mulai_kontrak: "2026-09-15",
    tanggal_akhir_kontrak: "2027-03-15",
  },
  bd: { full_name: "Andi Saputra" },
  transaction: {
    code: "TRX-202609-0007",
    total_agreed_value: 15000000,
    released_to_account_at: "2026-09-10T03:15:00Z",
  },
  financeVerifier: { full_name: "Rina W." },
  merchant: { id: "11111111-1111-1111-1111-111111111111", kota: "Bandung" },
  lines: [
    { jenis: "Account", qty: 1, catatan: "Strategi + brief bulanan, paket 6 bulan", alasan_non_roster: null, nilai_cross_charge: 500000 },
    { jenis: "Ads", qty: 1, catatan: "Iklan TikTok Ads, budget dikelola MEA Agency", alasan_non_roster: null, nilai_cross_charge: 300000 },
    {
      jenis: "KOL-Non-Roster",
      qty: 2,
      catatan: "2 video review, creator lokal Bandung",
      alasan_non_roster: "Creator lokal tidak terdaftar di roster MCN MEA — dipilih merchant langsung",
      nilai_cross_charge: null,
    },
  ],
};

const out = buildBridgePayload(sourceRow);

eq("payload_versi", out.payload_versi, 1);
eq("payload_versi konstan", PAYLOAD_VERSI, 1);
eq("deal_code", out.deal_code, fixture.deal_code);
check("bd_identitas terisi", typeof out.bd_identitas === "string" && out.bd_identitas.length > 0);

eq("merchant.external_id (shop_id ada -> dipakai, bukan merchant.id)", out.merchant.external_id, fixture.merchant.external_id);
eq("merchant.nama", out.merchant.nama, fixture.merchant.nama);
eq("merchant.kota", out.merchant.kota, fixture.merchant.kota);
eq("merchant.kategori_poi (ejaan DB verbatim)", out.merchant.kategori_poi, fixture.merchant.kategori_poi);
eq("merchant.pic_nama", out.merchant.pic_nama, fixture.merchant.pic_nama);
eq("merchant.pic_whatsapp", out.merchant.pic_whatsapp, fixture.merchant.pic_whatsapp);
eq("merchant.tanggal_mulai_kontrak (WIB calendar string, tidak digeser)", out.merchant.tanggal_mulai_kontrak, fixture.merchant.tanggal_mulai_kontrak);
eq("merchant.tanggal_akhir_kontrak", out.merchant.tanggal_akhir_kontrak, fixture.merchant.tanggal_akhir_kontrak);

eq("attestation.external_trx_ref", out.attestation.external_trx_ref, fixture.attestation.external_trx_ref);
eq("attestation.bentuk_kerjasama SELALU 'Berbayar'", out.attestation.bentuk_kerjasama, "Berbayar");
eq("attestation.nilai (integer rupiah decimal string, bukan float/lokalisasi)", out.attestation.nilai, fixture.attestation.nilai);
eq("attestation.diverifikasi_pada", out.attestation.diverifikasi_pada, fixture.attestation.diverifikasi_pada);
check(
  "attestation.diverifikasi_oleh_external BEDA dari bd_identitas (Finance != BD — bug nyata yang pernah terjadi)",
  out.attestation.diverifikasi_oleh_external !== out.bd_identitas,
  `bd_identitas=${JSON.stringify(out.bd_identitas)} diverifikasi_oleh_external=${JSON.stringify(out.attestation.diverifikasi_oleh_external)}`,
);
check("attestation.diverifikasi_oleh_external menyebut Finance", out.attestation.diverifikasi_oleh_external?.includes("Rina W.") ?? false);

eq("lines.length", out.lines.length, fixture.lines.length);
for (let i = 0; i < fixture.lines.length; i++) {
  eq(`lines[${i}].jenis`, out.lines[i].jenis, fixture.lines[i].jenis);
  eq(`lines[${i}].qty`, out.lines[i].qty, fixture.lines[i].qty);
  eq(`lines[${i}].catatan`, out.lines[i].catatan, fixture.lines[i].catatan);
  eq(`lines[${i}].alasan_non_roster`, out.lines[i].alasan_non_roster, fixture.lines[i].alasan_non_roster);
  eq(`lines[${i}].nilai_cross_charge`, out.lines[i].nilai_cross_charge, fixture.lines[i].nilai_cross_charge);
}

// ===== 2. Jebakan glosarium: shop_id kosong -> jatuh ke merchant.id =========
const noShop = buildBridgePayload({ ...sourceRow, deal: { ...sourceRow.deal, shop_id: null } });
eq("shop_id null -> external_id jatuh ke merchant.id", noShop.merchant.external_id, sourceRow.merchant.id);
const blankShop = buildBridgePayload({ ...sourceRow, deal: { ...sourceRow.deal, shop_id: "  " } });
eq("shop_id spasi kosong -> external_id jatuh ke merchant.id juga", blankShop.merchant.external_id, sourceRow.merchant.id);

// ===== 3. Uang: integer rupiah, tidak pernah float/lokalisasi ===============
eq("moneyString via nilai_cross_charge null -> null (bukan 'null' string)", out.lines[2].nilai_cross_charge, null);
const bigMoney = buildBridgePayload({
  ...sourceRow,
  transaction: { ...sourceRow.transaction, total_agreed_value: "2500000" },
});
eq("nilai dari string numeric DB -> '2500000.00'", bigMoney.attestation.nilai, "2500000.00");

// ===== 4. kreator_needed/konten_needed/visit window TIDAK PERNAH di payload =
const keys = JSON.stringify(out);
for (const forbidden of ["kreator_needed", "konten_needed", "videos_needed", "kreators_needed", "visit_start", "visit_end", "otaPlatformsRaw"]) {
  check(`payload TIDAK PERNAH mengandung "${forbidden}"`, !keys.includes(forbidden));
}

// ===== 5. Idempotency key ====================================================
eq("bridgeIdempotencyKey", bridgeIdempotencyKey("DEAL-202609-0001"), "DEAL-202609-0001:1");

// ===== 6. Field wajib hilang -> throw, bukan default diam-diam ==============
function throws(name, fn) {
  try {
    fn();
    check(name, false, "tidak melempar");
  } catch {
    check(name, true);
  }
}
throws("kategori_poi null -> throw", () => buildBridgePayload({ ...sourceRow, deal: { ...sourceRow.deal, kategori_poi: null } }));
throws("bd null -> throw (bukan default 'BD tidak diketahui')", () => buildBridgePayload({ ...sourceRow, bd: null }));
throws("transaction.code null -> throw", () => buildBridgePayload({ ...sourceRow, transaction: { ...sourceRow.transaction, code: null } }));
throws("lines kosong -> throw", () => buildBridgePayload({ ...sourceRow, lines: [] }));

// ===== 7. Info pembayaran (bridge otomatis, migrasi 0377) ====================
// Deal boleh diteruskan sejak DP — persentase ditambahkan ke `catatan` tiap
// baris (string bebas yang SUDAH ada di kontrak v1; nol field baru).
eq("paidPercent DP 30%", paidPercent({ amount_verified: 4500000, total_agreed_value: 15000000 }), 30);
eq("paidPercent lunas", paidPercent({ amount_verified: "15000000", total_agreed_value: "15000000.00" }), 100);
eq("paidPercent 99,96% dibulatkan KE BAWAH (tidak tampil 100%)", paidPercent({ amount_verified: 9996, total_agreed_value: 10000 }), 99.9);
eq("paidPercent sepertiga", paidPercent({ amount_verified: 1, total_agreed_value: 3 }), 33.3);
eq("paidPercent total 0 -> null", paidPercent({ amount_verified: 0, total_agreed_value: 0 }), null);
eq(
  "paymentSummaryText DP",
  paymentSummaryText({ amount_verified: 4500000, total_agreed_value: 15000000 }),
  "[Pembayaran klien saat diteruskan: DP 30% — Rp 4.500.000 dari Rp 15.000.000]"
);
eq(
  "paymentSummaryText DP desimal pakai koma",
  paymentSummaryText({ amount_verified: 1, total_agreed_value: 3 }),
  "[Pembayaran klien saat diteruskan: DP 33,3% — Rp 1 dari Rp 3]"
);
eq(
  "paymentSummaryText lunas",
  paymentSummaryText({ amount_verified: 15000000, total_agreed_value: 15000000 }),
  "[Pembayaran klien: LUNAS 100% — Rp 15.000.000]"
);

const withDp = buildBridgePayload({ ...sourceRow, paymentInfo: { amount_verified: 4500000, total_agreed_value: 15000000 } });
const dpNote = "[Pembayaran klien saat diteruskan: DP 30% — Rp 4.500.000 dari Rp 15.000.000]";
check(
  "paymentInfo: SETIAP baris catatan memuat info DP",
  withDp.lines.every((l) => typeof l.catatan === "string" && l.catatan.endsWith(dpNote)),
  JSON.stringify(withDp.lines.map((l) => l.catatan))
);
eq("paymentInfo: catatan asli tetap di depan", withDp.lines[0].catatan, `${fixture.lines[0].catatan} ${dpNote}`);
const noCatatan = buildBridgePayload({
  ...sourceRow,
  lines: [{ ...sourceRow.lines[0], catatan: null }],
  paymentInfo: { amount_verified: 4500000, total_agreed_value: 15000000 },
});
eq("paymentInfo: catatan null -> berisi info DP saja", noCatatan.lines[0].catatan, dpNote);
eq(
  "paymentInfo: kunci payload IDENTIK dengan fixture v1 (nol field baru)",
  JSON.stringify(Object.keys(withDp).sort()) + JSON.stringify(Object.keys(withDp.attestation).sort()) + JSON.stringify(Object.keys(withDp.lines[0]).sort()),
  JSON.stringify(Object.keys(fixture).sort()) + JSON.stringify(Object.keys(fixture.attestation).sort()) + JSON.stringify(Object.keys(fixture.lines[0]).sort())
);
eq("tanpa paymentInfo: catatan tidak berubah", buildBridgePayload(sourceRow).lines[0].catatan, fixture.lines[0].catatan);

// ===== 8. merchant_target (migrasi 0378, membalik D7) ========================
// Opsional & aditif: tanpa merchantTarget ⇒ kunci top-level identik fixture v1.
const fixtureKeys = JSON.stringify(Object.keys(fixture).sort());
eq("tanpa merchantTarget: kunci top-level identik fixture v1", JSON.stringify(Object.keys(buildBridgePayload(sourceRow)).sort()), fixtureKeys);
eq(
  "merchantTarget null: kunci top-level identik fixture v1",
  JSON.stringify(Object.keys(buildBridgePayload({ ...sourceRow, merchantTarget: null })).sort()),
  fixtureKeys
);
eq(
  "merchantTarget tanpa target_gmv (deal lama): blok tidak dikirim",
  buildBridgePayload({
    ...sourceRow,
    merchantTarget: { merchant_gmv_baseline: 1000000, merchant_target_gmv: null, link_akun_merchant: null, kategori_merchant: null },
  }).merchant_target,
  undefined
);
const withTarget = buildBridgePayload({
  ...sourceRow,
  merchantTarget: {
    merchant_gmv_baseline: "12500000",
    merchant_target_gmv: 50000000,
    link_akun_merchant: "  https://shop.tiktok.com/x  ",
    kategori_merchant: "",
  },
});
eq(
  "merchant_target: bentuk lengkap, uang string desimal",
  JSON.stringify(withTarget.merchant_target),
  JSON.stringify({ gmv_baseline: "12500000.00", target_gmv: "50000000.00", link_akun: "https://shop.tiktok.com/x", kategori: null })
);
eq(
  "merchant_target: baseline null tetap null",
  buildBridgePayload({
    ...sourceRow,
    merchantTarget: { merchant_gmv_baseline: null, merchant_target_gmv: 1, link_akun_merchant: null, kategori_merchant: "F&B" },
  }).merchant_target.gmv_baseline,
  null
);
eq("merchant_target: payload_versi tetap 1", withTarget.payload_versi, 1);
eq("merchant_target: lines tidak tersentuh", JSON.stringify(withTarget.lines), JSON.stringify(buildBridgePayload(sourceRow).lines));

rmSync(outDir, { recursive: true, force: true });

console.log(`\nQC bridge payload: ${pass} lolos, ${fail} gagal`);
if (fail > 0) {
  console.error("\nGAGAL:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
