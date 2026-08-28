import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Refreshes the Supabase session on every request and gates access:
// unauthenticated users are sent to /login. Logged-in users landing on /login are
// routed by identity (employee → /dashboard, kreator → /kreator/performa) via ONE
// lightweight query scoped to that path only — every other route stays DB-free, with
// employee/kreator cross-blocking enforced in the (app) and (kreator) layouts.
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase env vars the client can't be built. Throwing here surfaces
  // as MIDDLEWARE_INVOCATION_FAILED (hard 500 on every route), but simply
  // passing the request through is no better: the next Server Component calls
  // createServerClient(undefined) and throws "supabaseUrl is required.", and a
  // production build hides that message — the user only ever sees "An error
  // occurred in the Server Components render" plus a digest, with NO request
  // reaching Supabase, so the logs on both sides are empty too (kejadian
  // 2026-08-28 di URL staging). Rewrite to /konfigurasi instead: satu halaman
  // statis yang tidak menyentuh Supabase dan menyebut variabel mana yang hilang.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "[middleware] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — serving /konfigurasi. Set these in Vercel → Settings → Environment Variables, then redeploy."
    );
    if (request.nextUrl.pathname === "/konfigurasi") return response;
    const url = request.nextUrl.clone();
    url.pathname = "/konfigurasi";
    return NextResponse.rewrite(url);
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (err) {
    // A transient Supabase/network failure should not take the whole site down.
    console.error("[middleware] supabase.auth.getUser() failed:", err);
    return response;
  }

  const path = request.nextUrl.pathname;
  const isAuthRoute = path === "/login";
  // /konfigurasi tetap terbuka tanpa login: halaman diagnosa yang menyebut
  // project Supabase mana yang dibaca deployment ini (ref bukan rahasia — sudah
  // ada di setiap URL request; key tidak pernah ditampilkan). Justru saat sesi
  // tidak bisa terbentuk halaman itulah yang perlu dibuka.
  const isPublicRoute = isAuthRoute || path === "/konfigurasi";

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isAuthRoute) {
    // Route by identity. Employees resolve via employees.id = auth.uid(); a kreator
    // sees no employee row (RLS is_employee() gate) but resolves via mcn_creators.
    const url = request.nextUrl.clone();
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    if (emp) {
      url.pathname = "/dashboard";
      return NextResponse.redirect(url);
    }
    const { data: creator } = await supabase
      .from("mcn_creators")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    url.pathname = creator ? "/kreator/performa" : "/dashboard";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
