// Kategori GMV CM Workspace (permintaan Rizal, ACC Yohan 2026-11-06). Sumbernya export
// Creator Analysis TikTok yang SUDAH difilter per kategori di dashboard TikTok; CM memilih
// kategorinya di form upload (export tidak membawa kolom kategori, jadi sistem tidak menebak).
//
// "all" = jalur lama (creator_period_summary) — tidak berubah. Kategori lain disimpan di
// creator_period_category_summary (migrasi 0383) supaya angka Growth/perf_drop/portal yang
// membaca creator_period_summary tidak tercampur data parsial per kategori.
// Pure, tanpa DB/React — dipakai server action, halaman, dan QC script.

export const GMV_CATEGORIES = [
  { key: "all", label: "All" },
  { key: "dining", label: "Dining" },
  { key: "accommodation", label: "Accommodation" },
  { key: "ttd", label: "Things to Do (TTD)" },
  { key: "live", label: "LIVE" },
] as const;

export type GmvCategory = (typeof GMV_CATEGORIES)[number]["key"];
// Kategori selain "all" — nilai yang boleh masuk creator_period_category_summary.category.
export type GmvSubCategory = Exclude<GmvCategory, "all">;

const KEYS = new Set<string>(GMV_CATEGORIES.map((c) => c.key));

// Nilai form/query → key kanonik. Kosong → "all" (default jalur lama); tak dikenal → null
// (caller menolak, bukan diam-diam dianggap "all").
export function parseGmvCategory(raw: string | null | undefined): GmvCategory | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return "all";
  return KEYS.has(v) ? (v as GmvCategory) : null;
}

export function gmvCategoryLabel(key: string): string {
  return GMV_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

// Search kreator CM Workspace: cocok bila q ada di username, nama, atau kode (case-
// insensitive). "@" di depan diabaikan supaya "@heylend" = "heylend". q kosong → semua.
export function matchesCreatorSearch(
  c: { name: string | null; code: string | null; username: string | null },
  q: string | null | undefined
): boolean {
  const needle = (q ?? "").trim().toLowerCase().replace(/^@+/, "");
  if (needle === "") return true;
  return [c.username, c.name, c.code].some((v) =>
    (v ?? "").toLowerCase().replace(/^@+/, "").includes(needle)
  );
}

// Total GMV satu kategori untuk sekumpulan baris (banyak kreator × minggu). Dedupe per
// (kreator, period_start) — created_at terbaru menang — lalu dijumlah. null bila tidak ada
// satu pun nilai (null ≠ 0: kategori belum diunggah beda dengan GMV nol).
export function sumCategoryGmv(
  rows: { mcn_creator_id: string; period_start: string; created_at: string; affiliate_gmv: number | null }[]
): number | null {
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.mcn_creator_id}|${r.period_start}`;
    const ex = latest.get(k);
    if (!ex || r.created_at > ex.created_at) latest.set(k, r);
  }
  let sum = 0;
  let has = false;
  for (const r of latest.values()) {
    if (r.affiliate_gmv === null || r.affiliate_gmv === undefined) continue;
    sum += Number(r.affiliate_gmv);
    has = true;
  }
  return has ? sum : null;
}
