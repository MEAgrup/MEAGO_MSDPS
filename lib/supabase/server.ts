import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Per-request server client bound to the user's session cookie. RLS applies.
// Use this for all normal reads/writes from Server Components and Server Actions.
export async function createClient() {
  const cookieStore = await cookies();
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
    .select("id, full_name, division, rank, is_od, is_director, must_change_password")
    .eq("id", user.id)
    .maybeSingle();
  return data;
});

// Closing kreator = binding agency TikTok GO lewat MEAGO! (migrasi 0373). Akses
// Creator Portal hanya untuk binding_status ini — di RLS (auth_creator_id) DAN di app.
export const BOUND_CREATORS = "Bound creators";

// Akun yang tertaut ke mcn_creators, apa pun binding-nya — untuk membedakan
// "kreator yang aksesnya nonaktif" dari "bukan kreator".
export const getCreatorAccount = cache(async () => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await getCachedClient();
  const { data } = await supabase
    .from("mcn_creators")
    .select("id, code, name, binding_status")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return data;
});

// Kreator dengan akses portal aktif (Bound). Dipakai semua halaman portal.
export const getCreator = cache(async () => {
  const account = await getCreatorAccount();
  if (!account || account.binding_status !== BOUND_CREATORS) return null;
  return { id: account.id, code: account.code, name: account.name };
});

// Merchant Portal (migrasi 0372/0374): lead milik akun ini yang aksesnya aktif
// dan masih closing. Kosong = tidak punya akses.
export const getMerchantPortal = cache(async () => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await getCachedClient();
  const { data } = await supabase.rpc("merchant_portal_me");
  const brands =
    (data as
      | { lead_id: string; lead_code: string | null; brand_name: string; brand_category: string | null; wilayah: string | null }[]
      | null) ?? [];
  return brands.length ? brands : null;
});

// Akun merchant yang pernah dibuat (aktif atau dicabut) — untuk pesan "akses nonaktif".
export const hasMerchantAccount = cache(async () => {
  const user = await getSessionUser();
  if (!user) return false;
  const supabase = await getCachedClient();
  const { data } = await supabase
    .from("merchant_portal_users")
    .select("id")
    .eq("auth_user_id", user.id)
    .limit(1);
  return (data ?? []).length > 0;
});
