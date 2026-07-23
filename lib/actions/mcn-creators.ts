"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseRupiah } from "@/lib/mcn/parsers";
import { INDUSTRIES } from "@/lib/mcn/industries";

const JENIS_CREATOR_VALUES = ["live", "video", "mixed"] as const;
const STATUS_VALUES = ["prospek", "binding", "aktif", "nonaktif"] as const;
const STATUS_KONTRAK_VALUES = ["kontrak", "non kontrak"] as const;

export type ActionResult = { ok: boolean; message: string };

// Trim string form field → null bila kosong (kolom text nullable di mcn_creators).
function strOrNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

// Field uang (numeric): "" → null; selain itu parseRupiah. Kembalikan ok:false
// bila format tak dikenali agar bisa disurfacekan ke user (parseRupiah mengembalikan
// null baik untuk kosong maupun tak-valid, jadi keduanya dibedakan di sini).
function parseMoneyField(
  v: FormDataEntryValue | null
): { ok: true; value: number | null } | { ok: false } {
  const s = String(v ?? "").trim();
  if (s === "") return { ok: true, value: null };
  const n = parseRupiah(s);
  if (n === null) return { ok: false };
  return { ok: true, value: n };
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

// updateCreator: edit menyeluruh satu baris kreator dari modal "Edit". Menulis semua
// kolom bisnis yang boleh diedit sekaligus (termasuk kolom baru status_kontrak).
// Kolom identitas/sistem (code, commission_share sync, audit) TIDAK ditulis — di UI
// hanya ditampilkan read-only. `status` melewati state machine DB: transisi ilegal
// ditolak trigger dan pesannya diteruskan apa adanya; mengirim status yang sama
// tidak memicu apa-apa (trigger hanya bereaksi saat status berubah).
export async function updateCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const creator_id = String(formData.get("creator_id") || "");
  if (!creator_id) return { ok: false, message: "Kreator tidak valid." };

  const name = String(formData.get("name") || "").trim();
  if (!name) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  const platform = String(formData.get("platform") || "").trim() || "tiktok";

  // niche & jenis_creator — validasi domain yang sama dengan setCreatorProfile.
  const nicheRaw = String(formData.get("niche") || "").trim();
  if (nicheRaw !== "" && !INDUSTRIES.includes(nicheRaw as (typeof INDUSTRIES)[number])) {
    return { ok: false, message: "Industry tidak dikenali." };
  }
  const niche = nicheRaw === "" ? null : nicheRaw;

  const jenisRaw = String(formData.get("jenis_creator") || "").trim();
  if (jenisRaw !== "" && !JENIS_CREATOR_VALUES.includes(jenisRaw as (typeof JENIS_CREATOR_VALUES)[number])) {
    return { ok: false, message: "Jenis kreator tidak dikenali." };
  }
  const jenis_creator = jenisRaw === "" ? null : jenisRaw;

  const status = String(formData.get("status") || "").trim();
  if (!STATUS_VALUES.includes(status as (typeof STATUS_VALUES)[number])) {
    return { ok: false, message: "Status tidak dikenali." };
  }

  const statusKontrakRaw = String(formData.get("status_kontrak") || "").trim();
  if (
    statusKontrakRaw !== "" &&
    !STATUS_KONTRAK_VALUES.includes(statusKontrakRaw as (typeof STATUS_KONTRAK_VALUES)[number])
  ) {
    return { ok: false, message: "Status kontrak tidak dikenali." };
  }
  const status_kontrak = statusKontrakRaw === "" ? null : statusKontrakRaw;

  const owner_cpm_id = String(formData.get("owner_cpm_id") || "") || null;
  const live_roster = String(formData.get("live_roster") || "") === "true";

  // Kolom numeric uang.
  const gmvP = parseMoneyField(formData.get("gmv"));
  const gmvLiveP = parseMoneyField(formData.get("gmv_live"));
  const gmvVideoP = parseMoneyField(formData.get("gmv_video"));
  const capP = parseMoneyField(formData.get("ads_budget_cap"));
  if (!gmvP.ok || !gmvLiveP.ok || !gmvVideoP.ok || !capP.ok) {
    return { ok: false, message: "Nominal angka tidak dikenali — periksa formatnya." };
  }

  // top_niches (jsonb) — kosong → null; selain itu wajib JSON valid.
  const topRaw = String(formData.get("top_niches") || "").trim();
  let top_niches: unknown = null;
  if (topRaw !== "") {
    try {
      top_niches = JSON.parse(topRaw);
    } catch {
      return { ok: false, message: "Format JSON pada Top Niches tidak valid." };
    }
  }

  const { error } = await supabase
    .from("mcn_creators")
    .update({
      name,
      platform,
      username: strOrNull(formData.get("username")),
      city: strOrNull(formData.get("city")),
      niche,
      jenis_creator,
      creator_level: strOrNull(formData.get("creator_level")),
      binding_status: strOrNull(formData.get("binding_status")),
      status,
      status_kontrak,
      owner_cpm_id,
      live_roster,
      gmv: gmvP.value,
      gmv_live: gmvLiveP.value,
      gmv_video: gmvVideoP.value,
      ads_budget_cap: capP.value,
      notes: strOrNull(formData.get("notes")),
      top_niches,
    })
    .eq("id", creator_id);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "Username/nama bentrok dengan kreator lain di platform yang sama." };
    }
    return { ok: false, message: `Gagal menyimpan perubahan: ${error.message}` };
  }

  revalidatePath("/meago/creators");
  revalidatePath("/acquisition");
  return { ok: true, message: `Data kreator "${name}" diperbarui.` };
}
