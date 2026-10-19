"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { recordAcquisition } from "@/lib/actions/acquisition";

// Prospek Kreator (migrasi 0371). Semua tulisan lewat RPC creator_prospect_*:
// status hanya berubah lewat enforce_status_transition + capture_audit dengan
// actor = staf yang klik. Tidak ada UPDATE langsung ke creator_prospects.

export type ActionResult = { ok: boolean; message: string };

const PATH = "/acquisition/prospek";

async function rpc(fn: string, args: Record<string, unknown>): Promise<ActionResult | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, message: error.message };
  return null;
}

export async function setProspectStatus(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const id = String(formData.get("id") || "");
  const status = String(formData.get("status") || "");
  const reason = String(formData.get("rejected_reason") || "").trim() || null;
  const note = String(formData.get("rejected_note") || "").trim() || null;
  if (!id || !status) return { ok: false, message: "Status tidak valid." };
  if (status === "[Ditolak]" && !reason) return { ok: false, message: "[alasan penolakan wajib diisi]" };

  const err = await rpc("creator_prospect_set_status", {
    p_id: id,
    p_status: status,
    p_reason: reason,
    p_note: note,
  });
  if (err) return err;
  revalidatePath(PATH);
  return { ok: true, message: `Status diubah ke ${status}.` };
}

export async function assignProspectOwner(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const id = String(formData.get("id") || "");
  const owner = String(formData.get("owner_id") || "");
  if (!id || !owner) return { ok: false, message: "Pilih PIC Acquisition." };
  const err = await rpc("creator_prospect_assign", { p_id: id, p_owner: owner });
  if (err) return err;
  revalidatePath(PATH);
  return { ok: true, message: "PIC prospek diperbarui." };
}

export async function createCreatorFromProspect(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const id = String(formData.get("id") || "");
  if (!id) return { ok: false, message: "Prospek tidak valid." };
  const err = await rpc("creator_prospect_create_creator", { p_id: id });
  if (err) return err;
  revalidatePath(PATH);
  revalidatePath("/acquisition");
  return { ok: true, message: "Data kreator dibuat/ditautkan. Tandai Bound setelah binding_status = Bound creators." };
}

// "Catat Akuisisi (ACQ)": memakai recordAcquisition yang sudah ada (snapshot
// komisi, baseline GMV, prospek→binding), lalu menautkan barisnya ke prospek.
export async function recordProspectAcquisition(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const id = String(formData.get("id") || "");
  const bindingDate = String(formData.get("binding_date") || "").trim();
  if (!id || !bindingDate) return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };

  const supabase = await createClient();
  const { data: p, error: pErr } = await supabase
    .from("creator_prospects")
    .select("id, code, status, matched_mcn_creator_id, acquisition_id, cta_id")
    .eq("id", id)
    .maybeSingle();
  if (pErr || !p) return { ok: false, message: pErr?.message ?? "Prospek tidak ditemukan." };
  if (p.status !== "[Bound]" || !p.matched_mcn_creator_id) {
    return { ok: false, message: "[akuisisi hanya untuk prospek Bound yang tertaut]" };
  }
  if (p.acquisition_id) return { ok: false, message: "[akuisisi prospek ini sudah dicatat]" };

  const fd = new FormData();
  fd.set("mcn_creator_id", p.matched_mcn_creator_id);
  fd.set("binding_date", bindingDate);
  fd.set("lead_source", "inbound");
  fd.set("notes", `Dari prospek ${p.code}${p.cta_id ? ` · CTA ${p.cta_id}` : ""}`);
  const res = await recordAcquisition(null, fd);
  if (!res.ok) return res;

  const { data: acq, error: aErr } = await supabase
    .from("acquisitions")
    .select("id")
    .eq("mcn_creator_id", p.matched_mcn_creator_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (aErr || !acq) return { ok: false, message: "Akuisisi tercatat, tetapi gagal ditautkan ke prospek." };

  const err = await rpc("creator_prospect_link_acquisition", { p_id: id, p_acquisition_id: acq.id });
  if (err) return err;
  revalidatePath(PATH);
  revalidatePath("/acquisition");
  return { ok: true, message: "Akuisisi (ACQ) tercatat dan tertaut ke prospek." };
}
