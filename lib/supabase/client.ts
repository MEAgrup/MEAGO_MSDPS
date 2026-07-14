"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client (anon key, RLS-bound). Used by client components for auth +
// realtime. Never holds the service role key.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
