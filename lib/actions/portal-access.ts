"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminEnv, ADMIN_ENV_MESSAGE } from "@/lib/supabase/admin";

// "Kirim Akses Portal" (migrasi 0372). Hanya prospek yang CLOSING yang boleh
// punya akun; syarat closing & wewenang ditegakkan di database:
//   1. portal_invite_precheck()  — sesi staf: wewenang + syarat closing + email/WA
//   2. service role              — buat/pakai ulang auth user (email_confirm, TANPA
//                                  email Supabase; password acak tak diketahui siapa pun)
//   3. portal_grant_access()     — sesi staf (audit actor = staf): tautkan akun +
//                                  simpan sha256 token, token lama di-revoke
// Token mentah hanya hidup di respons ini → link /aktivasi + pesan WhatsApp.

export type PortalAccessResult = {
  ok: boolean;
  message: string;
  link?: string;
  waUrl?: string | null;
  waText?: string;
  expiresAt?: string;
};

type Precheck = {
  kind: "creator" | "merchant";
  email: string;
  nama: string;
  phone: string | null;
  existing_auth_user_id: string | null;
};

const ACTIVATION_HOURS = 72;

function appBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.meago.id";
  return raw.replace(/\/+$/, "");
}

function waMessage(kind: "creator" | "merchant", nama: string, link: string): string {
  if (kind === "creator") {
    return (
      `Halo ${nama}, selamat! Akun Creator Portal MEAGO! kamu sudah aktif. ` +
      `Buat password di link ini (berlaku ${ACTIVATION_HOURS} jam): ${link}`
    );
  }
  return (
    `Yth. Bapak/Ibu PIC ${nama},\n\n` +
    `Akun Merchant Portal MEAGO! untuk ${nama} telah aktif. Melalui portal ini ` +
    `Bapak/Ibu dapat memantau status kampanye dan laporan GMV.\n\n` +
    `Silakan buat password melalui tautan berikut (berlaku ${ACTIVATION_HOURS} jam):\n${link}\n\n` +
    `Terima kasih,\nTim MEAGO!`
  );
}

export async function sendPortalAccess(
  _prev: PortalAccessResult | null,
  formData: FormData
): Promise<PortalAccessResult> {
  try {
    const kind = String(formData.get("kind") || "");
    const sourceId = String(formData.get("source_id") || "");
    if ((kind !== "creator" && kind !== "merchant") || !sourceId) {
      return { ok: false, message: "Permintaan tidak valid." };
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, message: "Tidak terautentikasi." };

    const { data: preRaw, error: preErr } = await supabase.rpc("portal_invite_precheck", {
      p_kind: kind,
      p_source_id: sourceId,
    });
    if (preErr) return { ok: false, message: preErr.message };
    const pre = preRaw as Precheck;

    if (!hasAdminEnv()) return { ok: false, message: ADMIN_ENV_MESSAGE };
    const admin = createAdminClient();

    // Akun auth: pakai yang sudah tertaut, atau yang sudah ada dengan email sama
    // (bukan karyawan), atau buat baru.
    let authUserId = pre.existing_auth_user_id;
    let createdNow = false;
    if (!authUserId) {
      const { data: found, error: lookErr } = await admin.rpc("portal_auth_user_lookup", {
        p_email: pre.email,
      });
      if (lookErr) return { ok: false, message: `Gagal memeriksa akun: ${lookErr.message}` };
      const f = (found ?? {}) as { id?: string; is_employee?: boolean };
      if (f.id && f.is_employee) {
        return { ok: false, message: "Email ini milik akun karyawan — minta prospek memakai email lain." };
      }
      if (f.id) {
        authUserId = f.id;
      } else {
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email: pre.email,
          email_confirm: true,
          password: randomBytes(32).toString("base64url"),
          user_metadata: { portal: kind },
        });
        if (cErr || !created.user) {
          return { ok: false, message: `Gagal membuat akun: ${cErr?.message ?? "tanpa respons"}` };
        }
        authUserId = created.user.id;
        createdNow = true;
      }
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");

    const { data: grant, error: gErr } = await supabase.rpc("portal_grant_access", {
      p_kind: kind,
      p_source_id: sourceId,
      p_auth_user_id: authUserId,
      p_token_hash: tokenHash,
    });
    if (gErr) {
      if (createdNow) await admin.auth.admin.deleteUser(authUserId);
      return { ok: false, message: gErr.message };
    }

    const link = `${appBaseUrl()}/aktivasi?t=${token}`;
    const text = waMessage(kind, pre.nama, link);
    const phone = (pre.phone ?? "").replace(/\D/g, "");
    revalidatePath(kind === "creator" ? "/acquisition/prospek" : "/leads");
    return {
      ok: true,
      message: "Link aktivasi siap dikirim.",
      link,
      waText: text,
      waUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null,
      expiresAt: (grant as { expires_at?: string } | null)?.expires_at,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Gagal mengirim akses." };
  }
}

export async function setMerchantPortalUserActive(
  _prev: PortalAccessResult | null,
  formData: FormData
): Promise<PortalAccessResult> {
  const supabase = await createClient();
  const id = String(formData.get("id") || "");
  const active = String(formData.get("active") || "") === "true";
  const { error } = await supabase.rpc("portal_set_merchant_user_active", {
    p_id: id,
    p_active: active,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/leads");
  return { ok: true, message: active ? "Akses merchant diaktifkan." : "Akses merchant dicabut." };
}
