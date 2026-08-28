"use client";

import { createBrowserClient } from "@supabase/ssr";
import { missingSupabasePublicEnv, supabaseEnvMessage } from "@/lib/supabase/env";

// Browser client (anon key, RLS-bound). Used by client components for auth +
// realtime. Never holds the service role key.
export function createClient() {
  const missing = missingSupabasePublicEnv();
  if (missing.length > 0) throw new Error(supabaseEnvMessage(missing));

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
