import Link from "next/link";
import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { tanggal, rupiah, num } from "@/lib/format";
import { addDays } from "@/lib/mcn/weeks";
import { hariIniJakarta } from "@/lib/crm/waktu";
import type { CrmTransaksiRow, EmployeeOption, PoiOption } from "@/lib/crm/types";
import { selectAll } from "@/lib/crm/select-all";
import { TransaksiActionTabs, CrmTransaksiTable } from "./crm-forms";
import { DealsTabs, PipelineStageSelect, DealExtrasRow } from "./forms";

const TRX_COLUMNS =
  "id, code, crm_lead_id, tanggal_transaksi, nama_bd, bd_id, nama_ops, ops_id, kategori_poi, " +
  "nama_poi, nama_pic_poi, kontak_wa, bentuk_kerjasama, nominal, benefit_diberikan, visit_mulai, " +
  "visit_berakhir, jumlah_kreator, jumlah_konten, total_jam_live, link_brief, " +
  "durasi_kerjasama_mulai, durasi_kerjasama_akhir, is_bulk_import";

const POI_COLUMNS =
  "id, code, brand, status, kategori_brand, nama_bd, bd_id, nama_pic, kontak_pic";

// ---- Arsip registry deal MCN (brand_deals) ---------------------------------
type Deal = {
  id: string;
  code: string | null;
  brand_name: string;
  shop_id: string | null;
  exp_date: string | null;
  status: string;
  pipeline_stage: string;
  review_flags: Record<string, unknown> | null;
  kreators_needed: number | null;
  videos_needed: number | null;
  poi_location: string | null;
};

