// WAJIB TEST — diagnosa env service-role (lib/supabase/admin.ts).
//
// Kenapa ada: fungsi-fungsi ini tidak pernah menyentuh database, tapi merekalah
// yang menentukan apa yang dibaca orang saat pembuatan akun gagal di
// production. Diagnosa yang salah membuang waktu ke arah yang keliru — dan itu
// sudah pernah terjadi: `hasWhitespace` hanya membandingkan `raw !== trimmed`,
// sehingga key dengan spasi DI TENGAH lolos tanpa peringatan, ditolak Supabase
// 401, lalu adminKeyRejectionHint() menyimpulkan "key sudah tidak berlaku /
// JWT secret dirotasi". Orang yang membacanya akan merotasi key yang
// sebenarnya masih sah.
//
// Pakai: node scripts/test_admin_key_diag.mjs
//
// lib/supabase/admin.ts di-transpile on the fly ke CommonJS lewat `tsc` sekali
// ke direktori sementara — pola sama persis dengan
// scripts/test_campaign_completion.mjs.

import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const ROOT = new URL("..", import.meta.url).pathname;
const require = createRequire(import.meta.url);

let pass = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) pass++;
  else failures.push(detail ? `${name} — ${detail}` : name);
}

function eq(name, actual, expected) {
  check(name, actual === expected, `harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`);
}

function contains(name, haystack, needle) {
  check(
    name,
    typeof haystack === "string" && haystack.toLowerCase().includes(needle.toLowerCase()),
    `pesan tidak memuat "${needle}". Pesan: ${JSON.stringify(haystack)}`
  );
}

function notContains(name, haystack, needle) {
  check(
    name,
    typeof haystack === "string" && !haystack.toLowerCase().includes(needle.toLowerCase()),
    `pesan SEHARUSNYA TIDAK memuat "${needle}". Pesan: ${JSON.stringify(haystack)}`
  );
}

