// Project ref Supabase yang SEDANG dipakai runtime, untuk ditampilkan saat
// terjadi kesalahan konfigurasi.
//
// Kenapa perlu: satu project Vercel melayani production (branch `main`) dan
// staging (branch `staging`) — yang membedakan hanya environment variable per
// scope. Kalau var Preview tidak di-scope ke branch `staging`, deployment
// staging diam-diam membaca database PRODUCTION (lihat docs/STAGING.md §3), dan
// gejalanya cuma "tabel tidak ditemukan" tanpa petunjuk. Menampilkan ref-nya
// membuat salah-sambung itu langsung kelihatan.
//
// Ref bukan rahasia: nilainya sudah ada di setiap URL request dari browser.
// Key TIDAK pernah ditampilkan.
export function supabaseProjectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url) return "(NEXT_PUBLIC_SUPABASE_URL tidak terbaca di runtime)";
  const match = /^https?:\/\/([a-z0-9-]+)\.supabase\./i.exec(url.trim());
  return match ? match[1] : url.trim();
}

// Label yang sudah menyebutkan environment bila ref-nya dikenali.
const KNOWN_REFS: Record<string, string> = {
  mvcckptntrvzujqaoxxh: "PRODUCTION",
  vgjzvdpxrdoefoncuazw: "STAGING",
};

export function supabaseProjectLabel(): string {
  const ref = supabaseProjectRef();
  const env = KNOWN_REFS[ref];
  return env ? `${ref} (${env})` : ref;
}
