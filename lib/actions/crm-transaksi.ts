"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  BENTUK_KERJASAMA,
  KATEGORI_BRAND,
  KATEGORI_WAJIB_DURASI,
  MANUAL,
} from "@/lib/crm/options";
import { jakartaInputToIso } from "@/lib/crm/waktu";

export type ActionResult = { ok: boolean; message: string };

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null };
  return { supabase, user };
}

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

// Angka opsional: "" -> null, non-numerik -> undefined (ditolak pemanggil).
function optNum(raw: string): number | null | undefined {
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

async function resolveEmployee(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pick: string,
  manual: string
): Promise<{ name: string; id: string | null }> {
  if (pick && pick !== MANUAL) {
    const { data } = await supabase
      .from("employees")
      .select("id, full_name")
      .eq("id", pick)
      .maybeSingle();
    if (data) return { name: data.full_name, id: data.id };
  }
  return { name: manual, id: null };
}

// Merakit payload transaksi dari FormData + validasi sisi server. Validasi yang
// sama juga ada di trigger DB 0321 (otoritatif); di sini supaya pesannya sampai
// ke user tanpa perlu round-trip error Postgres.
async function buildPayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData
): Promise<{ payload: Record<string, unknown> } | { error: string }> {
  const leadId = str(formData, "crm_lead_id");
  if (!leadId) return { error: "Pilih Nama POI / Merchant (status Dealing atau Renewal) dulu." };

  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, brand, status, kategori_brand")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { error: "Lead CRM tidak ditemukan." };
  if (lead.status !== "Dealing" && lead.status !== "Renewal") {
    return {
      error: `Transaksi hanya untuk lead berstatus Dealing/Renewal (status "${lead.brand}" saat ini: ${lead.status}).`,
    };
  }

  const bd = await resolveEmployee(supabase, str(formData, "bd_pick"), str(formData, "nama_bd_manual"));
  const ops = await resolveEmployee(
    supabase,
    str(formData, "ops_pick"),
    str(formData, "nama_ops_manual")
  );
  if (!bd.name) return { error: "Nama BD wajib diisi." };
  if (!ops.name) return { error: "Nama OPS wajib diisi." };

  const kategoriPoi = str(formData, "kategori_poi");
  if (!(KATEGORI_BRAND as readonly string[]).includes(kategoriPoi)) {
    return { error: "Kategori POI tidak valid." };
  }

  const namaPic = str(formData, "nama_pic_poi");
  if (!namaPic) return { error: "Nama & posisi PIC POI wajib diisi." };
  const kontakWa = str(formData, "kontak_wa");
  if (!kontakWa.replace(/\D/g, "")) return { error: "Nomor WhatsApp PIC wajib diisi." };

  const bentuk = str(formData, "bentuk_kerjasama");
  if (!(BENTUK_KERJASAMA as readonly string[]).includes(bentuk)) {
    return { error: "Bentuk kerja sama tidak valid." };
  }
  const nominalRaw = str(formData, "nominal");
  const nominal = bentuk === "Berbayar" ? Number(nominalRaw || 0) : 0;
  if (bentuk === "Berbayar" && (!Number.isFinite(nominal) || nominal <= 0)) {
    return { error: "Nominal deals untuk kerja sama Berbayar wajib lebih dari 0." };
  }

  const benefitPick = str(formData, "benefit_diberikan");
  const benefit = benefitPick === MANUAL ? str(formData, "benefit_diberikan_manual") : benefitPick;
  if (!benefit) return { error: "Benefit yang diberikan wajib diisi." };

  const visitMulai = jakartaInputToIso(str(formData, "visit_mulai"));
  const visitBerakhir = jakartaInputToIso(str(formData, "visit_berakhir"));
  if (!visitMulai || !visitBerakhir) {
    return { error: "Tanggal & jam Visit Dimulai serta Visit Berakhir wajib diisi." };
  }
  if (new Date(visitMulai) > new Date(visitBerakhir)) {
    return { error: "Visit Dimulai tidak boleh melebihi Visit Berakhir." };
  }

  const jumlahKreator = Number(str(formData, "jumlah_kreator") || 1);
  if (!Number.isInteger(jumlahKreator) || jumlahKreator < 1) {
    return { error: "Jumlah kreator minimal 1." };
  }
  const jumlahKonten = optNum(str(formData, "jumlah_konten"));
  if (jumlahKonten === undefined) return { error: "Jumlah konten tidak valid." };
  const totalJamLive = optNum(str(formData, "total_jam_live"));
  if (totalJamLive === undefined) return { error: "Total jam live tidak valid." };

  let durasiMulai: string | null = null;
  let durasiAkhir: string | null = null;
  if (kategoriPoi === KATEGORI_WAJIB_DURASI) {
    durasiMulai = str(formData, "durasi_kerjasama_mulai") || null;
    durasiAkhir = str(formData, "durasi_kerjasama_akhir") || null;
    if (!durasiMulai || !durasiAkhir) {
      return {
        error: `Untuk kategori POI ${KATEGORI_WAJIB_DURASI}, tanggal awal & akhir Durasi Kerjasama wajib diisi.`,
      };
    }
    if (durasiMulai > durasiAkhir) {
      return { error: "Tanggal awal Durasi Kerjasama tidak boleh melebihi tanggal akhir." };
    }
  }

  return {
    payload: {
      crm_lead_id: lead.id,
      nama_poi: lead.brand,
      nama_bd: bd.name,
      bd_id: bd.id,
      nama_ops: ops.name,
      ops_id: ops.id,
      kategori_poi: kategoriPoi,
      nama_pic_poi: namaPic,
      kontak_wa: kontakWa,
      bentuk_kerjasama: bentuk,
      nominal,
      benefit_diberikan: benefit,
      visit_mulai: visitMulai,
      visit_berakhir: visitBerakhir,
      jumlah_kreator: jumlahKreator,
      jumlah_konten: jumlahKonten,
      total_jam_live: totalJamLive,
      link_brief: str(formData, "link_brief") || null,
      durasi_kerjasama_mulai: durasiMulai,
      durasi_kerjasama_akhir: durasiAkhir,
    },
  };
}

