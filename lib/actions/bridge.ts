"use server";

// Bridge MSDPS→CDPS Fase 1 — server action `addBridgeLines` (B3). Validasi TS
// di sini hanya untuk pesan per-field yang ramah (pola readDealFields,
// deals.ts:112-115) — trigger DB (deal_bridge_lines_gate, migrasi 0360) tetap
// otoritas akhir untuk gerbang pembayaran (D4+D13).
//
// TIDAK PERNAH mengirim ke CDPS inline dari sini — hanya mengantre satu baris
// cdps_outbox. Delivery job (app/api/internal/bridge/deliver/route.ts) yang
// benar-benar mem-POST; CDPS mati tidak boleh menggagalkan save-nya BD.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buildBridgePayload, bridgeIdempotencyKey, type BridgeLineRow } from "@/lib/bridge/payload";

export type ActionResult = { ok: boolean; message: string };

type Me = { id: string; division: string; is_od: boolean; is_director: boolean };

async function ctx() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, me: null as Me | null };
  const { data: me } = await supabase
    .from("employees")
    .select("id, division, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();
  return { supabase, user, me: me as Me | null };
}

// Cermin canManageDeals() (lib/actions/deals.ts) DAN can_manage_bridge() SQL
// (migrasi 0360) — satu wewenang, tiga salinan (TS server action, SQL RLS/trigger,
// pesan ramah) karena repo ini tidak punya lapisan domain bersama seperti CDPS.
function canManageBridge(me: Me | null): boolean {
  return !!me && (me.is_od || me.is_director || me.division === "BizDev" || me.division === "CreatorManagement");
}

const JENIS_VALUES = ["Account", "Ads", "Creative", "Store Operation", "KOL-Non-Roster"] as const;
type Jenis = (typeof JENIS_VALUES)[number];
function isJenis(v: string): v is Jenis {
  return (JENIS_VALUES as readonly string[]).includes(v);
}

// Bentuk kiriman satu baris dari modal "Teruskan ke CDPS" (B4) — dikirim sebagai
// SATU field JSON (`lines_json`) dalam satu <form>, bukan input bernama per-baris:
// React 19/Next 15 membuang name/value submitter dari FormData (aturan UI repo
// ini, BUILD_PLAN.md:46), jadi array baris harus dikemas jadi satu string.
type LineInput = {
  jenis?: string;
  qty?: string;
  catatan?: string;
  alasan_non_roster?: string;
  nilai_cross_charge?: string;
};

