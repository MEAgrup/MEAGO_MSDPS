// QC readMerchantTarget() (lib/deals/intake.ts) — isian Baseline & Target GMV
// form "Daftarkan Transaksi" (migrasi 0379, membalik Bridge D7).
//
// Pakai: node scripts/qc_deal_merchant_target.mjs

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
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else {
    fail++;
    failures.push(`${name} — harap ${e}, dapat ${a}`);
  }
}

const outDir = mkdtempSync(join(tmpdir(), "qc-deal-target-"));
try {
  execFileSync(
    "npx",
    ["tsc", join(ROOT, "lib/deals/intake.ts"), "--outDir", outDir, "--rootDir", join(ROOT, "lib"), "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck"],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (e) {
  console.error("Gagal transpile lib/deals/intake.ts:", e.stdout?.toString() || e.message);
  process.exit(1);
}
const { readMerchantTarget } = require(join(outDir, "deals/intake.js"));

const form = (o) => (k) => o[k] ?? "";
const NEW = { requireTarget: true };
const EDIT = { requireTarget: false };

// Deal baru: Target GMV wajib.
eq("baru: target kosong ditolak", readMerchantTarget(form({}), NEW), { error: "[target GMV wajib diisi]" });
eq("baru: hanya target -> sisanya null", readMerchantTarget(form({ merchant_target_gmv: "50000000" }), NEW), {
  fields: { merchant_gmv_baseline: null, merchant_target_gmv: 50000000, link_akun_merchant: null, kategori_merchant: null },
});
eq(
  "baru: lengkap, format rupiah ditoleransi, spasi dipangkas",
  readMerchantTarget(
    form({
      merchant_gmv_baseline: "Rp 12.500.000",
      merchant_target_gmv: " 50000000 ",
      link_akun_merchant: " https://shop.tiktok.com/abc ",
      kategori_merchant: " F&B ",
    }),
    NEW
  ),
  { fields: { merchant_gmv_baseline: 12500000, merchant_target_gmv: 50000000, link_akun_merchant: "https://shop.tiktok.com/abc", kategori_merchant: "F&B" } }
);
eq("baseline 0 boleh", readMerchantTarget(form({ merchant_gmv_baseline: "0", merchant_target_gmv: "1" }), NEW).fields?.merchant_gmv_baseline, 0);

// Validasi nilai.
eq("target 0 ditolak", readMerchantTarget(form({ merchant_target_gmv: "0" }), NEW), { error: "[target GMV tidak valid, harus lebih dari 0]" });
eq("target negatif ditolak", readMerchantTarget(form({ merchant_target_gmv: "-5" }), EDIT), { error: "[target GMV tidak valid, harus lebih dari 0]" });
eq("target bukan angka ditolak", readMerchantTarget(form({ merchant_target_gmv: "banyak" }), NEW), { error: "[target GMV tidak valid, harus lebih dari 0]" });
eq("baseline negatif ditolak", readMerchantTarget(form({ merchant_gmv_baseline: "-1", merchant_target_gmv: "1" }), NEW), { error: "[GMV baseline tidak valid]" });
eq("link tanpa skema ditolak", readMerchantTarget(form({ merchant_target_gmv: "1", link_akun_merchant: "shop.tiktok.com/x" }), NEW), {
  error: "[link akun merchant harus diawali http:// atau https://]",
});
eq("link berspasi ditolak", readMerchantTarget(form({ merchant_target_gmv: "1", link_akun_merchant: "https://a b" }), NEW), {
  error: "[link akun merchant harus diawali http:// atau https://]",
});
eq("kategori > 100 karakter ditolak", readMerchantTarget(form({ merchant_target_gmv: "1", kategori_merchant: "x".repeat(101) }), NEW), {
  error: "[kategori merchant maksimal 100 karakter]",
});

// Edit / approval deal lama (sebelum 0379): semua boleh kosong.
eq("edit: semua kosong -> semua null", readMerchantTarget(form({}), EDIT), {
  fields: { merchant_gmv_baseline: null, merchant_target_gmv: null, link_akun_merchant: null, kategori_merchant: null },
});

rmSync(outDir, { recursive: true, force: true });

console.log(`\nQC deal merchant target: ${pass} lolos, ${fail} gagal`);
if (fail > 0) {
  console.error("\nGAGAL:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
