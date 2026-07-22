"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseRupiah, parsePercent } from "@/lib/mcn/parsers";
import { INDUSTRIES } from "@/lib/mcn/industries";

const JENIS_CREATOR_VALUES = ["live", "video", "mixed"] as const;
const STATUS_KONTRAK_VALUES = ["-", "kontrak", "non_kontrak"] as const;
// Nilai binding_status yang dikenali (disinkron dari file ingest). Diperbolehkan di
// form edit; "" berarti kosongkan (null).
const BINDING_STATUS_VALUES = ["Bound creators", "Previously bound creators"] as const;

export type ActionResult = { ok: boolean; message: string };

// Parser angka untuk kolom override metrik manual. Menerima format uang Indonesia/
// internasional (via parseRupiah) MAUPUN desimal polos "12.5"/"12,5" (yang sengaja
// ditolak parseRupiah karena ambigu sbg ribuan). "" berarti kosong → null (pakai
// hitungan otomatis). Non-kosong tapi tak dikenali → null juga; caller yang
// membedakan "kosong" vs "tak valid" via cek raw !== "".
function parseManualNumber(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const viaRupiah = parseRupiah(s);
  if (viaRupiah !== null) return viaRupiah;
  const norm = s.replace(/\s|rp\.?|idr/gi, "").replace(",", ".");
  if (/^\d+(\.\d+)?$/.test(norm)) {
    const n = parseFloat(norm);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function ctx() {
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

// CM Lead atau management (OD/Director) — dipakai utk aksi lintas-kreator.
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

// addCreator: daftar prospek manual. Wajib name; platform default 'tiktok'.
// status default 'prospek' (di DB). commission_share TIDAK ada form-nya (read-only).
export async function addCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const name = String(formData.get("name") || "").trim();
  const platform = String(formData.get("platform") || "").trim() || "tiktok";
  const niche = String(formData.get("niche") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim() || null;
  const username = String(formData.get("username") || "").trim() || null;
  const city = String(formData.get("city") || "").trim() || null;

  if (!name) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const { error } = await supabase
    .from("mcn_creators")
    .insert({ name, platform, niche, notes, username, city });

  if (error) {
    if (error.code === "23505") {
      const { data: dup } = await supabase
        .from("mcn_creators")
        .select("code, name")
        .eq("platform", platform)
        .ilike("name", name)
        .maybeSingle();
      return {
        ok: false,
        message: dup
          ? `[kreator sudah terdaftar] sebagai ${dup.code} — ${dup.name} di platform ${platform}.`
          : `[kreator "${name}" sudah terdaftar di platform ${platform}]`,
      };
    }
    return { ok: false, message: `Gagal menyimpan kreator: ${error.message}` };
  }

  revalidatePath("/meago/creators");
  revalidatePath("/acquisition");
  return { ok: true, message: `Kreator "${name}" terdaftar sebagai prospek.` };
}

// assignOwner: set owner_cpm_id. Hanya CM Lead / management.
export async function assignOwner(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!isCmLeadOrMgmt(me)) {
    return { ok: false, message: "Hanya CM Lead atau management yang dapat menetapkan owner." };
  }

  const creator_id = String(formData.get("creator_id") || "");
  const owner_cpm_id = String(formData.get("owner_cpm_id") || "") || null;
  if (!creator_id) return { ok: false, message: "Kreator tidak valid." };

  const { error } = await supabase
    .from("mcn_creators")
    .update({ owner_cpm_id })
    .eq("id", creator_id);
  if (error) return { ok: false, message: `Gagal menetapkan owner: ${error.message}` };

  revalidatePath("/meago/creators");
  return { ok: true, message: owner_cpm_id ? "Owner CM diperbarui." : "Owner CM dilepas." };
}

// toggleRoster: set live_roster ke nilai yang dikirim form (true/false).
export async function toggleRoster(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const creator_id = String(formData.get("creator_id") || "");
  const live_roster = String(formData.get("live_roster") || "") === "true";
  if (!creator_id) return { ok: false, message: "Kreator tidak valid." };

  const { error } = await supabase
    .from("mcn_creators")
    .update({ live_roster })
    .eq("id", creator_id);
  if (error) return { ok: false, message: `Gagal memperbarui roster: ${error.message}` };

  revalidatePath("/meago/creators");
  return { ok: true, message: live_roster ? "Kreator masuk roster live." : "Kreator keluar dari roster live." };
}

// setAdsBudgetCap: update ads_budget_cap (angka uang → parseRupiah, bukan Number mentah).
export async function setAdsBudgetCap(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const creator_id = String(formData.get("creator_id") || "");
  const capRaw = String(formData.get("ads_budget_cap") || "").trim();
  if (!creator_id) return { ok: false, message: "Kreator tidak valid." };

  const ads_budget_cap = capRaw === "" ? null : parseRupiah(capRaw);
  if (capRaw !== "" && ads_budget_cap === null) {
    return { ok: false, message: "Nominal budget cap tidak dikenali — periksa formatnya." };
  }

  const { error } = await supabase
    .from("mcn_creators")
    .update({ ads_budget_cap })
    .eq("id", creator_id);
  if (error) return { ok: false, message: `Gagal menyimpan budget cap: ${error.message}` };

  revalidatePath("/meago/creators");
  return { ok: true, message: "Ads budget cap diperbarui." };
}

// setCreatorStatus: update status. State machine di DB menolak transisi ilegal —
// pesan error DB diteruskan apa adanya.
export async function setCreatorStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const creator_id = String(formData.get("creator_id") || "");
  const status = String(formData.get("status") || "");
  if (!creator_id || !status) return { ok: false, message: "Data transisi status tidak lengkap." };

  const { error } = await supabase
    .from("mcn_creators")
    .update({ status })
    .eq("id", creator_id);
  if (error) return { ok: false, message: `Transisi status ditolak: ${error.message}` };

  revalidatePath("/meago/creators");
  return { ok: true, message: `Status kreator diubah ke ${status}.` };
}

// setCreatorProfile: update jenis_creator & niche. Fase "export list konten video" (yang
// tadinya akan auto-fill dua kolom ini dari data ingest) DIBATALKAN (keputusan
// 2026-07-16) — ini satu-satunya jalur pengisian, diisi manual per kreator di sini.
export async function setCreatorProfile(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const creator_id = String(formData.get("creator_id") || "");
  if (!creator_id) return { ok: false, message: "Kreator tidak valid." };

  const jenisRaw = String(formData.get("jenis_creator") || "").trim();
  if (jenisRaw !== "" && !JENIS_CREATOR_VALUES.includes(jenisRaw as (typeof JENIS_CREATOR_VALUES)[number])) {
    return { ok: false, message: "Jenis kreator tidak dikenali." };
  }
  const jenis_creator = jenisRaw === "" ? null : jenisRaw;

  const nicheRaw = String(formData.get("niche") || "").trim();
  if (nicheRaw !== "" && !INDUSTRIES.includes(nicheRaw as (typeof INDUSTRIES)[number])) {
    return { ok: false, message: "Industry tidak dikenali." };
  }
  const niche = nicheRaw === "" ? null : nicheRaw;

  const { error } = await supabase
    .from("mcn_creators")
    .update({ jenis_creator, niche })
    .eq("id", creator_id);
  if (error) return { ok: false, message: `Gagal menyimpan profil kreator: ${error.message}` };

  revalidatePath("/meago/creators");
  revalidatePath("/acquisition");
  return { ok: true, message: "Profil kreator diperbarui." };
}

// updateCreator: edit penuh SATU baris Master Kreator dari modal edit di
// /meago/creators. Menggabungkan seluruh kolom yang bisa di-edit dalam satu submit.
// Row-level permission ditegakkan RLS (mcn_creators_update: mgmt + Acquisition + CM
// lead/owner). owner_cpm_id HANYA diikutkan bila user CM Lead/management — staff CM
// tidak boleh memindah owner (form-nya pun read-only untuk mereka).
//
// Kolom metrik (manual_*) bersifat override: kosong = pakai hitungan otomatis,
// diisi = tampilkan nilai manual. Nilai non-kosong yang tak dikenali ditolak
// (bukan diam-diam jadi null) agar salah ketik tidak menghapus override.
export async function updateCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };

  const creator_id = String(formData.get("creator_id") || "");
  if (!creator_id) return { ok: false, message: "Kreator tidak valid." };

  // --- Identitas ---
  const name = String(formData.get("name") || "").trim();
  if (!name) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  const username = String(formData.get("username") || "").trim() || null;

  // --- Status (binding) ---
  const bindingRaw = String(formData.get("binding_status") || "").trim();
  if (
    bindingRaw !== "" &&
    !BINDING_STATUS_VALUES.includes(bindingRaw as (typeof BINDING_STATUS_VALUES)[number])
  ) {
    return { ok: false, message: "Status (binding) tidak dikenali." };
  }
  const binding_status = bindingRaw === "" ? null : bindingRaw;

  // --- Status Kontrak (kolom baru) ---
  const statusKontrakRaw = String(formData.get("status_kontrak") || "-").trim() || "-";
  if (!STATUS_KONTRAK_VALUES.includes(statusKontrakRaw as (typeof STATUS_KONTRAK_VALUES)[number])) {
    return { ok: false, message: "Status kontrak tidak dikenali." };
  }
  const status_kontrak = statusKontrakRaw;

  // --- Industry & Jenis ---
  const nicheRaw = String(formData.get("niche") || "").trim();
  if (nicheRaw !== "" && !INDUSTRIES.includes(nicheRaw as (typeof INDUSTRIES)[number])) {
    return { ok: false, message: "Industry tidak dikenali." };
  }
  const niche = nicheRaw === "" ? null : nicheRaw;

  const jenisRaw = String(formData.get("jenis_creator") || "").trim();
  if (
    jenisRaw !== "" &&
    !JENIS_CREATOR_VALUES.includes(jenisRaw as (typeof JENIS_CREATOR_VALUES)[number])
  ) {
    return { ok: false, message: "Jenis kreator tidak dikenali." };
  }
  const jenis_creator = jenisRaw === "" ? null : jenisRaw;

  // --- Level (teks bebas dari file, boleh dikosongkan) ---
  const creator_level = String(formData.get("creator_level") || "").trim() || null;

  // --- Komisi (%) ---
  const komisiRaw = String(formData.get("commission_share") || "").trim();
  const commission_share = komisiRaw === "" ? null : parsePercent(komisiRaw);
  if (komisiRaw !== "" && (commission_share === null || commission_share < 0 || commission_share > 100)) {
    return { ok: false, message: "Komisi harus berupa angka 0–100 (%)." };
  }

  // --- Override metrik manual ---
  const metricFields: { name: string; label: string }[] = [
    { name: "manual_avg_pay_gmv", label: "Avg Pay GMV" },
    { name: "manual_redeemed_gmv", label: "Redeemed GMV" },
    { name: "manual_total_post", label: "Total post" },
    { name: "manual_posts_with_sales", label: "Posts with sales" },
    { name: "manual_live_stream", label: "Live stream" },
    { name: "manual_valid_live_stream", label: "Valid live stream" },
  ];
  const metricPatch: Record<string, number | null> = {};
  for (const f of metricFields) {
    const raw = String(formData.get(f.name) || "").trim();
    const val = parseManualNumber(raw);
    if (raw !== "" && val === null) {
      return { ok: false, message: `Nilai "${f.label}" tidak dikenali — periksa formatnya.` };
    }
    if (val !== null && val < 0) {
      return { ok: false, message: `Nilai "${f.label}" tidak boleh negatif.` };
    }
    metricPatch[f.name] = val;
  }

  // --- Roster Live ---
  const live_roster = String(formData.get("live_roster") || "") === "true";

  const patch: Record<string, unknown> = {
    name,
    username,
    binding_status,
    status_kontrak,
    niche,
    jenis_creator,
    creator_level,
    commission_share,
    live_roster,
    ...metricPatch,
  };

  // owner_cpm_id hanya boleh diubah CM Lead/management.
  if (isCmLeadOrMgmt(me)) {
    patch.owner_cpm_id = String(formData.get("owner_cpm_id") || "") || null;
  }

  const { error } = await supabase.from("mcn_creators").update(patch).eq("id", creator_id);
  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: `Username sudah dipakai kreator lain di platform ini.` };
    }
    return { ok: false, message: `Gagal menyimpan perubahan: ${error.message}` };
  }

  revalidatePath("/meago/creators");
  revalidatePath("/acquisition");
  return { ok: true, message: `Data kreator "${name}" berhasil diperbarui.` };
}
