// Fase G.4 — INI LOGIKA UANG. Cermin murni (tanpa DB) dari fungsi SQL
// close_curation_batch() (migrasi 0345_go_campaign_payouts.sql) — dipakai
// untuk preview UI ("Tutup Periode akan menghasilkan N payout, total Rp X")
// SEBELUM staff menekan tombol yang benar-benar menutup batch. DB (RPC
// close_curation_batch) tetap otoritas final atas uang yang benar-benar
// dibayar — kalau logika di sini berubah, migrasi SQL yang dikutip di atas
// WAJIB disinkronkan manual (tidak ada mekanisme otomatis yang menjaga
// keduanya tetap sama).
//
// Pure — tanpa import DB/React, supaya bisa diuji tanpa infrastruktur (lihat
// scripts/test_campaign_completion.mjs, WAJIB dijalankan sebelum mengubah
// fungsi ini atau close_curation_batch()).

export type CampaignTrackForCompletion = "video" | "live" | null;

export type CompletionParticipant = {
  participantId: string;
  mcnCreatorId: string;
  status: string; // 'registered' | 'approved' | 'rejected' | 'withdrawn'
};

export type CompletionVideoSubmission = { participantId: string; isDuplicate: boolean };
export type CompletionLiveSubmission = { participantId: string };

export type CompletionResult = {
  participantId: string;
  mcnCreatorId: string;
  amount: number;
};

/**
 * "Completed" (berhak payout, keputusan #6/#8 — flat base_fee per kreator):
 *   1. participant.status === 'approved'
 *   2. Punya minimal satu bukti VALID sesuai campaign_track:
 *        - video: campaign_video_submissions dengan isDuplicate === false
 *        - live : minimal satu campaign_live_submissions (apa pun)
 *   3. BELUM ada di alreadyPaidParticipantIds (no double-pay lintas batch,
 *      keputusan #13 — cermin unique campaign_payouts.participant_id di DB).
 *
 * baseFee null/negatif -> tidak ada yang completed (campaign belum siap
 * dihitung; cermin coalesce(base_fee,0) di SQL TIDAK dipakai di sini secara
 * sengaja supaya preview UI tidak diam-diam menjanjikan Rp 0 ke kreator).
 */
export function computeCampaignCompletion(input: {
  campaignTrack: CampaignTrackForCompletion;
  baseFee: number | null;
  participants: CompletionParticipant[];
  videoSubmissions: CompletionVideoSubmission[];
  liveSubmissions: CompletionLiveSubmission[];
  alreadyPaidParticipantIds: string[];
}): CompletionResult[] {
  const { campaignTrack, baseFee, participants, videoSubmissions, liveSubmissions, alreadyPaidParticipantIds } = input;
  if (baseFee === null || !Number.isFinite(baseFee) || baseFee < 0) return [];

  const paidSet = new Set(alreadyPaidParticipantIds);
  const validVideoParticipants = new Set(
    videoSubmissions.filter((s) => !s.isDuplicate).map((s) => s.participantId)
  );
  const liveParticipants = new Set(liveSubmissions.map((s) => s.participantId));

  const results: CompletionResult[] = [];
  for (const p of participants) {
    if (p.status !== "approved") continue;
    if (paidSet.has(p.participantId)) continue;

    const hasValidProof =
      campaignTrack === "video"
        ? validVideoParticipants.has(p.participantId)
        : campaignTrack === "live"
          ? liveParticipants.has(p.participantId)
          : false;
    if (!hasValidProof) continue;

    results.push({ participantId: p.participantId, mcnCreatorId: p.mcnCreatorId, amount: baseFee });
  }
  return results;
}

export function sumCompletionAmount(results: CompletionResult[]): number {
  return results.reduce((sum, r) => sum + r.amount, 0);
}
