import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { rupiah, tanggal } from "@/lib/format";
import {
  VerifyForm,
  FlagButton,
  PayoutTransferForm,
  PayoutCancelForm,
  CampaignPayoutTransferForm,
  CampaignPayoutCancelForm,
} from "./forms";

type Trx = {
  id: string;
  code: string | null;
  merchant_id: string;
  payment_intent: string;
  total_agreed_value: number;
  amount_verified: number;
  amount_outstanding: number;
  status: string;
  flag_jatuh_tempo: boolean;
  flag_bermasalah: boolean;
  released_to_account_at: string | null;
};

type Payout = {
  id: string;
  code: string | null;
  payout_type: string;
  creator_id: string | null;
  amount: number;
  status: string;
  requested_at: string;
  transfer_proof: string | null;
  cancellation_reason: string | null;
};

type CampaignPayout = {
  id: string;
  code: string | null;
  mcn_creator_id: string;
  deal_id: string;
  amount: number;
  status: string;
  requested_at: string;
  transfer_proof: string | null;
  cancellation_reason: string | null;
};

const STATUS_CLASS: Record<string, string> = {
  "[Menunggu Verifikasi]": "slate",
  "[Terverifikasi - Sebagian]": "amber",
  "[Lunas]": "green",
};

const PYO_CLASS: Record<string, string> = {
  "[Menunggu Disbursement]": "amber",
  "[Ditransfer]": "green",
  "[Dibatalkan]": "red",
};

