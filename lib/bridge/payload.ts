// Bridge MSDPS→CDPS Fase 1 — payload builder (v1). Built EXACTLY against
// docs/BRIDGE_MSDPS_CONTRACT.md (single source of truth, both repos build
// against that file — neither infers the shape from the other's code).
//
// Pure: takes already-fetched rows in, returns the wire-shape object out. No
// Supabase call happens here — that lives in the caller (lib/actions/bridge.ts),
// which is what keeps this file unit-testable without a DB (scripts/qc_bridge_payload.mjs).

export const PAYLOAD_VERSI = 1;

export interface BridgeDealRow {
  code: string; // brand_deals.code — immutable (trigger brand_deals_validate, 0355:242)
  brand_name: string;
  shop_id: string | null;
  kategori_poi: string | null; // DB spelling verbatim, e.g. "Accomodation" (sic) — never renamed here
  pic_name: string | null;
  pic_whatsapp: string | null;
  tanggal_mulai_kontrak: string | null; // date column — already a YYYY-MM-DD calendar string, no visit window
  tanggal_akhir_kontrak: string | null;
}

export interface BridgeBdRow {
  full_name: string;
}

export interface BridgeTransactionRow {
  code: string | null; // TRX-YYYYMM-NNNN
  total_agreed_value: number | string;
  released_to_account_at: string; // timestamptz — gate already guarantees non-null
}

export interface BridgeFinanceVerifierRow {
  full_name: string;
}

export interface BridgeMerchantRow {
  id: string;
  kota: string;
}

export interface BridgeLineRow {
  jenis: "Account" | "Ads" | "Creative" | "Store Operation" | "KOL-Non-Roster" | "Live Stream";
  qty: number | null;
  catatan: string | null;
  alasan_non_roster: string | null;
  nilai_cross_charge: number | string | null;
}

export interface BridgeSourceRow {
  deal: BridgeDealRow;
  bd: BridgeBdRow | null;
  transaction: BridgeTransactionRow;
  // Employee behind transactions.status_changed_by at time of verification —
  // the Finance staff who verified the PAYMENT. Distinct from `bd` (the BD who
  // brought the MERCHANT) — the fixture's two different names ("Andi Saputra"
  // vs "Finance MSDPS — Rina W.") are not the same person and must never
  // collapse to the same source field (a bug this builder had once — see
  // scripts/qc_bridge_payload.mjs assertion that the two differ).
  financeVerifier: BridgeFinanceVerifierRow | null;
  merchant: BridgeMerchantRow;
  lines: BridgeLineRow[];
  // Bridge otomatis (migrasi 0377): deal boleh diteruskan sejak DP. Kalau
  // diisi, ringkasan pembayaran ("DP 30% — Rp 4.500.000 dari Rp 15.000.000")
  // ditambahkan ke `catatan` SETIAP baris — field string bebas yang sudah ada
  // di kontrak v1, jadi tidak ada field baru yang bisa ditolak validator CDPS.
  // Tidak diisi ⇒ output identik dengan sebelumnya (fixture v1 tetap cocok).
  paymentInfo?: BridgePaymentInfo | null;
  // Migrasi 0378 (membalik D7): Baseline & Target GMV diisi BD di MSDPS.
  // Pola sama dengan paymentInfo — tidak diisi ⇒ output identik v1 (fixture
  // tetap cocok). Yang mengisinya hanya enqueue.ts, dan hanya bila flag
  // BRIDGE_KIRIM_MERCHANT_TARGET=1 (sesudah validator CDPS menerima kunci ini).
  merchantTarget?: BridgeMerchantTargetRow | null;
}

export interface BridgeMerchantTargetRow {
  merchant_gmv_baseline: number | string | null; // brand_deals (0378) — BUKAN brand_deals.target_gmv (campaign, 0342)
  merchant_target_gmv: number | string | null;
  link_akun_merchant: string | null;
  kategori_merchant: string | null;
}

export interface BridgePaymentInfo {
  amount_verified: number | string;
  total_agreed_value: number | string;
}

export interface BridgeOrderPayloadV1 {
  payload_versi: 1;
  deal_code: string;
  bd_identitas: string;
  merchant: {
    external_id: string;
    nama: string;
    kota: string;
    kategori_poi: string;
    pic_nama: string;
    pic_whatsapp: string | null;
    tanggal_mulai_kontrak: string;
    tanggal_akhir_kontrak: string;
  };
  attestation: {
    external_trx_ref: string;
    bentuk_kerjasama: "Berbayar";
    nilai: string | null;
    diverifikasi_pada: string;
    diverifikasi_oleh_external: string | null;
  };
  lines: Array<{
    jenis: BridgeLineRow["jenis"];
    qty: number | null;
    catatan: string | null;
    alasan_non_roster: string | null;
    nilai_cross_charge: string | null;
  }>;
  // OPSIONAL, aditif (bukan kontrak v1 asli — payload_versi tetap 1). Hanya
  // ada bila deal punya target_gmv DAN flag pengiriman aktif. Uang = string
  // desimal seperti attestation.nilai. Lihat docs/DECISIONS.md 2026-11-06.
  merchant_target?: {
    gmv_baseline: string | null;
    target_gmv: string;
    link_akun: string | null;
    kategori: string | null;
  };
}

