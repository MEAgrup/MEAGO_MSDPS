"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: boolean; message: string };

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// Ganti password (karyawan & kreator). Supabase updateUser() tidak memeriksa
// password lama, jadi verifikasi dilakukan manual via signInWithPassword.
export async function changePassword(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return { ok: false, message: "Tidak terautentikasi." };

  const current_password = String(formData.get("current_password") || "");
  const new_password = String(formData.get("new_password") || "");
  const confirm_password = String(formData.get("confirm_password") || "");

  if (!current_password || !new_password || !confirm_password) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (new_password.length < 8) {
    return { ok: false, message: "Password baru minimal 8 karakter." };
  }
  if (new_password !== confirm_password) {
    return { ok: false, message: "Konfirmasi password tidak cocok." };
  }
  if (new_password === current_password) {
    return { ok: false, message: "Password baru harus berbeda dari password saat ini." };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current_password,
  });
  if (signInError) return { ok: false, message: "Password saat ini salah." };

  const { error } = await supabase.auth.updateUser({ password: new_password });
  if (error) return { ok: false, message: `Gagal mengganti password: ${error.message}` };

  return { ok: true, message: "Password berhasil diganti." };
}
