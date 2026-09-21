// QC logika jendela onboarding karyawan (migrasi 0365) — lib/employee-onboarding.ts.
//
// Yang ditegakkan DB sudah diuji scripts/test_employee_onboarding.sql. Yang
// diuji di sini adalah lapis yang TIDAK dilihat DB: pembacaan konfigurasi
// (termasuk bentuk rusak), penentuan buka/tutup terhadap waktu, pesan penolakan
// yang dilihat penambah, pembuatan password sementara, dan konversi WIB dari
// <input type="datetime-local"> — sumber salah geser 7 jam yang tidak akan
// pernah terlihat di uji SQL.
//
// Pakai: node scripts/qc_employee_onboarding.mjs

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import Module from "node:module";

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

// ---- Kompilasi lib TS yang diuji --------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), "qc-onb-"));
// Lewat tsconfig sementara, bukan flag: alias "@/lib/*" perlu `paths`, yang
// tidak punya padanan di baris perintah tsc.
const tsconfigPath = join(outDir, "tsconfig.qc.json");
writeFileSync(
  tsconfigPath,
  JSON.stringify({
    compilerOptions: {
      outDir,
      rootDir: join(ROOT, "lib"),
      module: "commonjs",
      target: "es2022",
      moduleResolution: "node",
      skipLibCheck: true,
      baseUrl: ROOT,
      paths: { "@/*": ["./*"] },
      lib: ["es2022", "dom"],
    },
    files: [join(ROOT, "lib/employee-onboarding.ts"), join(ROOT, "lib/divisions.ts")],
  }),
);
try {
  execFileSync("npx", ["tsc", "-p", tsconfigPath], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  console.error("Gagal transpile lib:", e.stdout?.toString() || e.message);
  process.exit(1);
}

// tsc tidak menulis ulang alias path "@/..." saat emit, jadi require-nya
// dipetakan di sini — bukan dengan mengubah lib-nya supaya bisa diuji.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith("@/lib/")) return join(outDir, request.slice("@/lib/".length) + ".js");
  return resolve.call(this, request, ...rest);
};

const {
  parseWindow,
  windowStatus,
  isWindowOpen,
  windowAllowsDivision,
  verdictForAdd,
  generateTempPassword,
  wibLocalInputToIso,
  isoToWibLocalInput,
  formatWib,
  WINDOW_CLOSED,
} = require(join(outDir, "employee-onboarding.js"));

const NOW = new Date("2026-09-21T10:00:00Z");
const later = (h) => new Date(NOW.getTime() + h * 3600_000).toISOString();
const earlier = (h) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const OPEN = { enabled: true, opens_at: null, closes_at: later(48), divisions: null, note: null };

// ===== 1. parseWindow: apa pun yang tidak dikenali harus MENUTUP ==============
eq("parse: null → tertutup", parseWindow(null).enabled, false);
eq("parse: string → tertutup", parseWindow("enabled").enabled, false);
eq("parse: array → tertutup", parseWindow([1, 2]).enabled, false);
eq("parse: {} → tertutup", parseWindow({}).enabled, false);
eq('parse: enabled:"true" (string) BUKAN true', parseWindow({ enabled: "true" }).enabled, false);
eq("parse: enabled:1 BUKAN true", parseWindow({ enabled: 1 }).enabled, false);
eq("parse: enabled:true terbaca", parseWindow({ enabled: true }).enabled, true);
eq(
  "parse: closes_at dinormalkan ke ISO",
  parseWindow({ enabled: true, closes_at: "2026-10-01T00:00:00+07:00" }).closes_at,
  "2026-09-30T17:00:00.000Z",
);
eq("parse: closes_at sampah → null", parseWindow({ enabled: true, closes_at: "besok" }).closes_at, null);
eq("parse: divisions bukan array → null", parseWindow({ divisions: "BizDev" }).divisions, null);
eq("parse: divisions kosong → null", parseWindow({ divisions: [] }).divisions, null);
check(
  "parse: divisi tak dikenal dibuang",
  JSON.stringify(parseWindow({ divisions: ["BizDev", "Ngarang"] }).divisions) === '["BizDev"]',
);
eq("parse: note kosong → null", parseWindow({ note: "   " }).note, null);
eq("WINDOW_CLOSED tertutup", isWindowOpen(WINDOW_CLOSED, NOW), false);

