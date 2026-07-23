"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseRupiah } from "@/lib/mcn/parsers";
import { INDUSTRIES } from "@/lib/mcn/industries";

const JENIS_CREATOR_VALUES = ["live", "video", "mixed"] as const;

export type ActionResult = { ok: boolean; message: string };

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

const STATUS_KONTRAK_VALUES = ["kontrak", "non kontrak"] as const;

// editCreator: update multiple fields di modal edit. Update name, username, city,
// jenis_creator, niche, status_kontrak, notes, ads_budget_cap. Validasi nama wajib.
// Follow RLS policy mcn_creators_update: management (OD/Director) + Acquisition
// + CreatorManagement (Lead lintas, staff hanya kreator miliknya).
export async function editCreator(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };

  const creator_id = String(formData.get("creator_id") || "");
  if (!creator_id) return { ok: false, message: "Kreator tidak valid." };

  // Check RLS policy: management + Acquisition + (CreatorManagement & (lead atau owner))
  const isManagement = me.is_od || me.is_director;
  const isAcquisition = me.division === "Acquisition";
  const isCmLeadOrOwner =
    me.division === "CreatorManagement" &&
    (me.rank === "lead" || me.id === String(formData.get("current_owner_id")));

  if (!isManagement && !isAcquisition && !isCmLeadOrOwner) {
    return {
      ok: false,
      message: "Anda tidak memiliki akses untuk mengedit kreator ini.",
    };
  }

  const name = String(formData.get("name") || "").trim();
  if (!name) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }

  const username = String(formData.get("username") || "").trim() || null;
  const city = String(formData.get("city") || "").trim() || null;

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

  const statusKontrakRaw = String(formData.get("status_kontrak") || "").trim();
  if (!STATUS_KONTRAK_VALUES.includes(statusKontrakRaw as (typeof STATUS_KONTRAK_VALUES)[number])) {
    return { ok: false, message: "Status kontrak tidak dikenali." };
  }
  const status_kontrak = statusKontrakRaw as (typeof STATUS_KONTRAK_VALUES)[number];

  const notes = String(formData.get("notes") || "").trim() || null;

  const capRaw = String(formData.get("ads_budget_cap") || "").trim();
  const ads_budget_cap = capRaw === "" ? null : parseRupiah(capRaw);
  if (capRaw !== "" && ads_budget_cap === null) {
    return { ok: false, message: "Nominal budget cap tidak dikenali — periksa formatnya." };
  }

  const { error } = await supabase
    .from("mcn_creators")
    .update({
      name,
      username,
      city,
      jenis_creator,
      niche,
      status_kontrak,
      notes,
      ads_budget_cap,
    })
    .eq("id", creator_id);

  if (error) return { ok: false, message: `Gagal menyimpan kreator: ${error.message}` };

  revalidatePath("/meago/creators");
  revalidatePath("/acquisition");
  return { ok: true, message: "Data kreator diperbarui." };
}
