"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type ActionResult = { ok: boolean; message: string };
export type SignedUrlResult = { ok: boolean; message: string; url?: string };

const BUCKET = "creator-reports";
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

// Bucket creator-reports PRIVAT tanpa policy storage.objects: file hanya bisa
// disentuh service-role. Otorisasi selalu lewat tabel creator_reports ber-RLS
// (0312) memakai client sesi user — kalau metadata tidak boleh dibaca/ditulis
// user itu, file-nya pun tidak keluar.

// uploadCreatorReport — sisi karyawan (CM staff scope owner / Lead / mgmt via
// RLS insert creator_reports). Upload file dulu (admin), lalu insert metadata
// pakai client sesi user; bila RLS menolak, file di-rollback.
export async function uploadCreatorReport(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const creator_id = String(formData.get("creator_id") || "");
  const title = String(formData.get("title") || "").trim();
  const file = formData.get("file");
  if (!creator_id || !title || !(file instanceof File) || file.size === 0) {
    return { ok: false, message: "[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]" };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: "File terlalu besar (maksimal 20 MB)." };
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-100) || "report";
  const file_path = `${creator_id}/${Date.now()}-${safeName}`;

  const admin = createAdminClient();
  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(file_path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || "application/octet-stream",
    });
  if (upErr) return { ok: false, message: `Gagal mengunggah file: ${upErr.message}` };

  const { error: metaErr } = await supabase.from("creator_reports").insert({
    mcn_creator_id: creator_id,
    title,
    file_path,
  });
  if (metaErr) {
    await admin.storage.from(BUCKET).remove([file_path]);
    return { ok: false, message: `Gagal menyimpan report: ${metaErr.message}` };
  }

  revalidatePath("/meago/creators");
  revalidatePath("/kreator/report");
  return { ok: true, message: `Report "${title}" terunggah.` };
}

// getCreatorReportUrl — kreator (baris sendiri) MAUPUN karyawan CM/mgmt: RLS
// select creator_reports yang menentukan. Mengembalikan signed URL 10 menit.
export async function getCreatorReportUrl(reportId: string): Promise<SignedUrlResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const { data: report, error } = await supabase
    .from("creator_reports")
    .select("id, file_path")
    .eq("id", reportId)
    .maybeSingle();
  if (error) return { ok: false, message: `Gagal membaca report: ${error.message}` };
  if (!report) return { ok: false, message: "Report tidak ditemukan." };

  const admin = createAdminClient();
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(report.file_path, 600);
  if (signErr || !signed?.signedUrl) {
    return { ok: false, message: `Gagal membuat tautan unduh: ${signErr?.message ?? "unknown"}` };
  }
  return { ok: true, message: "OK", url: signed.signedUrl };
}

// deleteCreatorReport — pengunggah / Lead CM / mgmt (RLS delete). Hapus metadata
// dulu (gate), baru file-nya.
export async function deleteCreatorReport(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const reportId = String(formData.get("report_id") || "");
  if (!reportId) return { ok: false, message: "Report tidak valid." };

  const { data: deleted, error } = await supabase
    .from("creator_reports")
    .delete()
    .eq("id", reportId)
    .select("file_path");
  if (error) return { ok: false, message: `Gagal menghapus report: ${error.message}` };
  if (!deleted || deleted.length === 0) {
    return { ok: false, message: "Report tidak ditemukan atau bukan wewenangmu." };
  }

  const admin = createAdminClient();
  await admin.storage.from(BUCKET).remove(deleted.map((d) => d.file_path));

  revalidatePath("/meago/creators");
  revalidatePath("/kreator/report");
  return { ok: true, message: "Report dihapus." };
}
