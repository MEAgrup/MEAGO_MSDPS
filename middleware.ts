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

  // Without Supabase env vars the client can't be built. Rather than throwing
  // (which surfaces as MIDDLEWARE_INVOCATION_FAILED / a hard 500 on every
  // route), pass the request through so the deployment stays reachable and the
  // misconfiguration is visible in logs instead of a blank error page.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      "[middleware] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — skipping auth gate. Set these in Vercel → Settings → Environment Variables."
    );
    return response;
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

  if (!user && !isAuthRoute) {
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
    // `api/` dikecualikan: route di bawahnya (mis. `/api/internal/bridge/deliver`)
    // punya gerbang secret sendiri (`deliverSecretOk`, dipanggil Vercel Cron
    // TANPA cookie sesi) — kalau tidak dikecualikan, middleware ini menganggap
    // setiap panggilan cron "belum login" dan me-redirect 307 ke /login SEBELUM
    // route sempat mengecek secret-nya sendiri. Bug ini yang membuat delivery
    // tick Bridge MSDPS→CDPS tidak pernah benar-benar jalan sejak dibangun —
    // ditemukan lewat runtime log Vercel (cron 200-sukses vs 307 nyata).
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
