import { redirect } from "next/navigation";
import { getSessionUser, getEmployee, getCachedClient } from "@/lib/supabase/server";
import { rupiah } from "@/lib/format";
import { CloseDealForm } from "./forms";

type Merchant = {
  id: string;
  code: string | null;
  nama_toko: string;
  kota: string;
  kategori: string;
  link_toko: string;
  gmv_baseline: number;
  target_gmv: number;
  total_revenue: number;
  payment_intent: string | null;
};

type Service = { id: string; code: string | null; merchant_id: string; service_type: string; status: string };
type Trx = {
  id: string;
  code: string | null;
  merchant_id: string;
  total_agreed_value: number;
  amount_verified: number;
  amount_outstanding: number;
  status: string;
};

export default async function MerchantsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const me = await getEmployee();
  const canClose = me?.division === "BizDev" || !!me?.is_director;

  const supabase = await getCachedClient();

  // Stage 1: query yang saling independen di-fetch paralel (satu round-trip).
  // prospect_attempts (negosiasi) tak bergantung merchants/services/trx → ikut paralel.
  const attemptsQuery = canClose
    ? supabase
        .from("prospect_attempts")
        .select("id, code, parent_lead_id, owner_id, status")
        .eq("status", "[Negotiation]")
    : Promise.resolve({
        data: [] as {
          id: string;
          code: string | null;
          parent_lead_id: string;
          owner_id: string;
          status: string;
        }[],
      });

  const [{ data: merchants }, { data: services }, { data: trxs }, { data: att }] = await Promise.all([
    supabase
      .from("merchants")
      .select(
        "id, code, nama_toko, kota, kategori, link_toko, gmv_baseline, target_gmv, total_revenue, payment_intent"
      )
      .order("created_at", { ascending: false }),
    supabase.from("services").select("id, code, merchant_id, service_type, status"),
    supabase
      .from("transactions")
      .select("id, code, merchant_id, total_agreed_value, amount_verified, amount_outstanding, status"),
    attemptsQuery,
  ]);

  const mList = (merchants as Merchant[] | null) ?? [];
  const svcByMerchant = new Map<string, Service[]>();
  for (const s of (services as Service[] | null) ?? []) {
    const arr = svcByMerchant.get(s.merchant_id) ?? [];
    arr.push(s);
    svcByMerchant.set(s.merchant_id, arr);
  }
  const trxByMerchant = new Map<string, Trx[]>();
  for (const t of (trxs as Trx[] | null) ?? []) {
    const arr = trxByMerchant.get(t.merchant_id) ?? [];
    arr.push(t);
    trxByMerchant.set(t.merchant_id, arr);
  }

  // Negotiation attempts the current user may close. `att` sudah di-fetch paralel
  // di Stage 1; hanya lookup leads (bergantung leadIds) yang tersisa berurutan.
  let negotiations: { attempt_id: string; label: string }[] = [];
  if (canClose) {
    const leadIds = [...new Set((att ?? []).map((a) => a.parent_lead_id))];
    const { data: leadRows } = leadIds.length
      ? await supabase.from("leads").select("id, lead_name, code").in("id", leadIds)
      : { data: [] as { id: string; lead_name: string; code: string | null }[] };
    const leadMap = new Map((leadRows ?? []).map((l) => [l.id, l]));
    negotiations = (att ?? [])
      .filter((a) => a.owner_id === me?.id || me?.is_director)
      .map((a) => {
        const l = leadMap.get(a.parent_lead_id);
        return {
          attempt_id: a.id,
          label: `${a.code ?? "(prospek)"} · ${l?.lead_name ?? "?"} (${l?.code ?? ""})`,
        };
      });
  }

  const totalTarget = mList.reduce((s, m) => s + Number(m.target_gmv), 0);

  return (
    <>
      <h1>Merchant</h1>
      <p className="page-sub">
        Merchant lahir saat closing (M4). GMV baseline dibekukan; target GMV & target service diatur
        Account (fase berikut). total_revenue bersifat turunan (read-only).
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Merchant</div>
          <div className="v">{mList.length}</div>
        </div>
        <div className="stat">
          <div className="k">Total Target GMV</div>
          <div className="v small">{rupiah(totalTarget)}</div>
        </div>
        <div className="stat">
          <div className="k">Total Layanan Aktif</div>
          <div className="v">
            {[...svcByMerchant.values()].flat().filter((s) => s.status === "[Active]").length}
          </div>
        </div>
        <div className="stat">
          <div className="k">Prospek Siap Closing</div>
          <div className="v">{negotiations.length}</div>
        </div>
      </div>

      {mList.map((m) => {
        const svc = svcByMerchant.get(m.id) ?? [];
        const tr = trxByMerchant.get(m.id) ?? [];
        return (
          <div className="card" key={m.id}>
            <h2>
              <span className="mono">{m.code ?? "—"}</span> · {m.nama_toko}
            </h2>
            <p className="section-sub">
              {m.kategori} · {m.kota} ·{" "}
              <a href={m.link_toko} target="_blank" rel="noreferrer">
                lihat toko
              </a>{" "}
              · Skema: {m.payment_intent ?? "—"}
            </p>
            <div className="row" style={{ marginBottom: 12 }}>
              <div>
                <span className="k muted">GMV Baseline</span>
                <div>{rupiah(m.gmv_baseline)}</div>
              </div>
              <div>
                <span className="k muted">Target GMV</span>
                <div>{rupiah(m.target_gmv)}</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Layanan (SVC)</th>
                  <th>Jenis</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {svc.map((s) => (
                  <tr key={s.id}>
                    <td className="mono">{s.code ?? "—"}</td>
                    <td>{s.service_type}</td>
                    <td>
                      <span className="badge slate">{s.status}</span>
                    </td>
                  </tr>
                ))}
                {svc.length === 0 && (
                  <tr>
                    <td colSpan={3} className="muted">
                      Belum ada layanan.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Transaksi (TRX)</th>
                  <th className="right">Nilai</th>
                  <th className="right">Terverifikasi</th>
                  <th className="right">Outstanding</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tr.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.code ?? "—"}</td>
                    <td className="right">{rupiah(t.total_agreed_value)}</td>
                    <td className="right">{rupiah(t.amount_verified)}</td>
                    <td className="right">{rupiah(t.amount_outstanding)}</td>
                    <td>
                      <span
                        className={`badge ${
                          t.status === "[Lunas]"
                            ? "green"
                            : t.status === "[Terverifikasi - Sebagian]"
                            ? "amber"
                            : "slate"
                        }`}
                      >
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {tr.length === 0 && (
                  <tr>
                    <td colSpan={5} className="muted">
                      Belum ada transaksi.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        );
      })}
      {mList.length === 0 && (
        <div className="card">
          <p className="muted">Belum ada merchant. Lakukan closing di bawah untuk membuat yang pertama.</p>
        </div>
      )}

      {canClose && (
        <div className="card">
          <h2>Closing Deal (buat Merchant)</h2>
          <p className="section-sub">
            Memanggil <span className="mono">close_deal()</span> — membuat Merchant + Layanan +
            Transaksi secara atomik, lalu menutup prospek pesaing.
          </p>
          <CloseDealForm negotiations={negotiations} />
        </div>
      )}
    </>
  );
}