// ---------------------------------------------------------------------------
// PENDATAAN TRANSAKSI — catat transaksi baru
// ---------------------------------------------------------------------------
export async function createCrmTransaksi(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const built = await buildPayload(supabase, formData);
  if ("error" in built) return { ok: false, message: built.error };

  const { data, error } = await supabase
    .from("crm_transaksi")
    .insert({ ...built.payload, is_bulk_import: false })
    .select("code")
    .maybeSingle();
  if (error) return { ok: false, message: `Gagal menyimpan transaksi: ${error.message}` };

  revalidatePath("/deals");
  revalidatePath("/leads");
  return {
    ok: true,
    message: `Transaksi tercatat${data?.code ? ` dengan ID ${data.code}` : ""}.`,
  };
}

// ---------------------------------------------------------------------------
// EDIT TRANSAKSI — sekaligus melepas flag bulk import
// ---------------------------------------------------------------------------
export async function updateCrmTransaksi(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = str(formData, "id");
  if (!id) return { ok: false, message: "Transaksi tidak dipilih." };

  const built = await buildPayload(supabase, formData);
  if ("error" in built) return { ok: false, message: built.error };

  const { error } = await supabase
    .from("crm_transaksi")
    .update({ ...built.payload, is_bulk_import: false })
    .eq("id", id);
  if (error) return { ok: false, message: `Gagal memperbarui transaksi: ${error.message}` };

  revalidatePath("/deals");
  return { ok: true, message: "Transaksi berhasil diperbarui." };
}

