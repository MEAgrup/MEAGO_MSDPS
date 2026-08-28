import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { missingSupabasePublicEnv, supabaseEnvMessage } from "@/lib/supabase/env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Per-request server client bound to the user's session cookie. RLS applies.
// Use this for all normal reads/writes from Server Components and Server Actions.
export async function createClient() {
  // cookies() DULU: itu yang menandai route sebagai dinamis. Kalau guard env di
  // bawah dijalankan lebih dulu, route tanpa penanda dinamis akan dicoba
  // di-prerender saat build dan build-nya gagal — padahal yang kita mau adalah
  // deployment tetap jadi dan menampilkan halaman /konfigurasi.
  const cookieStore = await cookies();

  // Tanpa guard ini createServerClient(undefined) melempar "supabaseUrl is
  // required." — pesan yang disembunyikan build production, jadi user hanya
  // melihat digest. Pesan di bawah ikut tercetak di log Vercel. Jalur normalnya
  // sudah dicegat middleware; ini jaring pengaman untuk server action.
  const missing = missingSupabasePublicEnv();
  if (missing.length > 0) throw new Error(supabaseEnvMessage(missing));

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore; middleware refreshes.
          }
        },
      },
    }
  );
}

// Request-level dedupe helpers: React cache() collapses these to one call per
// request, so layout and page share the same client/session/profile lookups.
export const getCachedClient = cache(createClient);

export const getSessionUser = cache(async () => {
  const supabase = await getCachedClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

export const getEmployee = cache(async () => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await getCachedClient();
  const { data } = await supabase
    .from("employees")
    .select("id, full_name, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  return data;
});

export const getCreator = cache(async () => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await getCachedClient();
  const { data } = await supabase
    .from("mcn_creators")
    .select("id, code, name")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return data;
});
