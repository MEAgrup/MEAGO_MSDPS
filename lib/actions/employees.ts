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
import {
  LEAD_ONBOARDING_KEY,
  WINDOW_CLOSED,
  generateTempPassword,
  parseWindow,
  verdictForAdd,
  wibLocalInputToIso,
  windowStatus,
} from "@/lib/employee-onboarding";

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


// ---- Jendela onboarding (migrasi 0365) --------------------------------------
// Konteks pemanggil: identitas + konfigurasi jendela, sekali baca. Dipakai
// createEmployee dan aksi pengelolaan jendela.
async function onboardingCtx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, me: null, window: WINDOW_CLOSED };

  const [{ data: me }, { data: cfg }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, division, rank, is_od, is_director")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("app_config").select("value").eq("key", LEAD_ONBOARDING_KEY).maybeSingle(),
  ]);

  return { supabase, user, me, window: parseWindow(cfg?.value) };
}

export async function createEmployee(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  // Server action tidak boleh melempar: exception apa pun di sini akan sampai ke
  // user sebagai "internal server error" tanpa keterangan. Semua jalur keluar
  // lewat ActionResult.
  try {
    const { supabase, user, me, window } = await onboardingCtx();
    if (!user) return { ok: false, message: "Tidak terautentikasi." };
    if (!me) return { ok: false, message: "Akun Anda tidak terhubung ke data karyawan." };

    const mgmt = !!(me.is_od || me.is_director);

    const email = String(formData.get("email") || "").trim().toLowerCase();
    const full_name = String(formData.get("full_name") || "").trim();

    // Field peran hanya dibaca dari form untuk penambah OD/Director. Untuk
    // SPV/Lead nilainya DIPAKSA dari identitas penambah — form yang dikirim
    // ulang dengan divisi/level lain tidak boleh berpengaruh apa pun.
    const division = mgmt ? String(formData.get("division") || "") : String(me.division);
    const rank = mgmt ? String(formData.get("rank") || "staff") : "staff";
    const is_od = mgmt ? formData.get("is_od") === "on" : false;
    const is_director = mgmt ? formData.get("is_director") === "on" : false;

    const verdict = verdictForAdd(me, { division, rank, is_od, is_director }, window);
    if (!verdict.ok) return { ok: false, message: verdict.message };

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

    // Password. Jalur lead SELALU sementara dan SELALU dibuat sistem — bukan
    // pilihan UI, karena policy 0365 menolak barisnya kalau must_change_password
    // tidak true. Jalur OD boleh mengetik sendiri; kosong = dibuatkan juga.
    const typed = String(formData.get("password") || "");
    const generated = verdict.via === "lead_window" || typed === "";
    const password = generated ? generateTempPassword() : typed;
    const mustChange =
      verdict.via === "lead_window" ? true : formData.get("must_change_password") === "on";
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

    // Baris employees ditulis lewat SESI PENAMBAH, bukan service-role: itu yang
    // membuat policy 0365 benar-benar menjadi gerbangnya (service-role melewati
    // RLS), dan yang membuat audit_log mencatat aktornya alih-alih NULL.
    const { error: iErr } = await supabase.from("employees").insert({
      id: created.user.id,
      full_name,
      division,
      rank,
      is_od,
      is_director,
      active: true,
      created_by: me.id,
      created_via: verdict.via,
      must_change_password: mustChange,
    });
    if (iErr) {
      // Roll back the orphan auth user so we don't leave a login with no profile.
      const { error: delErr } = await admin.auth.admin.deleteUser(created.user.id);
      console.error("[createEmployee] insert employees gagal:", iErr.message);
      const denied = /row-level security|policy/i.test(iErr.message)
        ? "Penambahan ditolak aturan akses database (jendela onboarding sudah tutup atau data di luar wewenang Anda)."
        : `Gagal menyimpan karyawan: ${iErr.message}`;
      if (delErr) {
        console.error("[createEmployee] rollback deleteUser gagal:", delErr.message);
        return {
          ok: false,
          message: `${denied} Akun login "${email}" terlanjur dibuat dan gagal dihapus — hapus manual di Supabase → Authentication.`,
        };
      }
      return { ok: false, message: denied };
    }

    revalidatePath("/employees");
    const credential = generated
      ? `\n\nPassword sementara: ${password}\nSerahkan ke ${full_name}; password ini hanya tampil sekali.`
      : "";
    const changeNote = mustChange
      ? "\nAkun wajib mengganti password sendiri saat login pertama."
      : "";
    return {
      ok: true,
      message: `Karyawan ${full_name} berhasil ditambahkan.${credential}${changeNote}`,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[createEmployee] exception:", e);
    return { ok: false, message: withKeyWarning(`Gagal menambah karyawan: ${detail}`) };
  }
}

// setLeadOnboardingWindow — OD/Director membuka, mempersempit, atau menutup
// jendela. Satu-satunya jalur UI untuk mengubah app_config
// `employees.lead_onboarding`; RLS app_config_manage menegakkan hal yang sama.
export async function setLeadOnboardingWindow(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const { supabase, user, me } = await onboardingCtx();
    if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
    if (!(me.is_od || me.is_director)) {
      return { ok: false, message: "Hanya OD/Director yang boleh mengatur jendela onboarding." };
    }

    const enabled = formData.get("enabled") === "on";
    const closesRaw = String(formData.get("closes_at") || "").trim();
    const divisions = formData.getAll("divisions").map(String).filter(isDivision);
    const note = String(formData.get("note") || "").trim();

    let closes_at: string | null = null;
    if (closesRaw !== "") {
      closes_at = wibLocalInputToIso(closesRaw);
      if (!closes_at) return { ok: false, message: "Tanggal tutup tidak terbaca." };
    }
    // Jendela terbuka tanpa tanggal tutup = pelonggaran permanen yang menunggu
    // seseorang ingat mencabutnya. Justru itu yang dihindari desain ini.
    if (enabled && !closes_at) {
      return {
        ok: false,
        message: "Isi tanggal tutup. Jendela onboarding harus punya akhir — tanpa itu wewenangnya tidak pernah tercabut sendiri.",
      };
    }
    if (enabled && Date.parse(closes_at!) <= Date.now()) {
      return { ok: false, message: "Tanggal tutup sudah lewat — pilih waktu di depan." };
    }

    const value = {
      enabled,
      opens_at: null,
      closes_at,
      divisions: divisions.length > 0 ? divisions : null,
      note: note || null,
    };

    const { error } = await supabase.from("app_config").upsert(
      {
        key: LEAD_ONBOARDING_KEY,
        value,
        updated_by: me.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return { ok: false, message: `Gagal menyimpan jendela: ${error.message}` };

    revalidatePath("/employees");
    const status = windowStatus(parseWindow(value));
    return {
      ok: true,
      message: enabled
        ? `Jendela onboarding SPV/Lead aktif. ${status.reason}`
        : "Jendela onboarding ditutup — penambahan karyawan kembali sepenuhnya ke OD/HR.",
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[setLeadOnboardingWindow] exception:", e);
    return { ok: false, message: `Gagal menyimpan jendela: ${detail}` };
  }
}

// closeLeadOnboardingWindow — pencabutan satu tombol, tanpa mengisi form. Ini
// aksi yang paling mungkin dipakai terburu-buru; jangan dibuat bergantung pada
// field lain yang benar.
export async function closeLeadOnboardingWindow(): Promise<ActionResult> {
  try {
    const { supabase, user, me, window } = await onboardingCtx();
    if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
    if (!(me.is_od || me.is_director)) {
      return { ok: false, message: "Hanya OD/Director yang boleh mencabut jendela onboarding." };
    }

    const { error } = await supabase.from("app_config").upsert(
      {
        key: LEAD_ONBOARDING_KEY,
        value: { ...window, enabled: false, closes_at: new Date().toISOString() },
        updated_by: me.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) return { ok: false, message: `Gagal mencabut jendela: ${error.message}` };

    revalidatePath("/employees");
    return {
      ok: true,
      message: "Jendela onboarding dicabut. Menambah karyawan kembali hanya bisa oleh OD/HR dan Director.",
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[closeLeadOnboardingWindow] exception:", e);
    return { ok: false, message: `Gagal mencabut jendela: ${detail}` };
  }
}

// resetEmployeePassword — OD/HR menerbitkan ulang password sementara untuk akun
// yang lupa/belum sempat login. Tanpa ini, satu-satunya jalan adalah membuka
// dashboard Supabase — di luar sistem dan di luar audit.
export async function resetEmployeePassword(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  try {
    const { supabase, user, me } = await onboardingCtx();
    if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
    if (!(me.is_od || me.is_director)) {
      return { ok: false, message: "Hanya OD/Director yang boleh mereset password karyawan." };
    }

    const employee_id = String(formData.get("employee_id") || "");
    if (!employee_id) return { ok: false, message: "Karyawan tidak dipilih." };

    const { data: target } = await supabase
      .from("employees")
      .select("id, full_name")
      .eq("id", employee_id)
      .maybeSingle();
    if (!target) return { ok: false, message: "Karyawan tidak ditemukan." };

    if (!hasAdminEnv()) return { ok: false, message: withKeyWarning(ADMIN_ENV_MESSAGE) };

    const password = generateTempPassword();
    const admin = createAdminClient();
    const { error: uErr } = await admin.auth.admin.updateUserById(employee_id, { password });
    if (uErr) {
      console.error("[resetEmployeePassword] updateUserById gagal:", uErr.status, uErr.message);
      const hint =
        uErr.status === 401 || uErr.status === 403
          ? `\n\nDiagnosa: ${adminKeyRejectionHint()}`
          : "";
      return {
        ok: false,
        message: withKeyWarning(`Gagal mengganti password (${uErr.status ?? "tanpa status"}): ${uErr.message}${hint}`),
      };
    }

    const { error: eErr } = await supabase
      .from("employees")
      .update({ must_change_password: true, password_changed_at: null })
      .eq("id", employee_id);
    if (eErr) {
      return {
        ok: false,
        message: `Password sudah diganti menjadi "${password}", tetapi penandaan wajib-ganti gagal: ${eErr.message}`,
      };
    }

    revalidatePath("/employees");
    return {
      ok: true,
      message: `Password sementara ${target.full_name}: ${password}\nWajib diganti saat login berikutnya; password ini hanya tampil sekali.`,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[resetEmployeePassword] exception:", e);
    return { ok: false, message: `Gagal mereset password: ${detail}` };
  }
}
