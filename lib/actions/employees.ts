"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  createAdminClient,
  hasAdminEnv,
  describeAdminKey,
  adminKeyWarning,
  adminKeyRejectionHint,
  ADMIN_ENV_MESSAGE,
} from "@/lib/supabase/admin";
import { isDivision } from "@/lib/divisions";

export type ActionResult = { ok: boolean; message: string };

const RANKS = ["staff", "lead"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Tempelkan diagnosa bentuk env ke pesan gagal. Kegagalan pembuatan akun di
// production nyaris selalu soal env, dan pesan Supabase sendiri tidak pernah
// menyebutkannya.
function withKeyWarning(message: string): string {
  const warning = adminKeyWarning();
  return warning ? `${message}\n\nDiagnosa: ${warning}` : message;
}

// Terjemahkan kegagalan auth.admin.createUser jadi pesan yang bisa ditindaklanjuti.
// Tanpa ini user hanya melihat teks mentah GoTrue (atau, dulu, layar 500 kosong).
function createUserMessage(email: string, message: string, status?: number): string {
  if (/already|registered|exist|duplicate/i.test(message)) {
    return `Email "${email}" sudah terpakai oleh akun lain.`;
  }
  if (status === 401 || status === 403) {
    return `Supabase menolak service-role key (${status}): ${message}.\n\nDiagnosa: ${adminKeyRejectionHint()}`;
  }
  if (/weak|password/i.test(message)) {
    return `Password ditolak Supabase: ${message}`;
  }
  return withKeyWarning(`Gagal membuat akun login (${status ?? "tanpa status"}): ${message}`);
}

// checkAdminConnection — panel diagnosa untuk OD/Director. Menjawab satu
// pertanyaan yang tidak bisa dijawab dari luar: apakah runtime production ini
// benar-benar memegang service-role key yang sah, dan apakah panggilan admin ke
// Supabase berhasil. Tidak pernah menampilkan nilai key — hanya bentuknya.
export async function checkAdminConnection(): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, message: "Tidak terautentikasi." };

    const { data: me } = await supabase
      .from("employees")
      .select("is_od, is_director")
      .eq("id", user.id)
      .maybeSingle();
    if (!me || (!me.is_od && !me.is_director)) {
      return { ok: false, message: "Hanya OD/Director yang boleh menjalankan diagnosa." };
    }

    const info = describeAdminKey();
    const lines: string[] = [
      `URL Supabase: ${info.url ?? "TIDAK TERBACA"}`,
      `Service-role key: ${
        info.keyPresent
          ? `terbaca (${info.length} karakter, awalan "${info.prefix}…", format ${info.format}${
              info.role ? `, role "${info.role}"` : ""
            }${info.projectRef ? `, ref "${info.projectRef}"` : ""})`
          : "TIDAK TERBACA"
      }`,
    ];

    if (!hasAdminEnv()) {
      lines.push("", `Diagnosa: ${adminKeyWarning() ?? ADMIN_ENV_MESSAGE}`);
      return { ok: false, message: lines.join("\n") };
    }

    // Panggilan admin paling ringan yang tetap butuh service-role: baca 1 user.
    const admin = createAdminClient();
    const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) {
      lines.push(
        "",
        `Panggilan admin ke Supabase GAGAL (${error.status ?? "tanpa status"}): ${error.message}`,
        `Diagnosa: ${
          error.status === 401 || error.status === 403
            ? adminKeyRejectionHint(info)
            : (adminKeyWarning(info) ?? "Bentuk env terlihat wajar — periksa status project Supabase dan konektivitas jaringan.")
        }`
      );
      return { ok: false, message: lines.join("\n") };
    }

    lines.push("", "Panggilan admin ke Supabase BERHASIL — service-role key valid di runtime ini.");
    const warning = adminKeyWarning(info);
    if (warning) lines.push(`Catatan: ${warning}`);
    return { ok: true, message: lines.join("\n") };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[checkAdminConnection] exception:", e);
    return { ok: false, message: `Diagnosa gagal dijalankan: ${detail}` };
  }
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
      return { ok: false, message: withKeyWarning(ADMIN_ENV_MESSAGE) };
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
    return { ok: false, message: withKeyWarning(`Gagal menambah karyawan: ${detail}`) };
  }
}
