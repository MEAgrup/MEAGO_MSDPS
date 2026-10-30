import { redirect } from "next/navigation";
import { getCachedClient, getEmployee } from "@/lib/supabase/server";
import { DIVISIONS, DIVISION_LABELS, isDivision, type Division } from "@/lib/divisions";
import { num } from "@/lib/format";

// Aktivitas Karyawan (migrasi 0376) — feedback Tim OD 26-10-2026.
// Indikator adaptasi pemakaian sistem, BUKAN komponen reward: tanpa peringkat,
// skor, atau ambang; urut nama. Agregasi & gerbang wewenang di RPC
// usage_summary (OD/Director semua divisi, Lead/SPV divisinya, staff ditolak)
// — halaman ini tidak pernah menarik baris mentah.

type Row = {
  period_start: string;
  employee_id: string;
  full_name: string;
  division: string;
  hours: number;
  sessions: number;
  page_views: number;
  last_active: string | null;
};

const TZ = "Asia/Jakarta";
const ALL_MONTHS = "12bulan";

function currentMonthWIB(): string {
  // en-CA → "YYYY-MM-DD"
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

const monthStartWIB = (ym: string) => `${ym}-01T00:00:00+07:00`;

function monthLabel(ym: string): string {
  return new Date(`${ym}-15T00:00:00Z`).toLocaleDateString("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function periodLabel(date: string, weekly: boolean): string {
  if (!weekly) return monthLabel(date.slice(0, 7));
  const d = new Date(`${date}T00:00:00Z`);
  return `Minggu ${d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}`;
}

function waktu(ts: string | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("id-ID", {
    timeZone: TZ,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function jam(h: number): string {
  return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 2 }).format(
    Number(h)
  );
}

export default async function AktivitasPage({
  searchParams,
}: {
  searchParams: Promise<{ bulan?: string; divisi?: string; per?: string }>;
}) {
  const me = await getEmployee();
  const mgmt = !!(me?.is_od || me?.is_director);
  const isLead = me?.rank === "lead";
  if (!me || !(mgmt || isLead)) redirect("/dashboard");

  const sp = await searchParams;
  const supabase = await getCachedClient();
  const { data: since } = await supabase.rpc("usage_recorded_since");
  const sinceTs = (since as string | null) ?? null;

  // Pilihan bulan: dari bulan pertama tercatat s.d. bulan berjalan (maks 12 —
  // retensi data 12 bulan).
  const thisMonth = currentMonthWIB();
  const firstMonth = sinceTs
    ? new Date(sinceTs).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7)
    : thisMonth;
  const months: string[] = [];
  for (let ym = thisMonth; months.length < 12 && ym >= firstMonth; ym = shiftMonth(ym, -1)) {
    months.push(ym);
  }

  const bulan = sp.bulan === ALL_MONTHS || months.includes(sp.bulan ?? "") ? sp.bulan! : thisMonth;
  const weekly = sp.per === "minggu";
  const divisi: Division | null = mgmt && sp.divisi && isDivision(sp.divisi) ? sp.divisi : null;

  const fromYm = bulan === ALL_MONTHS ? months[months.length - 1] : bulan;
  const toYm = bulan === ALL_MONTHS ? shiftMonth(thisMonth, 1) : shiftMonth(bulan, 1);

  const { data, error } = await supabase.rpc("usage_summary", {
    p_from: monthStartWIB(fromYm),
    p_to: monthStartWIB(toYm),
    p_division: divisi,
    p_grain: weekly ? "week" : "month",
  });
  const rows = (data as Row[] | null) ?? [];

  return (
    <>
      <h1>Aktivitas Karyawan</h1>
      <p className="page-sub">
        Rekam pemakaian MSDPS per karyawan: jam, sesi, halaman dibuka, dan terakhir aktif. Ini
        indikator adaptasi sistem — <strong>bukan</strong> komponen penilaian atau reward.
      </p>

      <div className="card">
        <p style={{ marginTop: 0, fontSize: 13, lineHeight: 1.6 }}>
          <span className="badge indigo">
            {sinceTs ? `Tercatat sejak ${waktu(sinceTs)} WIB` : "Belum ada data tercatat"}
          </span>{" "}
          <span style={{ color: "var(--muted)" }}>
            Data sebelum pencatatan dimulai tidak ada dan tidak bisa dibuat surut. Sesi dihitung
            putus bila jeda antar halaman lebih dari 30 menit; jam = lama tiap sesi dari halaman
            pertama sampai terakhir (sesi satu halaman = 0 jam). Data disimpan 12 bulan.
            {!mgmt && (
              <>
                {" "}
                Anda melihat divisi{" "}
                <strong>{DIVISION_LABELS[me.division as Division] ?? me.division}</strong>.
              </>
            )}
          </span>
        </p>

        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}>
          <select name="bulan" defaultValue={bulan} aria-label="Bulan">
            {months.map((ym) => (
              <option key={ym} value={ym}>
                {monthLabel(ym)}
              </option>
            ))}
            <option value={ALL_MONTHS}>Semua (12 bulan terakhir)</option>
          </select>
          <select name="per" defaultValue={weekly ? "minggu" : "bulan"} aria-label="Rincian">
            <option value="bulan">Per bulan</option>
            <option value="minggu">Per minggu</option>
          </select>
          {mgmt && (
            <select name="divisi" defaultValue={divisi ?? ""} aria-label="Divisi">
              <option value="">Semua divisi</option>
              {DIVISIONS.map((d) => (
                <option key={d} value={d}>
                  {DIVISION_LABELS[d]}
                </option>
              ))}
            </select>
          )}
          <button type="submit">Tampilkan</button>
        </form>

        {error ? (
          <div className="err">Gagal memuat aktivitas: {error.message}</div>
        ) : rows.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>Tidak ada karyawan pada filter ini.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>{weekly ? "Minggu" : "Bulan"}</th>
                <th>Nama</th>
                <th>Divisi</th>
                <th style={{ textAlign: "right" }}>Jam</th>
                <th style={{ textAlign: "right" }}>Sesi</th>
                <th style={{ textAlign: "right" }}>Page View</th>
                <th>Terakhir aktif</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.period_start}:${r.employee_id}`}>
                  <td>{periodLabel(r.period_start, weekly)}</td>
                  <td>{r.full_name}</td>
                  <td>{DIVISION_LABELS[r.division as Division] ?? r.division}</td>
                  <td style={{ textAlign: "right" }}>{jam(r.hours)}</td>
                  <td style={{ textAlign: "right" }}>{num(r.sessions)}</td>
                  <td style={{ textAlign: "right" }}>{num(r.page_views)}</td>
                  <td>{waktu(r.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