function dealExtrasSummary(d: Deal): string {
  const parts: string[] = [];
  if (d.kreators_needed !== null) parts.push(`${d.kreators_needed} kreator`);
  if (d.videos_needed !== null) parts.push(`${d.videos_needed} video`);
  if (d.poi_location) parts.push(d.poi_location);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

const DEAL_STATUS_CLASS: Record<string, string> = {
  running: "green",
  hold: "amber",
  done: "gray",
};

export default async function DealsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || ["BizDev", "CreatorManagement", "Account", "Finance"].includes(div);
  if (!canView) redirect("/dashboard");

  const canWrite = mgmt || ["BizDev", "CreatorManagement"].includes(div);
  const canImport = mgmt || div === "BizDev";
  const canDelete = mgmt || (div === "BizDev" && me?.rank === "lead");
  const sourcedByRole: "bd" | "cm" = div === "CreatorManagement" && !mgmt ? "cm" : "bd";

  const supabase = await getCachedClient();

  const [
    transaksi,
    poiOptions,
    { data: empsRaw },
    { data: dealsRaw },
    { data: merchantsRaw },
    { data: cfg },
  ] = await Promise.all([
    selectAll<CrmTransaksiRow>(supabase, "crm_transaksi", TRX_COLUMNS, {
      column: "tanggal_transaksi",
      ascending: false,
    }),
    // POI A-Z ascending (sama dengan web app lama).
    selectAll<PoiOption>(supabase, "crm_leads", POI_COLUMNS, {
      column: "brand",
      ascending: true,
    }),
    supabase
      .from("employees")
      .select("id, full_name, division")
      .eq("active", true)
      .order("full_name", { ascending: true }),
    supabase
      .from("brand_deals")
      .select(
        "id, code, brand_name, shop_id, exp_date, status, pipeline_stage, review_flags, kreators_needed, videos_needed, poi_location"
      )
      .order("created_at", { ascending: false }),
    supabase.from("merchants").select("id, code, nama_toko").order("nama_toko", { ascending: true }),
    supabase.from("app_config").select("value").eq("key", "mcn.deal_expiring_days").maybeSingle(),
  ]);

  const employees = (empsRaw as EmployeeOption[] | null) ?? [];

  // Lead Dealing/Renewal yang belum punya satu pun transaksi (notifikasi
  // "Perlu Input Transaksi" pada web app Apps Script).
  const tercatat = new Set(transaksi.map((t) => t.crm_lead_id));
  const siapTransaksi = poiOptions.filter(
    (p) => p.status === "Dealing" || p.status === "Renewal"
  );
  const belumTercatat = siapTransaksi.filter((p) => !tercatat.has(p.id));

  const totalBerbayar = transaksi
    .filter((t) => t.bentuk_kerjasama === "Berbayar")
    .reduce((s, t) => s + Number(t.nominal ?? 0), 0);
  const totalKreator = transaksi.reduce((s, t) => s + Number(t.jumlah_kreator ?? 0), 0);
  const totalKonten = transaksi.reduce((s, t) => s + Number(t.jumlah_konten ?? 0), 0);
  const totalJamLive = transaksi.reduce((s, t) => s + Number(t.total_jam_live ?? 0), 0);

  // ---- data arsip brand_deals ----
  const deals = (dealsRaw as Deal[] | null) ?? [];
  const merchants =
    (merchantsRaw as { id: string; code: string | null; nama_toko: string }[] | null) ?? [];
  const expiringDays = cfg?.value != null ? Number(cfg.value) : 14;
  const todayStr = hariIniJakarta();
  const thresholdDate = addDays(todayStr, expiringDays);

  return (
    <>
      <h1>Merchant Deals</h1>
      <p className="page-sub">
        Pendataan transaksi POI untuk merchant yang sudah <b>Dealing</b> atau <b>Renewal</b> di{" "}
        <Link href="/leads">Leads &amp; Prospek</Link>. Satu lead bisa punya banyak transaksi
        (visit berulang / perpanjangan).
      </p>

      {belumTercatat.length > 0 && (
        <div className="card" style={{ borderColor: "#fcd34d", background: "#fffbeb" }}>
          <h2 style={{ color: "#b45309" }}>
            Perlu Input Transaksi: {belumTercatat.length} merchant Dealing/Renewal belum tercatat
          </h2>
          <p className="section-sub">
            {belumTercatat
              .slice(0, 10)
              .map((p) => p.brand)
              .join(", ")}
            {belumTercatat.length > 10 ? `, +${belumTercatat.length - 10} lainnya` : ""}
          </p>
        </div>
      )}

      <div
        className="stats"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        <div className="stat">
          <div className="k">Total Transaksi</div>
          <div className="v">{transaksi.length}</div>
        </div>
        <div className="stat">
          <div className="k">Merchant Siap Transaksi</div>
          <div className="v">{siapTransaksi.length}</div>
        </div>
        <div className="stat">
          <div className="k">Nilai Berbayar</div>
          <div className="v small">{rupiah(totalBerbayar)}</div>
        </div>
        <div className="stat">
          <div className="k">Kreator Terpakai</div>
          <div className="v">{num(totalKreator)}</div>
        </div>
        <div className="stat">
          <div className="k">Konten</div>
          <div className="v">{num(totalKonten)}</div>
        </div>
        <div className="stat">
          <div className="k">Jam Live</div>
          <div className="v">{num(totalJamLive)}</div>
        </div>
      </div>

      {canWrite && (
        <TransaksiActionTabs
          poiOptions={poiOptions}
          employees={employees}
          canImport={canImport}
        />
      )}

      <CrmTransaksiTable
        rows={transaksi}
        poiOptions={poiOptions}
        employees={employees}
        canWrite={canWrite}
        canDelete={canDelete}
      />

      {/* Registry deal MCN (brand_deals) tetap ada: dipakai Jadwal Live,
          cooperating_shops, Special Project, dan portal kreator. */}
      <div className="card">
        <details className="disclose">
          <summary>Registry Deal MCN — brand_deals ({deals.length} deal)</summary>
          <p className="section-sub" style={{ marginTop: 12 }}>
            Bukan bagian flow pendataan transaksi. Masih dipakai <span className="mono">Jadwal
            Live</span>, <span className="mono">cooperating_shops</span>, Special Project, dan
            portal kreator — jadi registrasinya tetap di sini.
          </p>

          {canWrite && (
            <DealsTabs
              employees={employees.map((e) => ({ id: e.id, full_name: e.full_name }))}
              merchants={merchants}
              sourcedByRole={sourcedByRole}
              canImport={canImport}
            />
          )}

          <div style={{ overflowX: "auto" }}>
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Brand</th>
                  <th>Shop ID</th>
                  <th>Exp</th>
                  <th>Status</th>
                  <th>Pipeline</th>
                  <th>Flags</th>
                  <th>Kebutuhan Deal</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => {
                  const expiringSoon =
                    !!d.exp_date && d.exp_date >= todayStr && d.exp_date <= thresholdDate;
                  const expired = !!d.exp_date && d.exp_date < todayStr;
                  return (
                    <tr key={d.id}>
                      <td className="mono">{d.code ?? "—"}</td>
                      <td>{d.brand_name}</td>
                      <td className="mono">{d.shop_id ?? "—"}</td>
                      <td>
                        {tanggal(d.exp_date)}
                        {expired && <span className="badge red">expired</span>}
                        {!expired && expiringSoon && (
                          <span className="badge amber">expiring soon</span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${DEAL_STATUS_CLASS[d.status] ?? "gray"}`}>
                          {d.status}
                        </span>
                      </td>
                      <td>
                        {mgmt || div === "BizDev" ? (
                          <PipelineStageSelect dealId={d.id} current={d.pipeline_stage} />
                        ) : (
                          <span className="badge slate">{d.pipeline_stage}</span>
                        )}
                      </td>
                      <td>
                        {d.review_flags ? (
                          <span className="badge amber" title={JSON.stringify(d.review_flags)}>
                            perlu review
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        {canWrite ? (
                          <DealExtrasRow
                            dealId={d.id}
                            currentKreatorsNeeded={d.kreators_needed}
                            currentVideosNeeded={d.videos_needed}
                            currentPoiLocation={d.poi_location}
                          />
                        ) : (
                          <span className="muted">{dealExtrasSummary(d)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {deals.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted">
                      Belum ada deal MCN terdaftar.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </>
  );
}
