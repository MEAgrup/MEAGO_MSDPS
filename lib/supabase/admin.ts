import { createClient } from "@supabase/supabase-js";

// Pesan tunggal untuk env service-role yang belum lengkap. Dipakai server action
// supaya user melihat penyebab konkret, bukan layar 500 tanpa konteks.
export const ADMIN_ENV_MESSAGE =
  "Konfigurasi server belum lengkap: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY " +
  "belum terpasang di environment. Isi di Vercel → Settings → Environment Variables " +
  "(scope Production), lalu redeploy.";

// True bila kedua env service-role tersedia. Server action memakai ini sebagai
// preflight agar bisa mengembalikan ActionResult, bukan melempar.
export function hasAdminEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// SERVICE-ROLE client. Bypasses RLS (NOT triggers). Server-only — only import
// this from Server Actions / route handlers, never from a client component.
// Used for privileged ops the API can't do under RLS, e.g. creating auth users.
//
// Bila env belum diset, supabase-js melempar "supabaseKey is required." — pesan
// yang tidak berarti apa-apa untuk user dan muncul sebagai 500. Kita lempar
// pesan yang bisa ditindaklanjuti; pemanggil wajib menangkapnya.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(ADMIN_ENV_MESSAGE);
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
