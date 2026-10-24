"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminEnv, ADMIN_ENV_MESSAGE } from "@/lib/supabase/admin";
import { checkActivationToken, hashToken } from "@/lib/portal/activation";

// Aktivasi akun portal dari link sekali pakai (migrasi 0372). Token mentah hanya
// ada di URL; database menyimpan sha256-nya. Validasi ulang di sini (belum
// kedaluwarsa, belum dipakai, tidak di-revoke, target masih closing) sebelum
// password diset dengan service role.

export type ActivationResult = { ok: boolean; message: string };

export async function activatePortalAccount(
  _prev: ActivationResult | null,
  formData: FormData
): Promise<ActivationResult> {
  const token = String(formData.get("t") || "");
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (password.length < 8) return { ok: false, message: "Password minimal 8 karakter." };
  if (password !== confirm) return { ok: false, message: "Konfirmasi password tidak sama." };
  if (!hasAdminEnv()) return { ok: false, message: ADMIN_ENV_MESSAGE };

  let destination: string;
  try {
    const check = await checkActivationToken(token);
    if (check.status !== "valid" || !check.auth_user_id || !check.email) {
      return { ok: false, message: "Link aktivasi tidak berlaku. Hubungi tim MEAGO! untuk link baru." };
    }

    const admin = createAdminClient();
    const { error: pwErr } = await admin.auth.admin.updateUserById(check.auth_user_id, { password });
    if (pwErr) return { ok: false, message: `Gagal menyimpan password: ${pwErr.message}` };

    const { error: useErr } = await admin.rpc("portal_invite_consume", { p_token_hash: hashToken(token) });
    if (useErr) {
      return { ok: false, message: "Link aktivasi sudah tidak berlaku. Hubungi tim MEAGO! untuk link baru." };
    }

    const supabase = await createClient();
    await supabase.auth.signOut();
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: check.email, password });
    if (signErr) {
      return { ok: false, message: "Password tersimpan. Silakan masuk lewat halaman login." };
    }
    destination = check.kind === "creator" ? "/kreator/performa" : "/merchant";
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Aktivasi gagal." };
  }
  redirect(destination);
}
