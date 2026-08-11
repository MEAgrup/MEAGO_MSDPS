"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminEnv, ADMIN_ENV_MESSAGE } from "@/lib/supabase/admin";
import { isDivision } from "@/lib/divisions";

export type ActionResult = { ok: boolean; message: string };

const RANKS = ["staff", "lead"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Terjemahkan kegagalan auth.admin.createUser jadi pesan yang bisa ditindaklanjuti.
// Tanpa ini user hanya melihat teks mentah GoTrue (atau, dulu, layar 500 kosong).
function createUserMessage(email: string, message: string, status?: number): string {
  if (/already|registered|exist|duplicate/i.test(message)) {
    return `Email "${email}" sudah terpakai oleh akun lain.`;
  }
  if (status === 401 || status === 403) {
    return "Supabase menolak service-role key (401/403). Periksa nilai SUPABASE_SERVICE_ROLE_KEY di environment — kemungkinan salah salin atau sudah dirotasi.";
  }
  if (/weak|password/i.test(message)) {
    return `Password ditolak Supabase: ${message}`;
  }
  return `Gagal membuat akun login: ${message}`;
}

export async function createEmployee(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  // Server action tidak boleh melempar: exception apa pun di sini akan sampai ke
  // user sebagai "internal server error" tanpa keterangan. Semua jalur keluar
  // lewat ActionResult.
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, message: "Tidak terautentikasi." };

    // Authorize: only OD or Director may add staff (matches RLS employees_manage).
    const { data: me, error: meErr } = await supabase
      .from("employees")
      .select("is_od, is_director")
      .eq("id", user.id)
      .maybeSingle();
    if (meErr) {
      return { ok: false, message: `Gagal membaca profil Anda: ${meErr.message}` };
    }
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

    if (!email || !full_name || !division) {
      return {
        ok: false,
        message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]",
      };
    }
    if (!EMAIL_RE.test(email)) {
      return { ok: false, message: "Format email tidak valid." };
    }
    if (!isDivision(division)) {
      return { ok: false, message: `Divisi "${division}" tidak dikenali.` };
    }
    if (!RANKS.includes(rank)) {
      return { ok: false, message: `Level "${rank}" tidak dikenali.` };
    }
    if (password.length < 8) {
      return { ok: false, message: "Password minimal 8 karakter." };
    }

    // Preflight env: pembuatan akun butuh service-role. Dicek sebelum menyentuh
    // Supabase supaya salah konfigurasi terbaca jelas, bukan jadi 500.
    if (!hasAdminEnv()) {
      console.error("[createEmployee] SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL tidak tersedia di runtime.");
      return { ok: false, message: ADMIN_ENV_MESSAGE };
    }

    const admin = createAdminClient();
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (cErr || !created?.user) {
      const raw = cErr?.message ?? "respons Supabase kosong";
      console.error("[createEmployee] createUser gagal:", cErr?.status, raw);
      return { ok: false, message: createUserMessage(email, raw, cErr?.status) };
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
      const { error: delErr } = await admin.auth.admin.deleteUser(created.user.id);
      console.error("[createEmployee] insert employees gagal:", iErr.message);
      if (delErr) {
        console.error("[createEmployee] rollback deleteUser gagal:", delErr.message);
        return {
          ok: false,
          message: `Gagal menyimpan karyawan: ${iErr.message}. Akun login "${email}" terlanjur dibuat dan gagal dihapus — hapus manual di Supabase → Authentication.`,
        };
      }
      return { ok: false, message: `Gagal menyimpan karyawan: ${iErr.message}` };
    }

    revalidatePath("/employees");
    return { ok: true, message: `Karyawan ${full_name} berhasil ditambahkan.` };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[createEmployee] exception:", e);
    return { ok: false, message: `Gagal menambah karyawan: ${detail}` };
  }
}
