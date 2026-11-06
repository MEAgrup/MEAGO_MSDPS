// QC field binding akuisisi (lib/mcn/binding-fields.ts, migrasi 0382) dan
// statistik Dashboard Akuisisi (lib/mcn/acquisition-stats.ts).
//
// Pakai: node scripts/qc_acquisition.mjs

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

const outDir = mkdtempSync(join(tmpdir(), "qc-acq-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      join(ROOT, "lib/mcn/binding-fields.ts"),
      join(ROOT, "lib/mcn/acquisition-stats.ts"),
      "--outDir", outDir, "--rootDir", join(ROOT, "lib"),
      "--module", "commonjs", "--target", "es2022", "--moduleResolution", "node", "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }
  );
} catch (e) {
  console.error("Gagal transpile:", e.stdout?.toString() || e.message);
  process.exit(1);
}
const { readBindingFields, normalizeWa } = require(join(outDir, "mcn/binding-fields.js"));
const { computeAcquisitionStats, wibYMD, crPct } = require(join(outDir, "mcn/acquisition-stats.js"));

// ---- readBindingFields --------------------------------------------------------
const form = (o) => (k) => o[k] ?? "";
const OK = {
  creator_uid: " 7012345678901234567 ",
  whatsapp: "0812-3456-7890",
  gmv_potential: "Rp 25.000.000",
  binding_end_date: "2027-11-06",
  status_kontrak: "kontrak",
  pic_cm_id: "cm-1",
};
eq("lengkap -> dinormalisasi", readBindingFields(form(OK), "2026-11-06"), {
  fields: {
    creator_uid: "7012345678901234567",
    whatsapp: "6281234567890",
    gmv_potential: 25000000,
    binding_end_date: "2027-11-06",
    status_kontrak: "kontrak",
    pic_cm_id: "cm-1",
  },
});
const WAJIB = { error: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
for (const k of Object.keys(OK)) {
  eq(`kosong ${k} ditolak`, readBindingFields(form({ ...OK, [k]: "  " }), "2026-11-06"), WAJIB);
}
eq("UID huruf ditolak", readBindingFields(form({ ...OK, creator_uid: "@kreator" }), "2026-11-06"), {
  error: "[UID TikTok harus berupa angka]",
});
eq("WA kependekan ditolak", readBindingFields(form({ ...OK, whatsapp: "0812" }), "2026-11-06"), {
  error: "[nomor WhatsApp tidak valid]",
});
eq("GMV ambigu ditolak", readBindingFields(form({ ...OK, gmv_potential: "12.5" }), "2026-11-06"), {
  error: "[GMV Potential tidak valid]",
});
eq("GMV negatif ditolak", readBindingFields(form({ ...OK, gmv_potential: "-5000" }), "2026-11-06"), {
  error: "[GMV Potential tidak valid]",
});
eq("GMV 0 diterima", readBindingFields(form({ ...OK, gmv_potential: "0" }), "2026-11-06").fields?.gmv_potential, 0);
eq("tgl akhir invalid", readBindingFields(form({ ...OK, binding_end_date: "2027-02-30" }), "2026-11-06"), {
  error: "[tanggal binding akhir tidak valid]",
});
eq("tgl akhir < binding", readBindingFields(form({ ...OK, binding_end_date: "2026-11-05" }), "2026-11-06"), {
  error: "[tanggal binding akhir tidak boleh sebelum tanggal binding]",
});
eq("tgl akhir = binding OK", "fields" in readBindingFields(form({ ...OK, binding_end_date: "2026-11-06" }), "2026-11-06"), true);
eq("jenis kontrak asing", readBindingFields(form({ ...OK, status_kontrak: "eksklusif" }), "2026-11-06"), {
  error: "[jenis kontrak tidak dikenali]",
});
eq("normalizeWa +62", normalizeWa("+62 812 3456 7890"), "6281234567890");
eq("normalizeWa 8xx", normalizeWa("81234567890"), "6281234567890");
eq("normalizeWa kosong", normalizeWa("--"), null);

// ---- wibYMD / crPct -------------------------------------------------------------
eq("wib: 17:00Z = besok WIB", wibYMD("2026-10-31T17:00:00Z"), "2026-11-01");
eq("wib: 16:59Z = hari sama", wibYMD("2026-10-31T16:59:59+00:00"), "2026-10-31");
eq("cr 0 scouting -> null", crPct(3, 0), null);
eq("cr 1/3", crPct(1, 3), 33.3);

// ---- computeAcquisitionStats ----------------------------------------------------
const base = {
  acqStaffIds: ["siti", "budi"],
  from: "2026-11-01",
  to: "2026-11-30",
  prospects: [
    { owner_id: "siti", created_at: "2026-11-02T03:00:00Z", matched_mcn_creator_id: "c-linked" },
    { owner_id: "siti", created_at: "2026-11-03T03:00:00Z", matched_mcn_creator_id: null },
    { owner_id: null, created_at: "2026-11-04T03:00:00Z", matched_mcn_creator_id: null },
    { owner_id: "budi", created_at: "2026-10-31T16:00:00Z", matched_mcn_creator_id: null }, // 23:00 WIB 31 Okt -> di luar
  ],
  creators: [
    { id: "c-linked", created_by: "siti", created_at: "2026-11-02T04:00:00Z" }, // tertaut prospek -> tidak dobel
    { id: "c-manual", created_by: "budi", created_at: "2026-11-05T04:00:00Z" },
    { id: "c-old-link", created_by: "budi", created_at: "2026-11-06T04:00:00Z" }, // tertaut prospek lama
    { id: "c-cm", created_by: "cm-x", created_at: "2026-11-05T04:00:00Z" }, // bukan staf Acquisition
  ],
  linkedCreatorIds: ["c-old-link"],
  acquisitions: [
    { specialist_id: "siti", binding_date: "2026-11-10", lead_source: "inbound", gmv_potential: 10_000_000, gmv_post_join: 4_000_000 },
    { specialist_id: "budi", binding_date: "2026-11-11", lead_source: "outbound", gmv_potential: 5_000_000, gmv_post_join: null },
    { specialist_id: "budi", binding_date: "2026-12-01", lead_source: "outbound", gmv_potential: 9, gmv_post_join: 9 }, // luar periode
  ],
};
const r = computeAcquisitionStats(base);
eq("tim", r.team, { id: "team", scouting: 4, binding: 2, cr: 50, gmv_actual: 4_000_000, gmv_potential: 15_000_000 });
eq(
  "per individu (urut binding lalu scouting, baris tanpa PIC tampil)",
  r.people.map((p) => [p.id, p.scouting, p.binding, p.cr]),
  [["siti", 2, 1, 50], ["budi", 1, 1, 100], ["", 1, 0, 0]]
);
const rs = computeAcquisitionStats({ ...base, specialist: "siti" });
eq("filter individu", [rs.team.scouting, rs.team.binding, rs.people.length], [2, 1, 1]);
const rl = computeAcquisitionStats({ ...base, leadSource: "inbound" });
eq("filter sumber hanya ke binding", [rl.team.scouting, rl.team.binding, rl.team.gmv_potential], [4, 1, 10_000_000]);
const empty = computeAcquisitionStats({ ...base, prospects: [], creators: [], acquisitions: [] });
eq("kosong: staf tetap tampil, tanpa baris PIC kosong", empty.people.map((p) => p.id), ["budi", "siti"]);
eq("kosong: CR null", empty.team.cr, null);

rmSync(outDir, { recursive: true, force: true });
if (fail) {
  console.error(`GAGAL ${fail} / ${pass + fail}`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`LULUS ${pass} / ${pass}`);
