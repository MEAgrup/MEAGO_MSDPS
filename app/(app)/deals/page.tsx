import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tanggal } from "@/lib/format";
import { addDays } from "@/lib/mcn/weeks";
import { DealsTabs, PipelineStageSelect } from "./forms";

type Deal = {
  id: string;
  code: string | null;
  brand_name: string;
  shop_id: string | null;
  exp_date: string | null;
  status: string;
  pipeline_stage: string;
  review_flags: Record<string, unknown> | null;
};

const STATUS_CLASS: Record<string, string> = {
  running: "green",
  hold: "amber",
  done: "gray",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export default async function DealsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("employees")
    .select("id, division, rank, is_od, is_director")
    .eq("id", user.id)
    .maybeSingle();

  const div = me?.division ?? "";
  const mgmt = !!(me?.is_od || me?.is_director);
  const canView = mgmt || ["BizDev", "CreatorManagement", "Account"].includes(div);
  if (!canView) redirect("/dashboard");

  const canRegister = mgmt || div === "BizDev" || div === "CreatorManagement";
  const canImport = mgmt || div === "BizDev";
  const sourcedByRole: "bd" | "cm" = div === "CreatorManagement" && !mgmt ? "cm" : "bd";

  const { data: dealsRaw } = await supabase
    .from("brand_deals")
    .select("id, code, brand_name, shop_id, exp_date, status, pipeline_stage, review_flags")
    .order("created_at", { ascending: false });
  const deals = (dealsRaw as Deal[] | null) ?? [];

  const { data: emps } = await supabase.from("employees").select("id, full_name");
  const employees = (emps as { id: string; full_name: string }[] | null) ?? [];

  const { data: merchantsRaw } = await supabase
    .from("merchants")
    .select("id, code, nama_toko")
    .order("nama_toko", { ascending: true });
  const merchants = (merchantsRaw as { id: string; code: string | null; nama_toko: string }[] | null) ?? [];

  const { data: cfg } = await supabase
    .from("app_config")
    .select("value")
    .eq("key", "mcn.deal_expiring_days")
    .maybeSingle();
  const expiringDays = cfg?.value != null ? Number(cfg.value) : 14;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const thresholdDate = addDays(todayStr, expiringDays);

  return (
    <>
      <h1>Merchant Deals</h1>
      <p className="page-sub">
        Registrasi deal &amp; import master deal legacy dalam satu halaman. Shop ID unik lintas
        deal; kadaluarsa disinkron otomatis ke <span className="mono">cooperating_shops</span>.
      </p>

      {canRegister && (
        <DealsTabs
          employees={employees}
          merchants={merchants}
          sourcedByRole={sourcedByRole}
          canImport={canImport}
        />
      )}

      <div className="card">
        <h2>Daftar Deal ({deals.length})</h2>
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
                      {!expired && expiringSoon && <span className="badge amber">expiring soon</span>}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_CLASS[d.status] ?? "gray"}`}>{d.status}</span>
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
                  </tr>
                );
              })}
              {deals.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    Belum ada deal terdaftar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
