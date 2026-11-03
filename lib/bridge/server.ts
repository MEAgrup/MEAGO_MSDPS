// Bridge MSDPS→CDPS otomatis (migrasi 0377) — helper server-side yang dipakai
// bersama oleh server action bridge.ts, deals.ts, dan finance.ts.
//
// SENGAJA bukan file "use server": setiap export file "use server" menjadi
// endpoint Server Action yang bisa dipanggil langsung dari browser.
// tryEnqueueNow memakai service-role — tidak boleh terekspos begitu. Jangan
// pernah meng-import file ini dari komponen "use client".

import { createClient } from "@/lib/supabase/server";
import { createAdminClient, hasAdminEnv } from "@/lib/supabase/admin";
import type { CdpsPlan } from "./plan";
import { enqueueDealIfReady, type EnqueueOutcome } from "./enqueue";

type SupabaseClientLike = Awaited<ReturnType<typeof createClient>>;

/**
 * Simpan (insert/replace) rencana layanan CDPS satu deal lewat sesi pengguna
 * — RLS deal_cdps_plans + trigger guard tetap penjaga terakhir (mis. menolak
 * perubahan sesudah deal diantre ke CDPS). Dipakai juga oleh
 * registerDealTransaction (lib/actions/deals.ts).
 */
export async function upsertCdpsPlan(
  supabase: SupabaseClientLike,
  dealId: string,
  plan: CdpsPlan
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("deal_cdps_plans").upsert(
    {
      deal_id: dealId,
      tidak_perlu: plan.tidak_perlu,
      lines: plan.lines,
    },
    { onConflict: "deal_id" }
  );
  return { error: error?.message ?? null };
}

/**
 * Antre langsung satu deal ke CDPS bila sudah siap (service-role) —
 * best-effort: env service-role belum ada / error apa pun ⇒ diam, sweep cron
 * (app/api/internal/bridge/deliver) tetap akan mengambilnya.
 */
export async function tryEnqueueNow(dealId: string): Promise<EnqueueOutcome | null> {
  if (!hasAdminEnv()) return null;
  try {
    return await enqueueDealIfReady(createAdminClient(), dealId);
  } catch (e) {
    console.error("[bridge] enqueue langsung gagal, menunggu sweep cron:", (e as Error).message);
    return null;
  }
}

/**
 * Antre semua deal yang tertaut ke satu transaksi Finance (dipanggil sesudah
 * verifyPayment). Lewat service-role karena Finance tidak punya akses baca
 * brand_deals (RLS 0342). Best-effort, sama seperti tryEnqueueNow.
 */
export async function tryEnqueueForTransaction(transactionId: string): Promise<EnqueueOutcome[]> {
  if (!hasAdminEnv()) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("brand_deals").select("id").eq("transaction_id", transactionId);
    const outs: EnqueueOutcome[] = [];
    for (const d of (data as { id: string }[] | null) ?? []) outs.push(await enqueueDealIfReady(admin, d.id));
    return outs;
  } catch (e) {
    console.error("[bridge] enqueue sesudah verifikasi gagal, menunggu sweep cron:", (e as Error).message);
    return [];
  }
}

/** Kalimat ramah untuk hasil enqueue — dipakai bridge.ts, deals.ts, finance.ts. */
export function describeEnqueue(out: EnqueueOutcome | null): string {
  if (!out) return "";
  switch (out.status) {
    case "enqueued": {
      const pct = out.paid_percent;
      const bayar = pct === null ? "" : pct >= 100 ? " (Lunas)" : ` (DP ${pct.toLocaleString("id-ID")}%)`;
      return ` Otomatis diteruskan ke CDPS${bayar} — terkirim di siklus pengiriman berikutnya (≤ 10 menit).`;
    }
    case "waiting_payment":
      return " Akan otomatis diteruskan ke CDPS begitu Finance memverifikasi pembayaran (DP pun cukup).";
    case "incomplete":
      return ` Belum bisa diteruskan ke CDPS: ${out.error}`;
    default:
      return "";
  }
}

