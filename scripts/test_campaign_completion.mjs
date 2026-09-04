// WAJIB TEST — logika uang (Fase G.4). Uji lib/campaign-completion.ts, cermin
// TS murni dari fungsi SQL close_curation_batch() (migrasi
// 0345_go_campaign_payouts.sql). Jalankan setiap kali salah satu dari
// keduanya diubah — keduanya HARUS tetap sepakat manual (tidak ada mekanisme
// otomatis yang menjaga itu).
//
// Pakai: node scripts/test_campaign_completion.mjs
//
// lib/campaign-completion.ts TypeScript — di-transpile on the fly ke CommonJS
// lewat `tsc` sekali ke direktori sementara, pola sama persis dengan
// scripts/qc_content_analysis.mjs.

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
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(detail ? `${name} — ${detail}` : name);
  }
}

function eq(name, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  check(name, same, `harap ${JSON.stringify(expected)}, dapat ${JSON.stringify(actual)}`);
}

// ---- Kompilasi lib TS yang diuji ke JS sementara ---------------------------
const outDir = mkdtempSync(join(tmpdir(), "test-campaign-completion-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      join(ROOT, "lib/campaign-completion.ts"),
      "--outDir",
      outDir,
      "--module",
      "commonjs",
      "--target",
      "es2022",
      "--moduleResolution",
      "node",
      "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
} catch (e) {
  console.error("Gagal transpile lib:", e.stdout?.toString() || e.message);
  process.exit(1);
}

const { computeCampaignCompletion, sumCompletionAmount } = require(join(outDir, "campaign-completion.js"));

const P1 = { participantId: "p1", mcnCreatorId: "c1", status: "approved" };
const P2 = { participantId: "p2", mcnCreatorId: "c2", status: "approved" };
const P3_REGISTERED = { participantId: "p3", mcnCreatorId: "c3", status: "registered" };
const P4_REJECTED = { participantId: "p4", mcnCreatorId: "c4", status: "rejected" };
const P5_WITHDRAWN = { participantId: "p5", mcnCreatorId: "c5", status: "withdrawn" };

// ===== 1. Track video: hanya bukti non-duplikat yang menghasilkan completed =====
{
  const result = computeCampaignCompletion({
    campaignTrack: "video",
    baseFee: 100000,
    participants: [P1, P2],
    videoSubmissions: [
      { participantId: "p1", isDuplicate: false },
      { participantId: "p2", isDuplicate: true }, // duplikat -> TIDAK dihitung
    ],
    liveSubmissions: [],
    alreadyPaidParticipantIds: [],
  });
  eq("video: bukti valid -> completed", result.length, 1);
  eq("video: participant yang completed adalah p1", result[0]?.participantId, "p1");
  eq("video: amount = base_fee flat (keputusan #8)", result[0]?.amount, 100000);
}

// ===== 2. Approved tanpa bukti sama sekali -> TIDAK completed ==================
{
  const result = computeCampaignCompletion({
    campaignTrack: "video",
    baseFee: 100000,
    participants: [P1],
    videoSubmissions: [],
    liveSubmissions: [],
    alreadyPaidParticipantIds: [],
  });
  eq("tanpa bukti -> 0 completed", result.length, 0);
}

// ===== 3. Status selain approved (registered/rejected/withdrawn) diabaikan ====
{
  const result = computeCampaignCompletion({
    campaignTrack: "video",
    baseFee: 100000,
    participants: [P3_REGISTERED, P4_REJECTED, P5_WITHDRAWN],
    videoSubmissions: [
      { participantId: "p3", isDuplicate: false },
      { participantId: "p4", isDuplicate: false },
      { participantId: "p5", isDuplicate: false },
    ],
    liveSubmissions: [],
    alreadyPaidParticipantIds: [],
  });
  eq("registered/rejected/withdrawn semua diabaikan meski ada bukti", result.length, 0);
}

// ===== 4. No double-pay lintas batch (keputusan #13) ===========================
{
  const result = computeCampaignCompletion({
    campaignTrack: "video",
    baseFee: 100000,
    participants: [P1, P2],
    videoSubmissions: [
      { participantId: "p1", isDuplicate: false },
      { participantId: "p2", isDuplicate: false },
    ],
    liveSubmissions: [],
    alreadyPaidParticipantIds: ["p1"], // p1 sudah dibayar batch sebelumnya
  });
  eq("p1 sudah dibayar -> dilewati, hanya p2 completed", result.length, 1);
  eq("yang completed adalah p2, bukan p1 lagi", result[0]?.participantId, "p2");
}

// ===== 5. Track live: minimal satu entri (apa pun) cukup =======================
{
  const result = computeCampaignCompletion({
    campaignTrack: "live",
    baseFee: 250000,
    participants: [P1],
    videoSubmissions: [],
    liveSubmissions: [{ participantId: "p1" }],
    alreadyPaidParticipantIds: [],
  });
  eq("live: satu entri cukup -> completed", result.length, 1);
  eq("live: amount = base_fee flat", result[0]?.amount, 250000);
}

// ===== 6. Track live TIDAK terpengaruh submission video, dan sebaliknya =======
{
  const result = computeCampaignCompletion({
    campaignTrack: "live",
    baseFee: 250000,
    participants: [P1],
    videoSubmissions: [{ participantId: "p1", isDuplicate: false }], // salah track
    liveSubmissions: [],
    alreadyPaidParticipantIds: [],
  });
  eq("live: bukti video tidak dihitung untuk track live (keputusan #18, terpisah)", result.length, 0);
}

// ===== 7. base_fee null/negatif -> TIDAK ADA yang completed (bukan Rp 0) =======
{
  const resultNull = computeCampaignCompletion({
    campaignTrack: "video",
    baseFee: null,
    participants: [P1],
    videoSubmissions: [{ participantId: "p1", isDuplicate: false }],
    liveSubmissions: [],
    alreadyPaidParticipantIds: [],
  });
  eq("base_fee null -> 0 completed (bukan payout Rp 0)", resultNull.length, 0);

  const resultNegative = computeCampaignCompletion({
    campaignTrack: "video",
    baseFee: -1,
    participants: [P1],
    videoSubmissions: [{ participantId: "p1", isDuplicate: false }],
    liveSubmissions: [],
    alreadyPaidParticipantIds: [],
  });
  eq("base_fee negatif -> 0 completed", resultNegative.length, 0);
}

// ===== 8. campaignTrack null -> tidak ada satupun yang punya bukti "sesuai" ====
{
  const result = computeCampaignCompletion({
    campaignTrack: null,
    baseFee: 100000,
    participants: [P1],
    videoSubmissions: [{ participantId: "p1", isDuplicate: false }],
    liveSubmissions: [{ participantId: "p1" }],
    alreadyPaidParticipantIds: [],
  });
  eq("campaign_track belum diisi -> 0 completed (data belum lengkap)", result.length, 0);
}

// ===== 9. sumCompletionAmount ====================================================
eq(
  "sumCompletionAmount menjumlahkan flat per kreator",
  sumCompletionAmount([
    { participantId: "p1", mcnCreatorId: "c1", amount: 100000 },
    { participantId: "p2", mcnCreatorId: "c2", amount: 100000 },
  ]),
  200000,
);
eq("sumCompletionAmount array kosong -> 0", sumCompletionAmount([]), 0);

// ---- Ringkasan --------------------------------------------------------------
rmSync(outDir, { recursive: true, force: true });

console.log(`\n${pass} lolos, ${fail} gagal.`);
if (failures.length) {
  console.log("Gagal:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
