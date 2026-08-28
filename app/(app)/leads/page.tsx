import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { rupiah } from "@/lib/format";
import { CRM_STATUSES } from "@/lib/crm/options";
import type { CrmLeadRow, EmployeeOption } from "@/lib/crm/types";
import { selectAll } from "@/lib/crm/select-all";
import { LeadActionTabs, CrmLeadsTable } from "./crm-forms";
import { NewLeadForm, ImportCsvForm, ClaimButton, AttemptControls } from "./forms";

// Kolom crm_leads yang dipakai halaman ini — harus sama dengan CrmLeadRow.
const CRM_LEAD_COLUMNS =
  "id, code, nama_bd, bd_id, tanggal_scouting, brand, kategori_brand, jenis_usaha, source, " +
  "wilayah, nama_pic, kontak_pic, website_socmed, status, approach_via, hasil_approach, " +
  "tanggal_update_status, benefit_dealing, nominal_bayar, tanggal_mulai_kontrak, " +
  "tanggal_akhir_kontrak, notes_kontrak";

// ---- Arsip Module 1 (pool lead + kompetisi prospek) -------------------------
type LegacyLead = {
  id: string;
  code: string | null;
  lead_name: string;
  phone_normalized: string;
  source: string;
  status: string;
  stale: boolean;
};

type LegacyAttempt = {
  id: string;
  code: string | null;
  parent_lead_id: string;
  owner_id: string;
  status: string;
  won: boolean;
  not_qualified_reason: string | null;
};

const LEGACY_LEAD_CLASS: Record<string, string> = {
  "[Pool]": "slate",
  "[Scouted - Aktif]": "blue",
  "[Closed - Success]": "green",
  "[Tidak Berkualitas]": "amber",
  "[Ditolak]": "red",
};

const LEGACY_ATTEMPT_CLASS: Record<string, string> = {
  "[Pending Validation]": "slate",
  "[New Lead]": "slate",
  "[Contacted]": "blue",
  "[Qualified]": "blue",
  "[Negotiation]": "amber",
  "[Closed - Success]": "green",
  "[Closed - Lost]": "red",
  "[Closed - Kalah Kompetisi]": "red",
  "[Not Qualified]": "amber",
};

