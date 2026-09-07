// Wewenang Campaign MEA GO (Fase G) di sisi aplikasi.
//
// SATU sumber kebenaran untuk semua halaman & server action campaign. Cermin
// persis fungsi SQL `is_campaign_owner()` / `is_campaign_staff()` (migrasi
// 0358) — kalau salah satu diubah, ubah keduanya. Yang di sini hanya
// menentukan apa yang dirender/di-redirect; gerbang sesungguhnya tetap RLS +
// trigger di Postgres, karena PostgREST mengekspos tabelnya langsung.
//
// Koreksi PRD 2026-09-07 (docs/HANDOFF_FaseG.md §5a): Fase G mengasumsikan
// "Campaign Specialist" divisi tersendiri, padahal di production tidak ada
// satu pun karyawan berdivisi `CampaignSpecialist` — Campaign Specialist
// bekerja di bawah **SPV Creator Management**. Karena itu CreatorManagement
// rank `lead` masuk sebagai pemilik campaign, sejajar BizDev. Enum
// `CampaignSpecialist` tetap dipertahankan kalau nanti divisi itu benar-benar
// diisi orang.

export type CampaignActor = {
  division?: string | null;
  rank?: string | null;
  is_od?: boolean | null;
  is_director?: boolean | null;
} | null;

// Pemilik campaign — boleh membuat campaign, mengubah budget & stage, dan
// mengelola realisasi ads spend. CreatorManagement HANYA pada rank 'lead'
// (SPV); CM staff tidak termasuk.
export function isCampaignOwner(me: CampaignActor): boolean {
  if (!me) return false;
  if (me.is_od || me.is_director) return true;
  if (me.division === "BizDev" || me.division === "CampaignSpecialist") return true;
  return me.division === "CreatorManagement" && me.rank === "lead";
}

// Tim operasional campaign — pemilik + AM (Account). Dipakai untuk akses
// halaman, kurasi pendaftar, batch kurasi, ingest export TikTok, dan validasi
// bukti. Account dibatasi PER BARIS (operational_owner_id) oleh RLS, bukan di
// sini: action tetap dipanggil, DB yang menolak baris milik AM lain.
export function isCampaignStaff(me: CampaignActor): boolean {
  return isCampaignOwner(me) || (!!me && me.division === "Account");
}