export default async function FinancePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const canVerify = me?.division === "Finance" || !!me?.is_director;
  const canCancelPayout =
    (me?.division === "Finance" && me?.rank === "lead") || !!me?.is_director || !!me?.is_od;

  const supabase = await getCachedClient();

  const [{ data: trxs }, { data: payouts }, { data: campaignPayouts }] = await Promise.all([
    supabase
      .from("transactions")
      .select(
        "id, code, merchant_id, payment_intent, total_agreed_value, amount_verified, amount_outstanding, status, flag_jatuh_tempo, flag_bermasalah, released_to_account_at"
      )
      .order("created_at", { ascending: false }),
    // Out-leg: antrian disbursement payout kreator (PYO dari M9).
    supabase
      .from("creator_payouts")
      .select(
        "id, code, payout_type, creator_id, amount, status, requested_at, transfer_proof, cancellation_reason"
      )
      .order("requested_at", { ascending: false }),
    // Out-leg campaign MEA GO (Fase G.4) — tabel TERPISAH, tidak menyentuh creator_payouts.
    supabase
      .from("campaign_payouts")
      .select("id, code, mcn_creator_id, deal_id, amount, status, requested_at, transfer_proof, cancellation_reason")
      .order("requested_at", { ascending: false }),
  ]);

  const list = (trxs as Trx[] | null) ?? [];
  const merchantIds = [...new Set(list.map((t) => t.merchant_id))];
  const pList = (payouts as Payout[] | null) ?? [];
  const creatorIds = [...new Set(pList.map((p) => p.creator_id).filter(Boolean))] as string[];
  const cpList = (campaignPayouts as CampaignPayout[] | null) ?? [];
  const mcnCreatorIds = [...new Set(cpList.map((p) => p.mcn_creator_id))];
  const campaignDealIds = [...new Set(cpList.map((p) => p.deal_id))];

  const [{ data: merchants }, { data: creators }, { data: mcnCreators }, { data: campaignDeals }] = await Promise.all([
    merchantIds.length
      ? supabase.from("merchants").select("id, code, nama_toko").in("id", merchantIds)
      : Promise.resolve({ data: [] as { id: string; code: string | null; nama_toko: string }[] }),
    creatorIds.length
      ? supabase.from("creators").select("id, code, name_handle").in("id", creatorIds)
      : Promise.resolve({ data: [] as { id: string; code: string | null; name_handle: string }[] }),
    mcnCreatorIds.length
      ? supabase.from("mcn_creators").select("id, code, name").in("id", mcnCreatorIds)
      : Promise.resolve({ data: [] as { id: string; code: string | null; name: string }[] }),
    campaignDealIds.length
      ? supabase.from("brand_deals").select("id, code, brand_name").in("id", campaignDealIds)
      : Promise.resolve({ data: [] as { id: string; code: string | null; brand_name: string }[] }),
  ]);
  const mMap = new Map((merchants ?? []).map((m) => [m.id, m]));
  const cMap = new Map((creators ?? []).map((c) => [c.id, c]));
  const mcnMap = new Map((mcnCreators ?? []).map((c) => [c.id, c]));
  const dealMap = new Map((campaignDeals ?? []).map((d) => [d.id, d]));
  const pyoQueue = pList.filter((p) => p.status === "[Menunggu Disbursement]");

  const queue = list.filter((t) => t.status !== "[Lunas]");
  const outstandingTotal = list.reduce((s, t) => s + Number(t.amount_outstanding), 0);
  const flagged = list.filter((t) => t.flag_jatuh_tempo || t.flag_bermasalah).length;

  return (
    <>
      <h1>Keuangan — Verifikasi Pembayaran</h1>
      <p className="page-sub">
        In-leg (M5): Finance mengonfirmasi uang masuk. Uang terkonfirmasi pertama membuka gerbang
        (release ke Account). Over-verify diblokir database.
      </p>

      <div className="stats">
        <div className="stat">
          <div className="k">Total Transaksi</div>
          <div className="v">{list.length}</div>
        </div>
        <div className="stat">
          <div className="k">Antrian Verifikasi</div>
          <div className="v">{queue.length}</div>
        </div>
        <div className="stat">
          <div className="k">Total Outstanding</div>
          <div className="v small">{rupiah(outstandingTotal)}</div>
        </div>
        <div className="stat">
          <div className="k">Ditandai</div>
          <div className="v">{flagged}</div>
        </div>
      </div>

      <div className="card">
        <h2>Antrian Verifikasi ({queue.length})</h2>
        <table>
          <thead>
            <tr>
              <th>TRX</th>
              <th>Merchant</th>
              <th>Skema</th>
              <th className="right">Nilai</th>
              <th className="right">Outstanding</th>
              <th>Status</th>
              <th>Reminder</th>
              {canVerify && <th>Verifikasi</th>}
            </tr>
          </thead>
          <tbody>
            {queue.map((t) => {
              const m = mMap.get(t.merchant_id);
              return (
                <tr key={t.id}>
                  <td className="mono">{t.code ?? "—"}</td>
                  <td>
                    <span className="mono">{m?.code ?? ""}</span> {m?.nama_toko ?? "—"}
                  </td>
                  <td className="muted">{t.payment_intent}</td>
                  <td className="right">{rupiah(t.total_agreed_value)}</td>
                  <td className="right">{rupiah(t.amount_outstanding)}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[t.status] ?? "gray"}`}>{t.status}</span>
                  </td>
                  <td>
                    {canVerify ? (
                      <div className="actions-row">
                        <FlagButton
                          transactionId={t.id}
                          field="flag_jatuh_tempo"
                          current={t.flag_jatuh_tempo}
                          label="Jatuh tempo"
                        />
                        <FlagButton
                          transactionId={t.id}
                          field="flag_bermasalah"
                          current={t.flag_bermasalah}
                          label="Bermasalah"
                        />
                      </div>
                    ) : (
                      <>
                        {t.flag_jatuh_tempo && <span className="badge amber">jatuh tempo</span>}{" "}
                        {t.flag_bermasalah && <span className="badge red">bermasalah</span>}
                      </>
                    )}
                  </td>
                  {canVerify && (
                    <td>
                      <VerifyForm transactionId={t.id} outstanding={Number(t.amount_outstanding)} />
                    </td>
                  )}
                </tr>
              );
            })}
            {queue.length === 0 && (
              <tr>
                <td colSpan={canVerify ? 8 : 7} className="muted">
                  Tidak ada transaksi menunggu verifikasi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Antrian Disbursement Payout Kreator ({pyoQueue.length})</h2>
        <p className="section-sub">
          Out-leg (M5/M9): Payment Request dari KOL saat milestone tercapai (10 video / 5 jam
          live). Nominal di-set KOL, read-only untuk Finance. Transfer manual mingguan.
        </p>
        <table>
          <thead>
            <tr>
              <th>PYO</th>
              <th>Tipe</th>
              <th>Creator</th>
              <th className="right">Nominal</th>
              <th>Diminta</th>
              <th>Status</th>
              {canVerify && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {pList.map((p) => {
              const c = p.creator_id ? cMap.get(p.creator_id) : undefined;
              return (
                <tr key={p.id}>
                  <td className="mono">{p.code ?? "—"}</td>
                  <td>{p.payout_type}</td>
                  <td>
                    <span className="mono">{c?.code ?? ""}</span> {c?.name_handle ?? "—"}
                  </td>
                  <td className="right">{rupiah(p.amount)}</td>
                  <td>{tanggal(p.requested_at)}</td>
                  <td>
                    <span className={`badge ${PYO_CLASS[p.status] ?? "gray"}`}>{p.status}</span>
                    {p.transfer_proof && <div className="muted">bukti: {p.transfer_proof}</div>}
                    {p.cancellation_reason && (
                      <div className="muted">alasan: {p.cancellation_reason}</div>
                    )}
                  </td>
                  {canVerify && (
                    <td>
                      {p.status === "[Menunggu Disbursement]" && (
                        <div className="inline-actions">
                          <PayoutTransferForm payoutId={p.id} />
                          {canCancelPayout && <PayoutCancelForm payoutId={p.id} />}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {pList.length === 0 && (
              <tr>
                <td colSpan={canVerify ? 7 : 6} className="muted">
                  Belum ada payout kreator.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Antrian Payout Campaign MEA GO ({cpList.filter((p) => p.status === "[Menunggu Disbursement]").length})</h2>
        <p className="section-sub">
          Out-leg Fase G.4: payout dibuat otomatis saat batch kurasi campaign ditutup (tabel BARU
          campaign_payouts — creator_payouts M5/M9 tidak disentuh). Transfer manual, sama seperti
          payout KOL.
        </p>
        <table>
          <thead>
            <tr>
              <th>CPY</th>
              <th>Campaign</th>
              <th>Kreator</th>
              <th className="right">Nominal</th>
              <th>Diminta</th>
              <th>Status</th>
              {canVerify && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {cpList.map((p) => {
              const c = mcnMap.get(p.mcn_creator_id);
              const d = dealMap.get(p.deal_id);
              return (
                <tr key={p.id}>
                  <td className="mono">{p.code ?? "—"}</td>
                  <td>
                    <span className="mono">{d?.code ?? ""}</span> {d?.brand_name ?? "—"}
                  </td>
                  <td>
                    <span className="mono">{c?.code ?? ""}</span> {c?.name ?? "—"}
                  </td>
                  <td className="right">{rupiah(p.amount)}</td>
                  <td>{tanggal(p.requested_at)}</td>
                  <td>
                    <span className={`badge ${PYO_CLASS[p.status] ?? "gray"}`}>{p.status}</span>
                    {p.transfer_proof && <div className="muted">bukti: {p.transfer_proof}</div>}
                    {p.cancellation_reason && (
                      <div className="muted">alasan: {p.cancellation_reason}</div>
                    )}
                  </td>
                  {canVerify && (
                    <td>
                      {p.status === "[Menunggu Disbursement]" && (
                        <div className="inline-actions">
                          <CampaignPayoutTransferForm payoutId={p.id} />
                          {canCancelPayout && <CampaignPayoutCancelForm payoutId={p.id} />}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {cpList.length === 0 && (
              <tr>
                <td colSpan={canVerify ? 7 : 6} className="muted">
                  Belum ada payout campaign.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Semua Transaksi ({list.length})</h2>
        <table>
          <thead>
            <tr>
              <th>TRX</th>
              <th>Merchant</th>
              <th className="right">Nilai</th>
              <th className="right">Terverifikasi</th>
              <th>Status</th>
              <th>Gerbang Account</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const m = mMap.get(t.merchant_id);
              return (
                <tr key={t.id}>
                  <td className="mono">{t.code ?? "—"}</td>
                  <td>{m?.nama_toko ?? "—"}</td>
                  <td className="right">{rupiah(t.total_agreed_value)}</td>
                  <td className="right">{rupiah(t.amount_verified)}</td>
                  <td>
                    <span className={`badge ${STATUS_CLASS[t.status] ?? "gray"}`}>{t.status}</span>
                  </td>
                  <td className="muted">
                    {t.released_to_account_at ? (
                      <span className="badge green">terbuka</span>
                    ) : (
                      "belum"
                    )}
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Belum ada transaksi.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