// ---- Kompilasi lib TS yang diuji ke JS sementara ---------------------------
const outDir = mkdtempSync(join(tmpdir(), "test-admin-key-"));
let admin;
try {
  execFileSync(
    "npx",
    [
      "tsc",
      join(ROOT, "lib/supabase/admin.ts"),
      "--outDir", outDir,
      "--module", "commonjs",
      "--target", "es2022",
      "--moduleResolution", "node",
      "--esModuleInterop",
      "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
  );
  // admin.ts mengimpor @supabase/supabase-js di level modul (dipakai
  // createAdminClient, bukan fungsi diagnosa yang diuji di sini). Hasil
  // transpile ada di luar direktori project, jadi resolusi modul Node tidak
  // menemukan node_modules dengan menaiki direktori — disambungkan lewat symlink.
  symlinkSync(join(ROOT, "node_modules"), join(outDir, "node_modules"), "dir");
  admin = require(join(outDir, "admin.js"));

  const PROD_REF = "mvcckptntrvzujqaoxxh";
  const STG_REF = "vgjzvdpxrdoefoncuazw";
  const URL_PROD = `https://${PROD_REF}.supabase.co`;

  const b64url = (o) => Buffer.from(JSON.stringify(o), "utf8").toString("base64url");
  const jwt = (role, ref) => `eyJhbGciOiJIUzI1NiJ9.${b64url({ role, ref })}.c2lnbmF0dXJl`;

  // Menyetel env lalu memanggil ulang describeAdminKey — fungsinya membaca
  // process.env setiap kali, bukan menangkapnya di module load.
  function withEnv(url, key) {
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    return admin.describeAdminKey();
  }

  // ---- 1. Env kosong -------------------------------------------------------
  let info = withEnv(undefined, undefined);
  eq("env kosong: keyPresent", info.keyPresent, false);
  eq("env kosong: format", info.format, "none");
  eq("env kosong: edgeWhitespace", info.edgeWhitespace, false);
  eq("env kosong: innerWhitespace", info.innerWhitespace, false);
  contains("env kosong: peringatan menyebut URL", admin.adminKeyWarning(info), "NEXT_PUBLIC_SUPABASE_URL");

  // ---- 2. Key sah, project cocok → tidak ada keluhan ----------------------
  info = withEnv(URL_PROD, jwt("service_role", PROD_REF));
  eq("key sah: format", info.format, "jwt");
  eq("key sah: role", info.role, "service_role");
  eq("key sah: innerWhitespace", info.innerWhitespace, false);
  eq("key sah: tanpa peringatan", admin.adminKeyWarning(info), null);

  // ---- 3. Tertukar anon key -----------------------------------------------
  info = withEnv(URL_PROD, jwt("anon", PROD_REF));
  contains("anon key: peringatan menyebut role", admin.adminKeyWarning(info), 'role "anon"');

  // ---- 4. Publishable key --------------------------------------------------
  info = withEnv(URL_PROD, "sb_publishable_8gXTP0foqFYVQ89kQ1gAaILRX5lN");
  eq("publishable: format", info.format, "publishable");
  contains("publishable: peringatan", admin.adminKeyWarning(info), "publishable");

  // ---- 5. Key milik project lain ------------------------------------------
  info = withEnv(URL_PROD, jwt("service_role", STG_REF));
  contains("ref beda: peringatan menyebut project", admin.adminKeyWarning(info), "Staging");

  // ---- 6. Spasi di UJUNG → dipangkas otomatis, informasi saja -------------
  info = withEnv(URL_PROD, `  ${jwt("service_role", PROD_REF)}\n`);
  eq("ujung: edgeWhitespace", info.edgeWhitespace, true);
  eq("ujung: innerWhitespace", info.innerWhitespace, false);
  eq("ujung: role tetap terbaca", info.role, "service_role");
  contains("ujung: peringatan menyebut dipangkas", admin.adminKeyWarning(info), "dipangkas otomatis");

  // ---- 7. REGRESI — sb_secret_ dengan spasi DI TENGAH ---------------------
  // Inilah kasus yang dulu lolos: trim() tidak menyentuhnya, Supabase menolak
  // 401, lalu hint-nya menyalahkan rotasi JWT secret.
  info = withEnv(URL_PROD, "sb_secret_abc123 def456ghi");
  eq("tengah/secret: edgeWhitespace", info.edgeWhitespace, false);
  eq("tengah/secret: innerWhitespace", info.innerWhitespace, true);
  let w = admin.adminKeyWarning(info);
  check("tengah/secret: ADA peringatan", w !== null, "adminKeyWarning mengembalikan null");
  contains("tengah/secret: peringatan menyebut tengah", w, "DI TENGAH");
  let hint = admin.adminKeyRejectionHint(info);
  check(
    "tengah/secret: hint BUKAN dugaan rotasi",
    hint !== admin.ADMIN_KEY_REJECTED_HINT,
    "hint masih jatuh ke ADMIN_KEY_REJECTED_HINT"
  );
  notContains("tengah/secret: hint tidak menuduh rotasi", hint, "dirotasi");

  // ---- 8. REGRESI — JWT dengan spasi DI TENGAH ----------------------------
  // Sebelumnya didiagnosa "terpotong saat paste" karena decode-nya gagal.
  const j = jwt("service_role", PROD_REF);
  info = withEnv(URL_PROD, `${j.slice(0, 20)} ${j.slice(20)}`);
  eq("tengah/jwt: innerWhitespace", info.innerWhitespace, true);
  w = admin.adminKeyWarning(info);
  contains("tengah/jwt: peringatan menyebut tengah", w, "DI TENGAH");
  notContains("tengah/jwt: tidak menyebut terpotong", w, "terpotong saat paste");
  check(
    "tengah/jwt: hint BUKAN dugaan rotasi",
    admin.adminKeyRejectionHint(info) !== admin.ADMIN_KEY_REJECTED_HINT
  );

  // ---- 9. Newline di tengah (kasus paling nyata: key jadi dua baris) ------
  info = withEnv(URL_PROD, `${j.slice(0, 20)}\n${j.slice(20)}`);
  eq("newline tengah: innerWhitespace", info.innerWhitespace, true);
  contains("newline tengah: peringatan menyebut tengah", admin.adminKeyWarning(info), "DI TENGAH");

  // ---- 10. Bentuk key benar semua → hint jatuh ke kemungkinan terakhir ----
  // Satu-satunya keadaan di mana ADMIN_KEY_REJECTED_HINT memang jawaban benar.
  info = withEnv(URL_PROD, jwt("service_role", PROD_REF));
  eq("key bersih: hint = kemungkinan terakhir", admin.adminKeyRejectionHint(info), admin.ADMIN_KEY_REJECTED_HINT);

  // ---- 11. adminKeyRejectionHint SELALU mengembalikan sesuatu -------------
  for (const [label, url, key] of [
    ["kosong", undefined, undefined],
    ["url saja", URL_PROD, undefined],
    ["key tak dikenal", URL_PROD, "kunci-acak-tanpa-prefix"],
    ["jwt rusak", URL_PROD, "eyJhbGciOiJIUzI1NiJ9.@@@.sig"],
  ]) {
    const h = admin.adminKeyRejectionHint(withEnv(url, key));
    check(`hint selalu ada (${label})`, typeof h === "string" && h.length > 0, `dapat ${JSON.stringify(h)}`);
  }

  // ---- 12. Key TIDAK PERNAH bocor ke pesan mana pun -----------------------
  const RAHASIA = `sb_secret_JANGAN BOCOR_${"x".repeat(40)}`;
  info = withEnv(URL_PROD, RAHASIA);
  const semua = [
    admin.adminKeyWarning(info) ?? "",
    admin.adminKeyRejectionHint(info),
    JSON.stringify(info),
  ].join(" ");
  notContains("key tidak bocor ke pesan", semua, "JANGAN BOCOR");
  check(
    "prefix yang ditampilkan dibatasi 10 karakter",
    info.prefix.length <= 10,
    `prefix "${info.prefix}" (${info.prefix.length} karakter)`
  );
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`${pass} lolos, ${failures.length} gagal.`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`${pass} lolos, 0 gagal.`);