// ===== 2. windowStatus terhadap waktu ========================================
eq("status: enabled + belum lewat = TERBUKA", windowStatus(OPEN, NOW).open, true);
eq(
  "status: enabled=false = tertutup",
  windowStatus({ ...OPEN, enabled: false }, NOW).open,
  false,
);
eq(
  "status: closes_at sudah lewat = tertutup",
  windowStatus({ ...OPEN, closes_at: earlier(1) }, NOW).open,
  false,
);
eq(
  "status: tepat pada closes_at = tertutup (batas eksklusif)",
  windowStatus({ ...OPEN, closes_at: NOW.toISOString() }, NOW).open,
  false,
);
eq(
  "status: opens_at belum tiba = tertutup",
  windowStatus({ ...OPEN, opens_at: later(1) }, NOW).open,
  false,
);
eq(
  "status: opens_at sudah lewat = terbuka",
  windowStatus({ ...OPEN, opens_at: earlier(1) }, NOW).open,
  true,
);
check(
  "status: alasan kedaluwarsa menyebut kembali ke OD/HR",
  /OD\/HR/.test(windowStatus({ ...OPEN, closes_at: earlier(1) }, NOW).reason),
);
check(
  "status: terbuka tanpa closes_at ditandai perlu tanggal",
  /tanpa tanggal tutup/i.test(windowStatus({ ...OPEN, closes_at: null }, NOW).reason),
);

// ===== 3. Daftar divisi ======================================================
eq("divisi: null = semua boleh", windowAllowsDivision(OPEN, "BizDev"), true);
eq("divisi: dalam daftar", windowAllowsDivision({ ...OPEN, divisions: ["BizDev"] }, "BizDev"), true);
eq(
  "divisi: luar daftar",
  windowAllowsDivision({ ...OPEN, divisions: ["BizDev"] }, "CreatorManagement"),
  false,
);

// ===== 4. verdictForAdd — cerminan WITH CHECK policy 0365 ====================
const OD = { division: "Marketing", rank: "staff", is_od: true, is_director: false };
const DIR = { division: "Account", rank: "lead", is_od: false, is_director: true };
const LEAD = { division: "CreatorManagement", rank: "lead", is_od: false, is_director: false };
const STAFF = { division: "CreatorManagement", rank: "staff", is_od: false, is_director: false };
const t = (division, rank, is_od = false, is_director = false) => ({ division, rank, is_od, is_director });

