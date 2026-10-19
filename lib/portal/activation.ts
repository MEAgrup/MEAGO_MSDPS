import { createHash } from "node:crypto";
import { createAdminClient, hasAdminEnv } from "@/lib/supabase/admin";

// Validasi token aktivasi portal (migrasi 0372) — modul server biasa, BUKAN
// server action, supaya tidak bisa dipanggil langsung dari browser.

export type InviteStatus = "valid" | "expired" | "used" | "revoked" | "ineligible" | "not_found";
export type InviteCheck = {
  status: InviteStatus;
  kind?: "creator" | "merchant";
  auth_user_id?: string;
  email?: string;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function checkActivationToken(token: string): Promise<InviteCheck> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: "not_found" };
  if (!hasAdminEnv()) return { status: "not_found" };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("portal_invite_check", { p_token_hash: hashToken(token) });
  if (error || !data) return { status: "not_found" };
  return data as InviteCheck;
}
