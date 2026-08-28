import type { createClient } from "@/lib/supabase/server";

// PostgREST memotong hasil di 1000 baris (`db-max-rows`) TANPA error, jadi
// `select()` tanpa paginasi diam-diam menyembunyikan data begitu tabel tumbuh.
// Semua listing CRM (leads & transaksi) lewat helper ini.
const PAGE = 1000;

type Client = Awaited<ReturnType<typeof createClient>>;

export async function selectAll<T>(
  supabase: Client,
  table: string,
  columns: string,
  order?: { column: string; ascending?: boolean }
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (order) query = query.order(order.column, { ascending: order.ascending ?? true });

    const { data, error } = await query;
    if (error) throw new Error(`Gagal memuat ${table}: ${error.message}`);

    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}
