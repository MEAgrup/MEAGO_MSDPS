import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { rupiah, num, tanggal } from "@/lib/format";
import {
  OKR_ROLE_ORDER,
  SECTION_LABEL,
  metricsForRole,
  currentQuarter,
  shiftQuarter,
  PERIOD_RE,
  type OkrRole,
} from "@/lib/okr-metrics";
import { SetTargetForm, ClearTargetButton } from "./forms";

// Target OKR — Director/OD menetapkan target per divisi per kuartal.
//
// PENSIUN 2026-09-12: halaman ini SELAMAT dari pensiun Account & Service, tapi
// difokuskan ulang ke divisi yang masih benar-benar bekerja di MSDPS
// (BizDev/CM/Acquisition/Marketing/Finance). Sumbernya pindah:
//   target     okr_targets       -> okr_targets_meago        (migrasi 0361)
//   attainment v_okr_attainment  -> v_okr_attainment_meago   (migrasi 0361)
// Attainment ditampilkan DI SINI, bukan lagi di /management yang ikut pensiun.

type TargetRow = {
  id: string;
  period: string;
  division: string;
  metric: string;
  target_value: number;
  comparator: string;
  set_by: string | null;
  created_at: string;
};

type AttainmentRow = {
  division: string;
  metric: string;
  actual_value: number | null;
  attainment_pct: number | null;
  pace_pct: number | null;
  elapsed_pct: number | null;
  is_cumulative: boolean;
};

// Rp ditulis dengan format rumah (rupiah() sudah memuat "Rp." — lihat isRp di
// bawah supaya satuannya tidak tercetak dua kali); sisanya angka biasa.
function isRp(unit: string): boolean {
  return unit.startsWith("Rp");
}

function tampilNilai(unit: string, v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return isRp(unit) ? rupiah(v) : num(v);
}

// Badge dinilai terhadap PACE (porsi kuartal yang sudah berlalu), bukan terhadap
// target penuh — kalau tidak, tiap target kumulatif selalu terbaca "merah" di
// minggu kedua kuartal. Metrik rasio (ROAS/CPL) tidak punya pace, jadi dinilai
// langsung terhadap attainment.
function badgeKelas(pct: number | null): string {
  if (pct === null) return "gray";
  if (pct >= 100) return "green";
  if (pct >= 70) return "amber";
  return "red";
}