// ---------------------------------------------------------------------------
// IMPORT BULK TRANSAKSI — satu transaksi per baris, dikunci ke ID lead CRM
// ---------------------------------------------------------------------------
// Kolom (pemisah tab / ; / ,), urutan sama dengan importBulkTransaksi() Apps Script:
//   kode_lead, bentuk_kerjasama, nominal, benefit, visit_mulai, visit_berakhir,
//   jumlah_kreator, jumlah_konten, link_brief, nama_ops, total_jam_live
// visit_* menerima "YYYY-MM-DDTHH:mm" atau "YYYY-MM-DD" (jam default 00:00 WIB).
export async function importCrmTransaksiBulk(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const raw = str(formData, "bulk");
  if (!raw) return { ok: false, message: "Konten teks bulk transaksi kosong." };

  // Peta kode lead -> data lead, hanya yang berstatus Dealing/Renewal.
  const { data: leadsRaw, error: leadsErr } = await supabase
    .from("crm_leads")
    .select("id, code, brand, nama_bd, bd_id, kategori_brand, nama_pic, kontak_pic, status")
    .in("status", ["Dealing", "Renewal"]);
  if (leadsErr) return { ok: false, message: `Gagal memuat daftar lead: ${leadsErr.message}` };

  const byCode = new Map<string, NonNullable<typeof leadsRaw>[number]>();
  for (const l of leadsRaw ?? []) {
    if (l.code) byCode.set(l.code.trim().toUpperCase(), l);
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let inserted = 0;
  const notFound: string[] = [];
  const errors: string[] = [];

  for (const line of lines) {
    const parts = (line.includes("\t") ? line.split("\t") : line.split(/[;,]/)).map((p) => p.trim());
    const kode = (parts[0] ?? "").toUpperCase();
    if (!kode) continue;

    const lead = byCode.get(kode);
    if (!lead) {
      notFound.push(kode);
      continue;
    }

    const bentukRaw = (parts[1] ?? "Free").toLowerCase();
    const bentuk = bentukRaw === "berbayar" ? "Berbayar" : "Free";
    const nominal = bentuk === "Berbayar" ? Number(parts[2] || 0) : 0;
    if (bentuk === "Berbayar" && (!Number.isFinite(nominal) || nominal <= 0)) {
      if (errors.length < 3) errors.push(`${kode}: nominal berbayar harus > 0`);
      continue;
    }

    const visitMulai =
      jakartaInputToIso(parts[4] ?? "") ?? jakartaInputToIso(`${parts[4] ?? ""}T00:00`);
    const visitBerakhir =
      jakartaInputToIso(parts[5] ?? "") ?? jakartaInputToIso(`${parts[5] ?? ""}T00:00`);
    if (!visitMulai || !visitBerakhir) {
      if (errors.length < 3) errors.push(`${kode}: tanggal visit tidak valid`);
      continue;
    }

    const kategori = lead.kategori_brand;
    // Kategori Dining wajib durasi kerjasama — tidak ada kolomnya di format bulk,
    // jadi diisi dari rentang visit dan bisa dikoreksi lewat Edit setelahnya.
    const durasiMulai = kategori === KATEGORI_WAJIB_DURASI ? visitMulai.slice(0, 10) : null;
    const durasiAkhir = kategori === KATEGORI_WAJIB_DURASI ? visitBerakhir.slice(0, 10) : null;

    // nama_ops & kontak_wa NOT NULL di DB. Kalau kolom OPS kosong dan lead belum
    // punya kontak PIC, baris dilewati dengan pesan jelas — lebih baik daripada
    // menyimpan nilai karangan yang terlihat valid.
    const namaOps = parts[9] || "";
    if (!namaOps) {
      if (errors.length < 3) errors.push(`${kode}: kolom nama_ops wajib diisi`);
      continue;
    }
    if (!(lead.kontak_pic ?? "").replace(/\D/g, "")) {
      if (errors.length < 3) errors.push(`${kode}: lead belum punya kontak PIC`);
      continue;
    }

    const jumlahKonten = parts[7] ? Number(parts[7]) : null;
    const totalJamLive = parts[10] ? Number(parts[10]) : null;

    const { error } = await supabase.from("crm_transaksi").insert({
      crm_lead_id: lead.id,
      nama_poi: lead.brand,
      nama_bd: lead.nama_bd,
      bd_id: lead.bd_id,
      nama_ops: namaOps,
      kategori_poi: kategori,
      nama_pic_poi: lead.nama_pic || "(belum diisi)",
      kontak_wa: lead.kontak_pic,
      bentuk_kerjasama: bentuk,
      nominal,
      benefit_diberikan: parts[3] || "Free Voucher / Barter",
      visit_mulai: visitMulai,
      visit_berakhir: visitBerakhir,
      jumlah_kreator: Number(parts[6] || 1) >= 1 ? Number(parts[6] || 1) : 1,
      jumlah_konten: jumlahKonten !== null && Number.isFinite(jumlahKonten) ? jumlahKonten : null,
      total_jam_live: totalJamLive !== null && Number.isFinite(totalJamLive) ? totalJamLive : null,
      link_brief: parts[8] || null,
      durasi_kerjasama_mulai: durasiMulai,
      durasi_kerjasama_akhir: durasiAkhir,
      is_bulk_import: true,
    });

    if (error) {
      if (errors.length < 3) errors.push(`${kode}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  revalidatePath("/deals");
  return {
    ok: inserted > 0,
    message:
      `Impor transaksi selesai: ${inserted} masuk dari ${lines.length} baris.` +
      (notFound.length > 0 ? `\n${notFound.length} kode lead tidak ditemukan / bukan Dealing-Renewal: ${notFound.slice(0, 5).join(", ")}${notFound.length > 5 ? "…" : ""}` : "") +
      (errors.length > 0 ? `\nContoh error: ${errors.join(" | ")}` : ""),
  };
}

// ---------------------------------------------------------------------------
// HAPUS TRANSAKSI
// ---------------------------------------------------------------------------
export async function deleteCrmTransaksi(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const { supabase, user } = await ctx();
  if (!user) return { ok: false, message: "Tidak terautentikasi." };

  const id = str(formData, "id");
  if (!id) return { ok: false, message: "Transaksi tidak dipilih." };

  const { error } = await supabase.from("crm_transaksi").delete().eq("id", id);
  if (error) return { ok: false, message: `Gagal menghapus transaksi: ${error.message}` };

  revalidatePath("/deals");
  return { ok: true, message: "Transaksi berhasil dihapus." };
}