export async function addBridgeLines(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { supabase, user, me } = await ctx();
  if (!user || !me) return { ok: false, message: "Tidak terautentikasi." };
  if (!canManageBridge(me)) return { ok: false, message: "Tidak berwenang meneruskan deal ke CDPS." };

  const dealId = String(formData.get("deal_id") ?? "").trim();
  if (!dealId) return { ok: false, message: "Deal tidak valid." };

  let lineInputs: LineInput[];
  try {
    const raw = JSON.parse(String(formData.get("lines_json") ?? "[]"));
    if (!Array.isArray(raw)) throw new Error("bukan array");
    lineInputs = raw;
  } catch {
    return { ok: false, message: "Data baris bridge tidak valid." };
  }
  if (lineInputs.length === 0) {
    return { ok: false, message: "Pilih minimal satu layanan untuk diteruskan ke CDPS." };
  }

  const lines: BridgeLineRow[] = [];
  for (let i = 0; i < lineInputs.length; i++) {
    const li = lineInputs[i];
    const jenis = String(li.jenis ?? "").trim();
    if (!isJenis(jenis)) return { ok: false, message: `Baris ${i + 1}: jenis layanan tidak dikenal.` };
    const alasan = String(li.alasan_non_roster ?? "").trim();
    if (jenis === "KOL-Non-Roster" && alasan === "") {
      return { ok: false, message: `Baris ${i + 1}: KOL-Non-Roster wajib mengisi alasan non-roster.` };
    }
    const qtyRaw = String(li.qty ?? "").trim();
    const qty = qtyRaw === "" ? null : Number(qtyRaw);
    if (qty !== null && !Number.isFinite(qty)) return { ok: false, message: `Baris ${i + 1}: qty tidak valid.` };
    const nccRaw = String(li.nilai_cross_charge ?? "").trim();
    const nilai_cross_charge = nccRaw === "" ? null : Number(nccRaw);
    if (nilai_cross_charge !== null && !Number.isFinite(nilai_cross_charge)) {
      return { ok: false, message: `Baris ${i + 1}: nilai cross-charge tidak valid.` };
    }
    lines.push({
      jenis,
      qty,
      catatan: String(li.catatan ?? "").trim() || null,
      alasan_non_roster: alasan || null,
      nilai_cross_charge,
    });
  }

  // Satu order per deal seumur Fase 1 — idempotency_key terkunci ke
  // "<DEAL code>:1" (payload_versi selalu 1), jadi tidak ada mekanisme "tambah
  // baris ke order yang sudah terkirim" (lihat docs/BRIDGE_MSDPS_CONTRACT.md).
  const { data: existingOutbox } = await supabase
    .from("cdps_outbox")
    .select("id")
    .eq("deal_id", dealId)
    .maybeSingle();
  if (existingOutbox) return { ok: false, message: "Deal ini sudah pernah diteruskan ke CDPS." };

  const { data: deal, error: dealErr } = await supabase
    .from("brand_deals")
    .select(
      "id, code, brand_name, shop_id, kategori_poi, pic_name, pic_whatsapp, tanggal_mulai_kontrak, tanggal_akhir_kontrak, bd_id, bentuk_kerjasama, transaction_id"
    )
    .eq("id", dealId)
    .single();
  if (dealErr || !deal) return { ok: false, message: "Deal tidak ditemukan." };

  // Cermin gerbang trigger deal_bridge_lines_gate — pesan sama persis, tapi DB
  // tetap yang benar-benar menegakkan (IS DISTINCT FROM, bukan <>, di sana).
  if (deal.bentuk_kerjasama !== "Berbayar") {
    return { ok: false, message: "[deal free/barter tidak dikerjakan CDPS]" };
  }
  if (!deal.transaction_id) {
    return { ok: false, message: "[pembayaran belum terverifikasi, deal belum bisa diteruskan]" };
  }

  const { data: bd } = await supabase.from("employees").select("full_name").eq("id", deal.bd_id).maybeSingle();

  const { data: trx, error: trxErr } = await supabase
    .from("transactions")
    .select("code, total_agreed_value, released_to_account_at, merchant_id, status_changed_by")
    .eq("id", deal.transaction_id)
    .single();
  if (trxErr || !trx) return { ok: false, message: "Transaksi Finance untuk deal ini tidak ditemukan." };
  if (!trx.released_to_account_at) {
    return { ok: false, message: "[pembayaran belum terverifikasi, deal belum bisa diteruskan]" };
  }

  const financeVerifier = trx.status_changed_by
    ? (await supabase.from("employees").select("full_name").eq("id", trx.status_changed_by).maybeSingle()).data
    : null;

  const { data: merchant, error: merchantErr } = await supabase
    .from("merchants")
    .select("id, kota")
    .eq("id", trx.merchant_id)
    .single();
  if (merchantErr || !merchant) return { ok: false, message: "Merchant untuk transaksi ini tidak ditemukan." };

  let payload;
  try {
    payload = buildBridgePayload({
      deal,
      bd: bd ?? null,
      transaction: trx,
      financeVerifier: financeVerifier ?? null,
      merchant,
      lines,
    });
  } catch (e) {
    return { ok: false, message: `Data deal belum lengkap untuk dibridge: ${(e as Error).message}` };
  }

  // Payload sudah divalidasi LENGKAP sebelum tulisan apa pun ke DB — jendela
  // "lines tersimpan tapi outbox gagal" (dua insert terpisah, bukan satu
  // transaksi — supabase-js tidak punya itu) diminimalkan ke kegagalan
  // transien murni, bukan data tidak lengkap.
  const { error: linesErr } = await supabase.from("deal_bridge_lines").insert(
    lines.map((l) => ({
      deal_id: dealId,
      jenis: l.jenis,
      qty: l.qty,
      catatan: l.catatan,
      alasan_non_roster: l.alasan_non_roster,
      nilai_cross_charge: l.nilai_cross_charge,
    }))
  );
  if (linesErr) return { ok: false, message: linesErr.message };

  const { error: outboxErr } = await supabase.from("cdps_outbox").insert({
    deal_id: dealId,
    payload,
    idempotency_key: bridgeIdempotencyKey(deal.code),
  });
  if (outboxErr) {
    return {
      ok: false,
      message:
        `Baris bridge tersimpan tapi GAGAL diantre untuk pengiriman (${outboxErr.message}). ` +
        "Jangan input ulang — hubungi engineering untuk memeriksa baris cdps_outbox secara manual.",
    };
  }

  revalidatePath("/deals");
  return { ok: true, message: `${lines.length} layanan untuk ${deal.brand_name} diantre pengiriman ke CDPS.` };
}