/** Integer-rupiah decimal string, never a float, never localized. "15000000.00", not "15.000.000". */
function moneyString(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/** "Rp 15.000.000" — integer rupiah, titik ribuan, tanpa desimal (teks untuk manusia, bukan nilai mesin). */
function rupiahText(n: number): string {
  const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp ${s}`;
}

/**
 * Persentase pembayaran terverifikasi, dibulatkan ke bawah ke 1 desimal —
 * ke bawah supaya 99,96% tidak pernah tampil "100%" padahal belum lunas.
 */
export function paidPercent(info: BridgePaymentInfo): number | null {
  const paid = Number(info.amount_verified);
  const total = Number(info.total_agreed_value);
  if (!Number.isFinite(paid) || !Number.isFinite(total) || total <= 0) return null;
  if (paid >= total) return 100;
  return Math.floor((paid / total) * 1000) / 10;
}

/** Teks ringkasan pembayaran untuk catatan baris bridge. */
export function paymentSummaryText(info: BridgePaymentInfo): string | null {
  const pct = paidPercent(info);
  if (pct === null) return null;
  const paid = Number(info.amount_verified);
  const total = Number(info.total_agreed_value);
  const pctText = pct.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  if (pct >= 100) return `[Pembayaran klien: LUNAS 100% — ${rupiahText(total)}]`;
  return `[Pembayaran klien saat diteruskan: DP ${pctText}% — ${rupiahText(paid)} dari ${rupiahText(total)}]`;
}

/**
 * Builds the v1 bridge payload. Throws (never silently defaults) when a
 * mandatory contract field is missing on the source row — a deal that passed
 * deal_bridge_lines_gate() should always have these, so a throw here means
 * the DB and this builder have drifted, not that the deal is merely incomplete.
 */
export function buildBridgePayload(row: BridgeSourceRow): BridgeOrderPayloadV1 {
  const { deal, bd, transaction, financeVerifier, merchant, lines, paymentInfo, merchantTarget } = row;
  const paymentNote = paymentInfo ? paymentSummaryText(paymentInfo) : null;

  if (!deal.kategori_poi) throw new Error("deal.kategori_poi kosong — payload bridge butuh kategori POI");
  if (!deal.pic_name || !deal.pic_whatsapp) throw new Error("deal.pic_name/pic_whatsapp kosong");
  if (!deal.tanggal_mulai_kontrak || !deal.tanggal_akhir_kontrak) {
    throw new Error("deal.tanggal_mulai_kontrak/tanggal_akhir_kontrak kosong");
  }
  if (lines.length === 0) throw new Error("payload bridge butuh minimal satu baris (lines)");

  const bdIdentitas = bd?.full_name?.trim();
  if (!bdIdentitas) throw new Error("bd.full_name kosong — bd_id deal ini tidak bisa diresolusi ke employees");
  if (!transaction.code) throw new Error("transaction.code kosong — transaksi Finance untuk deal ini belum ber-kode TRX-");

  // Glosarium trap (GLOSARIUM.md:9-31): merchant = brand/POI di sini, TIDAK
  // PERNAH kolom TikTok export "Merchant" (OTA/delivery platform, otaPlatformsRaw).
  const externalId = deal.shop_id && deal.shop_id.trim() !== "" ? deal.shop_id : merchant.id;

  const targetGmv = merchantTarget ? moneyString(merchantTarget.merchant_target_gmv) : null;

  return {
    payload_versi: PAYLOAD_VERSI,
    deal_code: deal.code,
    bd_identitas: bdIdentitas,
    merchant: {
      external_id: externalId,
      nama: deal.brand_name,
      kota: merchant.kota,
      kategori_poi: deal.kategori_poi,
      pic_nama: deal.pic_name,
      pic_whatsapp: deal.pic_whatsapp,
      tanggal_mulai_kontrak: deal.tanggal_mulai_kontrak,
      tanggal_akhir_kontrak: deal.tanggal_akhir_kontrak,
    },
    attestation: {
      external_trx_ref: transaction.code,
      bentuk_kerjasama: "Berbayar",
      nilai: moneyString(transaction.total_agreed_value),
      diverifikasi_pada: transaction.released_to_account_at,
      diverifikasi_oleh_external: financeVerifier ? `Finance MSDPS — ${financeVerifier.full_name}` : null,
    },
    lines: lines.map((l) => ({
      jenis: l.jenis,
      qty: l.qty,
      catatan: paymentNote ? (l.catatan ? `${l.catatan} ${paymentNote}` : paymentNote) : l.catatan,
      alasan_non_roster: l.alasan_non_roster,
      nilai_cross_charge: moneyString(l.nilai_cross_charge),
    })),
    // Deal tanpa target_gmv (sebelum 0378) ⇒ blok tidak dikirim sama sekali.
    ...(merchantTarget && targetGmv
      ? {
          merchant_target: {
            gmv_baseline: moneyString(merchantTarget.merchant_gmv_baseline),
            target_gmv: targetGmv,
            link_akun: merchantTarget.link_akun_merchant?.trim() || null,
            kategori: merchantTarget.kategori_merchant?.trim() || null,
          },
        }
      : {}),
  };
}

/** '<DEAL code>:<payload_versi>' — brand_deals.code is always present & immutable. */
export function bridgeIdempotencyKey(dealCode: string): string {
  return `${dealCode}:${PAYLOAD_VERSI}`;
}
