// Cek kelengkapan environment variable Supabase — dipakai SEBELUM membuat client
// mana pun, supaya salah konfigurasi muncul sebagai pesan yang bisa dikerjakan,
// bukan 500 tanpa keterangan.
//
// Kenapa perlu (kejadian 2026-08-28): deployment Preview branch `staging`
// kehilangan ketiga var Supabase. `middleware.ts` sengaja meloloskan request saat
// var-nya hilang (biar deployment tetap terbuka, bukan MIDDLEWARE_INVOCATION_FAILED),
// tapi Server Component berikutnya tetap memanggil `createServerClient(undefined!)`
// dan melempar `supabaseUrl is required.` — di build production pesan itu
// disembunyikan Next, jadi user cuma melihat "An error occurred in the Server
// Components render" + digest. Tidak ada satu pun request ke Supabase, sehingga
// log Supabase pun kosong dan penyebabnya tak terlihat dari mana-mana.
//
// PENTING: var `NEXT_PUBLIC_*` di-inline Next saat BUILD, bukan dibaca saat
// request. Menambah/mengubahnya di Vercel TIDAK berlaku untuk deployment yang
// sudah jadi — wajib Redeploy. Itu sebabnya pesan di bawah selalu menyebut hal ini.

// Var yang dibutuhkan setiap request (client browser + server client ber-RLS).
export const SUPABASE_PUBLIC_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

// Var tambahan yang hanya dibutuhkan client service-role (server-only).
export const SUPABASE_ADMIN_ENV = ["SUPABASE_SERVICE_ROLE_KEY"] as const;

// Referensi process.env ditulis statis (bukan process.env[nama]) supaya inlining
// Next tetap bekerja.
export function missingSupabasePublicEnv(): string[] {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return missing;
}

export function missingSupabaseAdminEnv(): string[] {
  const missing = missingSupabasePublicEnv();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}

// Pesan satu baris untuk log Vercel & error server action. Nilai var TIDAK pernah
// ikut dicetak — hanya namanya.
export function supabaseEnvMessage(missing: string[]): string {
  return (
    `Konfigurasi Supabase belum lengkap di deployment ini: ${missing.join(", ")} ` +
    `tidak terbaca. Isi di Vercel → Settings → Environment Variables (scope-kan ke ` +
    `branch yang benar, lihat docs/STAGING.md §3) lalu REDEPLOY — variabel ` +
    `NEXT_PUBLIC_* di-inline saat build, jadi tidak berlaku untuk deployment yang sudah jadi.`
  );
}
