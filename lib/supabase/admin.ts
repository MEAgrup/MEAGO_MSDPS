import { createClient } from "@supabase/supabase-js";
import { missingSupabaseAdminEnv, supabaseEnvMessage } from "@/lib/supabase/env";

// SERVICE-ROLE client. Bypasses RLS (NOT triggers). Server-only — only import
// this from Server Actions / route handlers, never from a client component.
// Used for privileged ops the API can't do under RLS, e.g. creating auth users.
export function createAdminClient() {
  const missing = missingSupabaseAdminEnv();
  if (missing.length > 0) throw new Error(supabaseEnvMessage(missing));

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