export default async function OkrPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  if (!(me?.is_od || me?.is_director)) redirect("/dashboard");

  const sp = await searchParams;
  const period = sp.period && PERIOD_RE.test(sp.period) ? sp.period : currentQuarter();

  const supabase = await getCachedClient();

  const [{ data: targets }, { data: attainment }] = await Promise.all([
    supabase
      .from("okr_targets_meago")
      .select("id, period, division, metric, target_value, comparator, set_by, created_at")
      .eq("period", period)
      .eq("active", true),
    // v_okr_attainment_meago definer-by-design (pola tiga lapis 0314), jadi klien
    // sesi biasa cukup — tidak perlu createAdminClient seperti /campaigns.
    supabase
      .from("v_okr_attainment_meago")
      .select("division, metric, actual_value, attainment_pct, pace_pct, elapsed_pct, is_cumulative")
      .eq("period", period),
  ]);

  const tList = (targets as TargetRow[] | null) ?? [];
  const byKey = new Map<string, TargetRow>();
  for (const t of tList) byKey.set(`${t.division}|${t.metric}`, t);

  const aList = (attainment as AttainmentRow[] | null) ?? [];
  const attByKey = new Map<string, AttainmentRow>();
  for (const a of aList) attByKey.set(`${a.division}|${a.metric}`, a);
  const elapsed = aList.find((a) => a.elapsed_pct !== null)?.elapsed_pct ?? null;

  const setterIds = Array.from(new Set(tList.map((t) => t.set_by).filter(Boolean) as string[]));
  const setterName = new Map<string, string>();
  if (setterIds.length) {
    const { data: emps } = await supabase
      .from("employees")
      .select("id, full_name")
      .in("id", setterIds);
    for (const e of (emps as { id: string; full_name: string }[] | null) ?? []) {
      setterName.set(e.id, e.full_name);
    }
  }

  const prev = shiftQuarter(period, -1);
  const next = shiftQuarter(period, 1);
  const cur = currentQuarter();
  const totalSet = tList.length;

  return (
    <>
      <h1>Target OKR</h1>
      <p className="page-sub">
        Director menetapkan target tiap divisi per kuartal, dan realisasinya dihitung otomatis
        di halaman ini. Sejak eksekusi layanan pindah ke CDPS, OKR MSDPS berfokus pada divisi
        non-operasional: BizDev, Creator Management, Akuisisi, Marketing, dan Keuangan.
        Mengubah target akan menonaktifkan target lama (histori tetap tersimpan) dan berlaku
        untuk perhitungan berikutnya.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link className="btn-ghost sm" href={`/okr?period=${prev}`}>
              ← {prev}
            </Link>
            <strong style={{ fontSize: 18 }}>{period}</strong>
            <Link className="btn-ghost sm" href={`/okr?period=${next}`}>
              {next} →
            </Link>
            {period !== cur && (
              <Link className="sm" href={`/okr?period=${cur}`}>
                Ke kuartal berjalan ({cur})
              </Link>
            )}
          </div>
          <span style={{ color: "#94a3b8" }}>
            {totalSet} target diset · sisanya pakai default katalog
            {elapsed !== null && ` · kuartal berjalan ${elapsed}%`}
          </span>
        </div>
      </div>

      {OKR_ROLE_ORDER.map((role: OkrRole) => (
        <div className="card" style={{ marginBottom: 16 }} key={role}>
          <h2>{SECTION_LABEL[role]}</h2>
          <table>
            <thead>
              <tr>
                <th>Metrik</th>
                <th>Target berlaku</th>
                <th>Realisasi (kuartal berjalan)</th>
                <th>Set target</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {metricsForRole(role).map((m) => {
                const t = byKey.get(`${role}|${m.metric}`);
                const a = attByKey.get(`${role}|${m.metric}`);
                const effective = t ? Number(t.target_value) : m.defaultValue;
                const comparator = (t?.comparator as "gte" | "lte") ?? m.comparator;
                // Pace untuk metrik kumulatif, attainment apa adanya untuk rasio.
                const skor = a ? (a.is_cumulative ? a.pace_pct : a.attainment_pct) : null;
                return (
                  <tr key={m.metric}>
                    <td>
                      <div>
                        <strong>{m.label}</strong>
                      </div>
                      <div style={{ color: "#94a3b8", fontSize: 12 }}>{m.hint}</div>
                    </td>
                    <td>
                      <strong>
                        {comparator === "lte" ? "≤" : "≥"} {tampilNilai(m.unit, effective)}
                      </strong>{" "}
                      {!isRp(m.unit) && <span style={{ color: "#94a3b8" }}>{m.unit}</span>}
                    </td>
                    <td>
                      {a ? (
                        <>
                          <strong>{tampilNilai(m.unit, a.actual_value)}</strong>{" "}
                          <span className={`badge ${badgeKelas(skor)}`}>
                            {a.attainment_pct === null ? "—" : `${a.attainment_pct}%`}
                          </span>
                          {a.is_cumulative && a.pace_pct !== null && (
                            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                              pace {a.pace_pct}% terhadap {a.elapsed_pct}% kuartal yang berlalu
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>—</span>
                      )}
                    </td>
                    <td>
                      <SetTargetForm
                        period={period}
                        role={role}
                        metric={m.metric}
                        comparator={m.comparator}
                        current={t ? Number(t.target_value) : null}
                        unit={m.unit}
                      />
                    </td>
                    <td>
                      {t ? (
                        <>
                          <span className="badge green">Diset Director</span>
                          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                            {setterName.get(t.set_by ?? "") ?? "—"} · {tanggal(t.created_at)}
                          </div>
                          <div style={{ marginTop: 4 }}>
                            <ClearTargetButton id={t.id} />
                          </div>
                        </>
                      ) : (
                        <span className="badge gray">
                          Default ({tampilNilai(m.unit, m.defaultValue)})
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
