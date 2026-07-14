"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const DIVISIONS = [
  "Marketing", "BizDev", "Finance", "Account", "Ecommerce", "Ads", "KOL", "LiveStream",
];

export type ActionResult = { ok: boolean; message: string };

export async function createEmployee(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  // Authorize: only OD or Director may add staff (matches RLS employees_manage).
  const { data: me } = await supabase
    .from("employees")
    .select("is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  if (!me || (!me.is_od && !me.is_director)) {
    return { ok: false, message: "Hanya OD/Director yang boleh menambah karyawan." };
  }

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const full_name = String(formData.get("full_name") || "").trim();
  const division = String(formData.get("division") || "");
  const rank = String(formData.get("rank") || "staff");
  const is_od = formData.get("is_od") === "on";
  const is_director = formData.get("is_director") === "on";

  if (!email || !full_name || !DIVISIONS.includes(division)) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (password.length < 8) {
    return { ok: false, message: "Password minimal 8 karakter." };
  }

  const admin = createAdminClient();
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (cErr || !created?.user) {
    return { ok: false, message: `Gagal membuat akun: ${cErr?.message ?? "unknown"}` };
  }

  const { error: iErr } = await admin.from("employees").insert({
    id: created.user.id,
    full_name,
    division,
    rank,
    is_od,
    is_director,
  });
  if (iErr) {
    // Roll back the orphan auth user so we don't leave a login with no profile.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, message: `Gagal menyimpan karyawan: ${iErr.message}` };
  }

  revalidatePath("/employees");
  return { ok: true, message: `Karyawan ${full_name} berhasil ditambahkan.` };
}
