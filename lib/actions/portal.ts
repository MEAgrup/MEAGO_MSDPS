"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseRupiah } from "@/lib/mcn/parsers";
import {
  PORTAL_REQUEST_TYPES,
  MERCHANT_TARGET_TYPES,
  NOMINAL_TYPES,
  type PortalRequestType,
} from "@/lib/mcn/request-types";

export type ActionResult = { ok: boolean; message: string };

// ---- Sisi kreator ----------------------------------------------------------

// createPortalRequest — kreator mengajukan request MEA GO dari portal /kreator.
// Identitas kreator diresolusi dari sesi (auth_user_id = auth.uid()) pakai client
// biasa (RLS creator-self). needs_approval TIDAK diset di sini: trigger DB 0311
// yang memaksa gate cap untuk ads_live (kreator tak bisa menyetel via API).
export async function createPortalRequest(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const { data: creator } = await supabase
    .from("mcn_creators")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!creator) return { ok: false, message: "Akun ini bukan kreator portal." };

  const type = String(formData.get("type") || "");
  if (!PORTAL_REQUEST_TYPES.includes(type as PortalRequestType)) {
    return { ok: false, message: "Jenis request tidak dikenali." };
  }

  const detail = String(formData.get("detail") || "").trim() || null;

  // Field target merchant / brand hanya untuk free_meal & visit.
  let target_merchant_id: string | null = null;
  let target_brand: string | null = null;
  if (type in MERCHANT_TARGET_TYPES) {
    const merchantId = String(formData.get("target_merchant_id") || "").trim();
    const brandText = String(formData.get("target_brand") || "").trim();
    if (merchantId && merchantId !== "__other__") {
      target_merchant_id = merchantId;
    } else {
      target_brand = brandText || null;
    }
    if (!target_merchant_id && !target_brand) {
      return {
        ok: false,
        message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]",
      };
    }
  }

  // Field nominal (rupiah) hanya untuk ads_live & special_price_live.
  let nominal: number | null = null;
  if (NOMINAL_TYPES.includes(type)) {
    const nominalRaw = String(formData.get("nominal") || "").trim();
    if (nominalRaw !== "") {
      nominal = parseRupiah(nominalRaw);
      if (nominal === null) {
        return { ok: false, message: "Nominal tidak dikenali — periksa formatnya." };
      }
    }
  }

  const { error } = await supabase.from("creator_requests").insert({
    mcn_creator_id: creator.id,
    type,
    target_merchant_id,
    target_brand,
    nominal,
    detail,
  });
  if (error) return { ok: false, message: `Gagal mengajukan request: ${error.message}` };

  revalidatePath("/kreator/request");
  return { ok: true, message: "Request diajukan — akan diproses tim BizDev." };
}

// ---- Sisi admin: akun portal kreator ---------------------------------------

async function adminCtx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, me: null };
  const { data: me } = await supabase
    .from("employees")
    .select("id, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  return { supabase, user, me };
}

// CM Lead atau management (OD/Director) — sama dgn gate assign owner di mcn-creators.
function isCmLeadOrMgmt(me: {
  division: string;
  rank: string;
  is_od: boolean;
  is_director: boolean;
} | null): boolean {
  if (!me) return false;
  return (
    me.is_od ||
    me.is_director ||
    (me.division === "CreatorManagement" && me.rank === "lead")
  );
}

// createCreatorAccount — buat akun login portal untuk kreator (tidak ada pendaftaran
// mandiri). Gate CM Lead / OD / Director. Pakai service-role (createAdminClient) untuk
// auth.admin.createUser + set mcn_creators.auth_user_id. Menangani email duplikat.
export async function createCreatorAccount(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await adminCtx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!isCmLeadOrMgmt(me)) {
    return { ok: false, message: "Hanya CM Lead atau management yang dapat membuat akun portal." };
  }

  const creator_id = String(formData.get("creator_id") || "");
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  if (!creator_id || !email || !password) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (password.length < 8) {
    return { ok: false, message: "Password minimal 8 karakter." };
  }

  // Pastikan kreator belum punya akun (baca via client biasa — RLS karyawan boleh baca).
  const { data: creator, error: cErr } = await supabase
    .from("mcn_creators")
    .select("id, name, auth_user_id")
    .eq("id", creator_id)
    .maybeSingle();
  if (cErr) return { ok: false, message: `Gagal membaca kreator: ${cErr.message}` };
  if (!creator) return { ok: false, message: "Kreator tidak ditemukan." };
  if (creator.auth_user_id) {
    return { ok: false, message: "Kreator ini sudah memiliki akun portal." };
  }

  const admin = createAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "gagal membuat user";
    if (/already|registered|exist/i.test(msg)) {
      return { ok: false, message: `Email "${email}" sudah terpakai oleh akun lain.` };
    }
    return { ok: false, message: `Gagal membuat akun: ${msg}` };
  }

  // Guard balapan: hanya kaitkan bila kreator masih tanpa akun (dua admin paralel).
  const { data: linkedRows, error: linkErr } = await admin
    .from("mcn_creators")
    .update({ auth_user_id: created.user.id })
    .eq("id", creator_id)
    .is("auth_user_id", null)
    .select("id");
  if (!linkErr && (linkedRows ?? []).length === 0) {
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: "Kreator ini baru saja dikaitkan ke akun lain — muat ulang halaman." };
  }
  if (linkErr) {
    // Rollback auth user agar tidak ada akun yatim tanpa kaitan kreator.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: `Gagal mengaitkan akun: ${linkErr.message}` };
  }

  revalidatePath("/meago/creators");
  return { ok: true, message: `Akun portal untuk "${creator.name}" dibuat (${email}).` };
}
