"use server";

// Target OKR — Director/OD menetapkan target per divisi (bukan hardcode).
// Enforcement tetap di Postgres: RLS okr_meago_manage (is_od/is_director) + unique
// index parsial (satu target aktif per period/division/metric). Pola supersede:
// nonaktifkan baris lama (active=false) lalu insert baris baru — histori target
// tidak pernah diedit.
//
// PENSIUN 2026-09-12: menulis ke `okr_targets_meago`, BUKAN `okr_targets`. Tabel
// lama dibekukan bersama M14 (kolom role bertipe enum perf_role yang hanya memuat
// divisi operasional — lihat header migrasi 0361 kenapa enum itu tidak diperluas).
// Baris lamanya tetap ada sebagai riwayat; nol jalur tulis dari sini.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { OKR_METRIC_KEYS, PERIOD_RE } from "@/lib/okr-metrics";

export type ActionResult = { ok: boolean; message: string };

const ROLES = new Set(["BizDev", "CreatorManagement", "Acquisition", "Marketing", "Finance"]);
const COMPARATORS = new Set(["gte", "lte"]);

// Tetapkan / ubah target satu metrik untuk satu periode.
export async function setOkrTarget(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const period = String(formData.get("period") || "").trim();
  const role = String(formData.get("role") || "").trim();
  const metric = String(formData.get("metric") || "").trim();
  const comparator = String(formData.get("comparator") || "gte").trim();
  const raw = String(formData.get("target_value") || "").trim().replace(",", ".");
  const value = Number(raw);

  if (!PERIOD_RE.test(period)) {
    return { ok: false, message: "Periode tidak valid (format harus mis. 2026-Q3)." };
  }
  if (!ROLES.has(role) || !COMPARATORS.has(comparator) || !OKR_METRIC_KEYS.has(`${role}|${metric}`)) {
    return { ok: false, message: "Metrik/role tidak dikenal." };
  }
  if (!raw || !Number.isFinite(value) || value <= 0) {
    return { ok: false, message: "Target harus angka lebih dari 0." };
  }

  // Baris aktif saat ini (jika ada) untuk period/role/metric.
  const { data: existing, error: selErr } = await supabase
    .from("okr_targets_meago")
    .select("id, target_value, comparator")
    .eq("period", period)
    .eq("division", role)
    .eq("metric", metric)
    .eq("active", true)
    .maybeSingle();
  if (selErr) return { ok: false, message: `Gagal membaca target: ${selErr.message}` };

  if (existing && Number(existing.target_value) === value && existing.comparator === comparator) {
    return { ok: true, message: "Tidak ada perubahan — target sudah sama." };
  }

  // Supersede: nonaktifkan yang lama dulu (unique index melarang dua baris aktif).
  if (existing) {
    const { data: upd, error: updErr } = await supabase
      .from("okr_targets_meago")
      .update({ active: false })
      .eq("id", existing.id)
      .select("id");
    if (updErr) return { ok: false, message: `Gagal menonaktifkan target lama: ${updErr.message}` };
    if (!upd || upd.length === 0) {
      return { ok: false, message: "[anda tidak berwenang mengatur target OKR]" };
    }
  }

  const { data: ins, error: insErr } = await supabase
    .from("okr_targets_meago")
    .insert({
      period,
      division: role,
      metric,
      target_value: value,
      comparator,
      active: true,
      set_by: user.id,
    })
    .select("id");
  if (insErr) return { ok: false, message: `Gagal menyimpan target: ${insErr.message}` };
  if (!ins || ins.length === 0) {
    return { ok: false, message: "[anda tidak berwenang mengatur target OKR]" };
  }

  revalidatePath("/okr");
  return {
    ok: true,
    message: `Target tersimpan: ${role} · ${metric} = ${comparator === "lte" ? "≤" : "≥"} ${value} (${period}).`,
  };
}

// Hapus target (kembali ke default engine): nonaktifkan baris aktif.
export async function clearOkrTarget(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Target tidak valid." };

  const { data, error } = await supabase
    .from("okr_targets_meago")
    .update({ active: false })
    .eq("id", id)
    .eq("active", true)
    .select("id");
  if (error) return { ok: false, message: `Gagal menghapus target: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, message: "[anda tidak berwenang atau target sudah tidak aktif]" };
  }

  revalidatePath("/okr");
  return { ok: true, message: "Target dinonaktifkan — kembali memakai nilai default katalog." };
}
