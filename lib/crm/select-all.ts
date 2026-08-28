import type { PostgrestError } from "@supabase/supabase-js";
import type { createClient } from "@/lib/supabase/server";
import { supabaseProjectLabel } from "@/lib/supabase/project-ref";

// PostgREST memotong hasil di 1000 baris (`db-max-rows`) TANPA error, jadi
// `select()` tanpa paginasi diam-diam menyembunyikan data begitu tabel tumbuh.
// Semua listing CRM (leads & transaksi) lewat helper ini.
const PAGE = 1000;

// Tabel belum ada di database yang dipakai runtime: 42P01 = undefined_table
// (Postgres), PGRST205 = schema cache PostgREST belum mengenal tabelnya.
const MISSING_TABLE = new Set(["42P01", "PGRST205"]);

type Client = Awaited<ReturnType<typeof createClient>>;

export type SelectAllResult<T> = { rows: T[]; error: string | null };

function describe(table: string, error: PostgrestError): string {
  if (error.code && MISSING_TABLE.has(error.code)) {
    return (
      `Tabel "${table}" tidak ada di project Supabase yang dibaca deployment ini: ` +
      `${supabaseProjectLabel()}. ` +
      `Kalau project itu BUKAN yang Anda maksud, perbaiki NEXT_PUBLIC_SUPABASE_URL / ` +
      `NEXT_PUBLIC_SUPABASE_ANON_KEY di Vercel → Settings → Environment Variables dan scope-kan ` +
      `ke branch yang benar (docs/STAGING.md §3), lalu redeploy. Kalau project itu memang benar, ` +
      `terapkan migrasi supabase/migrations/0321_crm_leads_transaksi.sql ke sana.`
    );
  }
  return `Gagal memuat "${table}": ${error.message}${error.code ? ` (${error.code})` : ""}`;
}

// Mengembalikan error sebagai NILAI, bukan throw: kegagalan satu query tidak
// boleh menjatuhkan seluruh halaman jadi 500 tanpa keterangan (pola yang sama
// dipakai /campaigns dan /meago/creators untuk service-role yang tidak ada).
export async function selectAll<T>(
  supabase: Client,
  table: string,
  columns: string,
  order?: { column: string; ascending?: boolean }
): Promise<SelectAllResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (order) query = query.order(order.column, { ascending: order.ascending ?? true });

    const { data, error } = await query;
    if (error) return { rows, error: describe(table, error) };

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return { rows, error: null };
  }
}