export default async function LeadsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canWrite = mgmt || div === "BizDev" || div === "Marketing";
  const canDelete = mgmt || (div === "BizDev" && me?.rank === "lead");

  const supabase = await getCachedClient();

  const [
    crmLeadsRes,
    trxLeadIdsRes,
    { data: empsRaw },
    { data: legacyLeads },
    { data: legacyAttempts },
    { data: campaigns },
  ] = await Promise.all([
    selectAll<CrmLeadRow>(supabase, "crm_leads", CRM_LEAD_COLUMNS, {
      column: "created_at",
      ascending: false,
    }),
    selectAll<{ crm_lead_id: string }>(supabase, "crm_transaksi", "crm_lead_id"),
    supabase
      .from("employees")
      .select("id, full_name, division")
      .eq("active", true)
      .order("full_name", { ascending: true }),
    supabase
      .from("leads")
      .select("id, code, lead_name, phone_normalized, source, status, stale")
      .order("created_at", { ascending: false }),
    supabase
      .from("prospect_attempts")
      .select("id, code, parent_lead_id, owner_id, status, won, not_qualified_reason")
      .order("created_at", { ascending: false }),
    supabase
      .from("campaigns")
      .select("id, code, campaign_name")
      .order("created_at", { ascending: false }),
  ]);

  const leads = crmLeadsRes.rows;
  const employees = (empsRaw as EmployeeOption[] | null) ?? [];

  // Kegagalan baca CRM ditampilkan sebagai peringatan, bukan exception: arsip
  // Module 1 di bawah tetap terbaca dan halaman tidak jatuh jadi 500 kosong.
  const dbErrors = [crmLeadsRes.error, trxLeadIdsRes.error].filter(
    (e): e is string => e !== null
  );

  // Jumlah transaksi per lead — dipakai untuk badge "belum ada transaksi" dan
  // banner pengingat (mirror notifikasi "Perlu Input Transaksi" web app lama).
  const trxCountByLead: Record<string, number> = {};
  for (const t of trxLeadIdsRes.rows) {
    trxCountByLead[t.crm_lead_id] = (trxCountByLead[t.crm_lead_id] ?? 0) + 1;
  }

  const byStatus = (s: string) => leads.filter((l) => l.status === s).length;
  const dealingLeads = leads.filter((l) => l.status === "Dealing" || l.status === "Renewal");
  const belumTercatat = dealingLeads.filter((l) => (trxCountByLead[l.id] ?? 0) === 0);
  const nilaiDealing = dealingLeads.reduce((sum, l) => sum + Number(l.nominal_bayar ?? 0), 0);

  const legacyLeadList = (legacyLeads as LegacyLead[] | null) ?? [];
  const legacyAttemptList = (legacyAttempts as LegacyAttempt[] | null) ?? [];
  const empName = new Map<string, string>(employees.map((e) => [e.id, e.full_name]));
  const isBizDev = div === "BizDev";
  const canControlLegacy = (ownerId: string) =>
    ownerId === me?.id || (isBizDev && me?.rank === "lead") || mgmt;

  return (
    <>
      <h1>Leads &amp; Prospek</h1>
      <p className="page-sub">
        CRM scouting Admin Ops: satu baris per Brand / Merchant / POI. Alur status{" "}
        <b>Leads → Approaching → Follow Up → Dealing/Rejected</b> (Renewal untuk perpanjangan).
        Lead yang sudah <b>Dealing</b> atau <b>Renewal</b> didata transaksinya di{" "}
        <Link href="/deals">Merchant Deals</Link>.
      </p>

      {dbErrors.length > 0 && (
        <div className="card" style={{ borderColor: "#fca5a5", background: "#fef2f2" }}>
          <h2 style={{ color: "#b91c1c" }}>Data CRM tidak dapat dimuat</h2>
          {dbErrors.map((e) => (
            <p className="section-sub" key={e} style={{ marginBottom: 6 }}>
              {e}
            </p>
          ))}
        </div>
      )}

      {belumTercatat.length > 0 && (
        <div className="card" style={{ borderColor: "#fcd34d", background: "#fffbeb" }}>
          <h2 style={{ color: "#b45309" }}>
            Perlu Input Transaksi: {belumTercatat.length} lead Dealing/Renewal belum tercatat
          </h2>
          <p className="section-sub">
            {belumTercatat
              .slice(0, 8)
              .map((l) => l.brand)
              .join(", ")}
            {belumTercatat.length > 8 ? `, +${belumTercatat.length - 8} lainnya` : ""}
          </p>
          <Link href="/deals">
            <button type="button" className="sm">
              Buka Pendataan Transaksi →
            </button>
          </Link>
        </div>
      )}

      <div
        className="stats"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}
      >
        <div className="stat">
          <div className="k">Total Leads</div>
          <div className="v">{leads.length}</div>
        </div>
        {CRM_STATUSES.filter((s) => s !== "Leads").map((s) => (
          <div className="stat" key={s}>
            <div className="k">{s}</div>
            <div className="v">{byStatus(s)}</div>
          </div>
        ))}
        <div className="stat">
          <div className="k">Nilai Dealing</div>
          <div className="v small">{rupiah(nilaiDealing)}</div>
        </div>
      </div>

      {canWrite && <LeadActionTabs employees={employees} />}

      <CrmLeadsTable
        leads={leads}
        employees={employees}
        trxCountByLead={trxCountByLead}
        canWrite={canWrite}
        canDelete={canDelete}
      />

      {/* Sistem lama Module 1 tetap dapat diakses: pool dedup-by-nomor + kompetisi
          prospek masih dipakai jalur close_deal di menu Merchant. */}
      <div className="card">
        <details className="disclose">
          <summary>
            Arsip sistem lama — Pool Lead &amp; Kompetisi Prospek ({legacyLeadList.length} lead,{" "}
            {legacyAttemptList.length} prospek)
          </summary>
          <p className="section-sub" style={{ marginTop: 12 }}>
            Modul 1 (dedup nomor E.164 + kompetisi prospek BizDev). Tidak dipakai flow CRM baru,
            tapi masih menjadi sumber <span className="mono">close_deal</span> di menu Merchant.
          </p>

          <h3>Pool Lead</h3>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  <th>Nomor</th>
                  <th>Sumber</th>
                  <th>Status</th>
                  {isBizDev && <th>Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {legacyLeadList.map((l) => {
                  const claimable = l.status === "[Pool]" || l.status === "[Scouted - Aktif]";
                  return (
                    <tr key={l.id}>
                      <td className="mono">{l.code ?? "—"}</td>
                      <td>
                        {l.lead_name} {l.stale && <span className="badge amber">stale</span>}
                      </td>
                      <td className="mono">{l.phone_normalized}</td>
                      <td className="muted">{l.source}</td>
                      <td>
                        <span className={`badge ${LEGACY_LEAD_CLASS[l.status] ?? "gray"}`}>
                          {l.status}
                        </span>
                      </td>
                      {isBizDev && (
                        <td>
                          {claimable ? (
                            <ClaimButton leadId={l.id} />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                {legacyLeadList.length === 0 && (
                  <tr>
                    <td colSpan={isBizDev ? 6 : 5} className="muted">
                      Tidak ada data pool lama.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: 18 }}>Papan Kompetisi Prospek</h3>
          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Prospek</th>
                  <th>Lead</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Lanjutkan</th>
                </tr>
              </thead>
              <tbody>
                {legacyAttemptList.map((a) => {
                  const lead = legacyLeadList.find((l) => l.id === a.parent_lead_id);
                  return (
                    <tr key={a.id}>
                      <td className="mono">{a.code ?? "(pending)"}</td>
                      <td>
                        <span className="mono">{lead?.code ?? "—"}</span>{" "}
                        {lead?.lead_name ?? "?"}
                      </td>
                      <td>{empName.get(a.owner_id) ?? "—"}</td>
                      <td>
                        <span className={`badge ${LEGACY_ATTEMPT_CLASS[a.status] ?? "gray"}`}>
                          {a.status}
                        </span>
                        {a.not_qualified_reason && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {a.not_qualified_reason}
                          </div>
                        )}
                      </td>
                      <td>
                        {canControlLegacy(a.owner_id) ? (
                          <AttemptControls id={a.id} status={a.status} />
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {legacyAttemptList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Tidak ada prospek lama.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {canWrite && (
            <>
              <h3 style={{ marginTop: 18 }}>Daftarkan Lead (sistem lama)</h3>
              <NewLeadForm campaigns={campaigns ?? []} />
              <h3 style={{ marginTop: 18 }}>Impor CSV (sistem lama)</h3>
              <ImportCsvForm campaigns={campaigns ?? []} />
            </>
          )}
        </details>
      </div>
    </>
  );
}
