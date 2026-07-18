import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { tanggal } from "@/lib/format";
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

// M14 · Target OKR — Director/OD menetapkan target per section per kuartal.
// Menggantikan angka hardcode: engine (v_okr_attainment / performance score)
// membaca dari okr_targets, fallback ke default hanya bila belum diset.

type TargetRow = {
  id: string;
  period: string;
  role: string;
  metric: string;
  target_value: number;
  comparator: string;
  set_by: string | null;
  created_at: string;
};

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

  const { data: targets } = await supabase
    .from("okr_targets")
    .select("id, period, role, metric, target_value, comparator, set_by, created_at")
    .eq("period", period)
    .eq("active", true);

  const tList = (targets as TargetRow[] | null) ?? [];
  const byKey = new Map<string, TargetRow>();
  for (const t of tList) byKey.set(`${t.role}|${t.metric}`, t);

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
        Director menetapkan target tiap section per kuartal. Angka ini dipakai engine untuk menilai{" "}
        <Link href="/management">attainment OKR</Link> &amp; skor performa tim — bukan angka
        hardcode. Mengubah target akan menonaktifkan target lama (histori tetap tersimpan) dan
        berlaku untuk perhitungan berikutnya.
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
            {totalSet} target diset · sisanya pakai default engine
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
                <th>Set target</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {metricsForRole(role).map((m) => {
                const t = byKey.get(`${role}|${m.metric}`);
                const effective = t ? Number(t.target_value) : m.defaultValue;
                const comparator = (t?.comparator as "gte" | "lte") ?? m.comparator;
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
                        {comparator === "lte" ? "≤" : "≥"} {effective}
                      </strong>{" "}
                      <span style={{ color: "#94a3b8" }}>{m.unit}</span>
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
                        <span className="badge gray">Default ({m.defaultValue})</span>
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
