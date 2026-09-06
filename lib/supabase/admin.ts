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
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
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
  // trim(): spasi/newline sering kebawa saat key di-paste ke dashboard Vercel.
  // Tanpa ini Supabase menolak key yang sebetulnya benar dengan 401.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error(ADMIN_ENV_MESSAGE);
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---- Diagnosa env (tanpa membocorkan nilai key) -----------------------------
//
// Kegagalan pembuatan akun di production nyaris selalu soal env, dan bedanya
// tidak terlihat dari pesan Supabase: env tidak ke-scope Production, nilainya
// tertukar dengan anon key, atau kebawa spasi/newline saat paste. Fungsi ini
// merangkum bentuk key — panjang, prefix, dan klaim `role` bila key berupa JWT
// legacy — supaya penyebabnya kelihatan tanpa pernah menampilkan key-nya.

export type AdminKeyInfo = {
  urlPresent: boolean;
  url: string | null;
  keyPresent: boolean;
  length: number;
  prefix: string;
  format: "jwt" | "secret" | "publishable" | "unknown" | "none";
  role: string | null;
  projectRef: string | null;
  hasWhitespace: boolean;
};

// Payload JWT legacy Supabase memuat { role, ref }. Bukan rahasia (key-nya
// sendiri tidak pernah dikembalikan) — hanya dipakai untuk membedakan
// service_role vs anon.
function decodeJwtClaims(token: string): { role: string | null; ref: string | null } {
  try {
    const payload = token.split(".")[1];
    if (!payload) return { role: null, ref: null };
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return {
      role: typeof json?.role === "string" ? json.role : null,
      ref: typeof json?.ref === "string" ? json.ref : null,
    };
  } catch {
    return { role: null, ref: null };
  }
}

export function describeAdminKey(): AdminKeyInfo {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) {
    return {
      urlPresent: Boolean(url),
      url,
      keyPresent: false,
      length: 0,
      prefix: "",
      format: "none",
      role: null,
      projectRef: null,
      hasWhitespace: false,
    };
  }
  const trimmed = raw.trim();
  const format: AdminKeyInfo["format"] = trimmed.startsWith("eyJ")
    ? "jwt"
    : trimmed.startsWith("sb_secret_")
      ? "secret"
      : trimmed.startsWith("sb_publishable_")
        ? "publishable"
        : "unknown";
  const claims = format === "jwt" ? decodeJwtClaims(trimmed) : { role: null, ref: null };
  return {
    urlPresent: Boolean(url),
    url,
    keyPresent: true,
    length: raw.length,
    prefix: trimmed.slice(0, 10),
    format,
    role: claims.role,
    projectRef: claims.ref,
    hasWhitespace: raw !== trimmed,
  };
}

// Ringkasan satu-dua kalimat untuk ditempel ke pesan error / panel diagnosa.
// Mengembalikan null bila tidak ada yang mencurigakan dari bentuk key.
export function adminKeyWarning(info: AdminKeyInfo = describeAdminKey()): string | null {
  if (!info.urlPresent) {
    return "NEXT_PUBLIC_SUPABASE_URL tidak terbaca di runtime ini.";
  }
  if (!info.keyPresent) {
    return "SUPABASE_SERVICE_ROLE_KEY tidak terbaca di runtime ini — kemungkinan besar env-nya belum ter-scope ke Production, atau deployment yang jalan dibuat sebelum env itu ditambahkan (env baru hanya berlaku setelah redeploy).";
  }
  if (info.format === "publishable") {
    return "SUPABASE_SERVICE_ROLE_KEY berisi publishable key (sb_publishable_…), bukan secret key. Ambil `service_role` di Supabase → Settings → API.";
  }
  if (info.format === "jwt" && info.role && info.role !== "service_role") {
    return `SUPABASE_SERVICE_ROLE_KEY berisi key dengan role "${info.role}", bukan "service_role" — kemungkinan tertukar dengan anon key. Ambil \`service_role\` di Supabase → Settings → API.`;
  }
  if (info.format === "unknown") {
    return "SUPABASE_SERVICE_ROLE_KEY tidak berbentuk key Supabase yang dikenal (bukan JWT `eyJ…` maupun `sb_secret_…`). Periksa nilainya.";
  }
  if (info.hasWhitespace) {
    // Sudah ditangani createAdminClient() lewat trim() — informasi saja.
    return "SUPABASE_SERVICE_ROLE_KEY kebawa spasi/newline saat paste (sudah dipangkas otomatis, tapi sebaiknya dirapikan di Vercel).";
  }
  return null;
}
