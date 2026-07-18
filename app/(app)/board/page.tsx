import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser } from "@/lib/supabase/server";
import { durasi, tanggal } from "@/lib/format";

// M11 Merchant Board — murni proyeksi v_merchant_board (read-and-coordinate).
// Aksi status tetap di modul divisi masing-masing.

type Card = {
  merchant_id: string;
  merchant_code: string | null;
  merchant_name: string;
  am_name: string | null;
  brief_id: string;
  brief_code: string | null;
  division: string;
  service_type: string;
  brief_status: string;
  priority: string;
  due_date: string | null;
  completion_pct: number | null;
  units_total: number;
  units_done: number;
  units_in_review: number;
  revision_total: number;
  flag_revision: boolean;
  flag_overdue: boolean;
  flag_blocked: boolean;
  flag_pending_block: boolean;
  kanban_column: string;
  pic_name: string | null;
  work_time_seconds: number;
  timer_started_at: string | null;
};

const KOLOM = [
  "[Intake]",
  "[Planning]",
  "[In Execution]",
  "[In Review]",
  "[Completed]",
  "[Blocked]",
] as const;

const KOLOM_LABEL: Record<string, string> = {
  "[Intake]": "Intake",
  "[Planning]": "Planning",
  "[In Execution]": "In Execution",
  "[In Review]": "In Review",
  "[Completed]": "Completed",
  "[Blocked]": "Blocked",
};

function waktuKerja(c: Card): string {
  let sec = Number(c.work_time_seconds);
  if (c.timer_started_at) {
    sec += Math.max(0, (Date.now() - new Date(c.timer_started_at).getTime()) / 1000);
  }
  return durasi(sec);
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ merchant?: string }>;
}) {
  const { merchant } = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await getCachedClient();
  const { data } = await supabase
    .from("v_merchant_board")
    .select(
      "merchant_id, merchant_code, merchant_name, am_name, brief_id, brief_code, division, service_type, brief_status, priority, due_date, completion_pct, units_total, units_done, units_in_review, revision_total, flag_revision, flag_overdue, flag_blocked, flag_pending_block, kanban_column, pic_name, work_time_seconds, timer_started_at"
    )
    .order("merchant_name")
    .order("brief_code");

  const all = (data as Card[] | null) ?? [];
  const merchants = [...new Map(all.map((c) => [c.merchant_id, c])).values()];
  const activeMerchant = merchant ?? merchants[0]?.merchant_id ?? null;
  const cards = all.filter((c) => c.merchant_id === activeMerchant);
  const info = cards[0];

  return (
    <>
      <h1>Merchant Board</h1>
      <p className="page-sub">
        Satu papan per merchant: semua Brief lintas divisi dipetakan ke 6 kolom kanonik
        (prioritas Blocked &gt; In Review &gt; In Execution &gt; Planning &gt; Intake &gt;
        Completed). Papan ini read-only — aksi status tetap di modul divisi.
      </p>

      {merchants.length === 0 ? (
        <div className="card">Belum ada Brief yang bisa ditampilkan untuk role Anda.</div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <strong>Merchant:</strong>{" "}
            {merchants.map((m) => (
              <Link
                key={m.merchant_id}
                href={`/board?merchant=${m.merchant_id}`}
                className={m.merchant_id === activeMerchant ? "btn" : "btn-ghost"}
                style={{ marginRight: 8 }}
              >
                {m.merchant_name} ({m.merchant_code ?? "—"})
              </Link>
            ))}
            {info && (
              <div style={{ marginTop: 8, color: "#64748b" }}>
                AM: {info.am_name ?? "—"} · {cards.length} kartu Brief
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
            {KOLOM.map((k) => {
              const col = cards.filter((c) => c.kanban_column === k);
              return (
                <div key={k} className="card" style={{ padding: 10 }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>
                    {KOLOM_LABEL[k]} <span className="badge gray">{col.length}</span>
                  </div>
                  {col.map((c) => (
                    <div
                      key={c.brief_id}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderLeft: `4px solid ${
                          c.flag_blocked || c.flag_pending_block
                            ? "#dc2626"
                            : c.flag_overdue
                              ? "#d97706"
                              : "#2563eb"
                        }`,
                        borderRadius: 8,
                        padding: 8,
                        marginBottom: 8,
                        fontSize: 13,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{c.brief_code}</div>
                      <div>
                        {c.division} · {c.service_type}
                      </div>
                      <div>
                        {c.units_done}/{c.units_total} unit · {Number(c.completion_pct ?? 0)}%
                      </div>
                      <div style={{ color: "#64748b" }}>
                        PIC {c.pic_name ?? "—"} · due {tanggal(c.due_date)} · ⏱ {waktuKerja(c)}
                        {c.timer_started_at ? " · berjalan" : ""}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        {c.flag_overdue && <span className="badge red">Overdue</span>}{" "}
                        {c.flag_revision && (
                          <span className="badge amber">Revisi ×{c.revision_total}</span>
                        )}{" "}
                        {c.flag_pending_block && (
                          <span className="badge amber">Block pending</span>
                        )}{" "}
                        {c.flag_blocked && <span className="badge red">Blocked</span>}{" "}
                        {c.units_in_review > 0 && (
                          <span className="badge amber">{c.units_in_review} in review</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {col.length === 0 && <div style={{ color: "#94a3b8", fontSize: 13 }}>—</div>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