eq(
  "verdict: OD boleh mengangkat lead divisi lain",
  verdictForAdd(OD, t("BizDev", "lead"), WINDOW_CLOSED, NOW).via,
  "od",
);
eq(
  "verdict: Director boleh memberi flag OD",
  verdictForAdd(DIR, t("Finance", "staff", true), WINDOW_CLOSED, NOW).via,
  "od",
);
eq(
  "verdict: OD tidak bergantung pada jendela",
  verdictForAdd(OD, t("BizDev", "staff"), WINDOW_CLOSED, NOW).ok,
  true,
);
eq(
  "verdict: lead + jendela terbuka + divisi sendiri = lead_window",
  verdictForAdd(LEAD, t("CreatorManagement", "staff"), OPEN, NOW).via,
  "lead_window",
);
eq(
  "verdict: lead + jendela tertutup ditolak",
  verdictForAdd(LEAD, t("CreatorManagement", "staff"), WINDOW_CLOSED, NOW).ok,
  false,
);
check(
  "verdict: penolakan jendela tertutup mengarahkan ke OD/HR",
  /OD\/HR/.test(verdictForAdd(LEAD, t("CreatorManagement", "staff"), WINDOW_CLOSED, NOW).message),
);
eq(
  "verdict: lead + divisi lain ditolak",
  verdictForAdd(LEAD, t("BizDev", "staff"), OPEN, NOW).ok,
  false,
);
eq(
  "verdict: lead + rank lead ditolak",
  verdictForAdd(LEAD, t("CreatorManagement", "lead"), OPEN, NOW).ok,
  false,
);
eq(
  "verdict: lead + flag OD ditolak",
  verdictForAdd(LEAD, t("CreatorManagement", "staff", true), OPEN, NOW).ok,
  false,
);
eq(
  "verdict: lead + flag Director ditolak",
  verdictForAdd(LEAD, t("CreatorManagement", "staff", false, true), OPEN, NOW).ok,
  false,
);
eq(
  "verdict: lead di luar daftar divisi ditolak",
  verdictForAdd(LEAD, t("CreatorManagement", "staff"), { ...OPEN, divisions: ["BizDev"] }, NOW).ok,
  false,
);
eq("verdict: staff biasa ditolak", verdictForAdd(STAFF, t("CreatorManagement", "staff"), OPEN, NOW).ok, false);
eq(
  "verdict: lead sesudah closes_at lewat ditolak",
  verdictForAdd(LEAD, t("CreatorManagement", "staff"), { ...OPEN, closes_at: earlier(1) }, NOW).ok,
  false,
);

// ===== 5. Password sementara =================================================
const stub = (n) => Uint8Array.from({ length: n }, (_, i) => i);
eq("password: bentuk deterministik dari byte stub", generateTempPassword(stub), "MEAGO-ABCD-EFGH-JKLM");
for (let i = 0; i < 200; i++) {
  const p = generateTempPassword();
  if (!/^MEAGO-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(p)) {
    check("password: pola MEAGO-XXXX-XXXX-XXXX tanpa karakter ambigu", false, p);
    break;
  }
  if (i === 199) check("password: pola MEAGO-XXXX-XXXX-XXXX tanpa karakter ambigu (200 sampel)", true);
}
check("password: lolos batas minimal 8 karakter", generateTempPassword().length >= 8);
const seen = new Set();
for (let i = 0; i < 500; i++) seen.add(generateTempPassword());
check("password: 500 sampel tanpa tabrakan", seen.size === 500, `unik ${seen.size}/500`);

// ===== 6. Konversi WIB (sumber salah geser 7 jam) ============================
eq(
  "WIB→ISO: 2026-10-01 17:00 WIB = 10:00Z",
  wibLocalInputToIso("2026-10-01T17:00"),
  "2026-10-01T10:00:00.000Z",
);
eq(
  "WIB→ISO: tengah malam WIB mundur ke hari sebelumnya",
  wibLocalInputToIso("2026-10-01T00:00"),
  "2026-09-30T17:00:00.000Z",
);
eq("WIB→ISO: input kosong → null", wibLocalInputToIso(""), null);
eq("WIB→ISO: format salah → null", wibLocalInputToIso("01/10/2026 17:00"), null);
eq("ISO→WIB: 10:00Z = 17:00 di form", isoToWibLocalInput("2026-10-01T10:00:00.000Z"), "2026-10-01T17:00");
eq("ISO→WIB: null → kosong", isoToWibLocalInput(null), "");
eq(
  "roundtrip WIB form → ISO → form",
  isoToWibLocalInput(wibLocalInputToIso("2026-12-31T23:59")),
  "2026-12-31T23:59",
);
check("formatWib menampilkan penanda WIB", /WIB$/.test(formatWib("2026-10-01T10:00:00.000Z")));
eq("formatWib: null → em dash", formatWib(null), "—");

rmSync(outDir, { recursive: true, force: true });

console.log(`\nQC employee-onboarding: ${pass} lolos, ${fail} gagal`);
if (fail > 0) {
  console.error("\nGAGAL:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
