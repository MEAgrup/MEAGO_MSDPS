"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { num, rupiah, tanggal } from "@/lib/format";
import { updateDealTransaction, deleteDealTransaction, deleteDealTransactionsBulk, type ActionResult } from "@/lib/actions/deals";
import { DealIntakeFields } from "./intake-fields";
import { DealsToolbar } from "./forms";
import type { BdOption } from "../leads/intake-fields";
import type { PoolLead } from "../leads/pool";
import type { BrandCategory } from "@/lib/leads/intake";
import type { BentukKerjasama } from "@/lib/deals/intake";
import { exportRowsToExcel } from "@/lib/xlsx-export";

export type Deal = {
  id: string;
  code: string | null;
  unique_id: string | null;
  brand_name: string;
  lead_id: string | null;
  bd_id: string | null;
  ops_name: string | null;
  kategori_poi: string | null;
  pic_name: string | null;
  pic_whatsapp: string | null;
  tanggal_mulai_kontrak: string | null;
  tanggal_akhir_kontrak: string | null;
  bentuk_kerjasama: string | null;
  nominal_harga: number;
  benefit: string | null;
  visit_start_date: string | null;
  visit_start_time: string | null;
  visit_end_date: string | null;
  visit_end_time: string | null;
  kreator_needed: number | null;
  konten_needed: number | null;
  total_jam_live: number | null;
  brief_link: string | null;
  created_at: string;
};

// Baris hasil Import Master Deal tidak pernah mengisi kategori_poi (lihat
// importMasterDeal) — trigger brand_deals_validate mewajibkan seluruh
// field POI begitu kategori_poi terisi, jadi kategori_poi kosong = pasti
// belum dilengkapi manual. Satu kondisi ini cukup jadi penanda "belum lengkap".
function isIncomplete(d: Deal): boolean {
  return !d.kategori_poi;
}

function toDatetimeLocal(date: string | null, time: string | null): string {
  if (!date) return "";
  return `${date}T${(time ?? "00:00").slice(0, 5)}`;
}

function visitLabel(startDate: string | null, startTime: string | null, endDate: string | null, endTime: string | null): string {
  if (!startDate) return "—";
  const start = `${tanggal(startDate)} ${(startTime ?? "").slice(0, 5)}`;
  if (!endDate) return start;
  const end = `${tanggal(endDate)} ${(endTime ?? "").slice(0, 5)}`;
  return `${start} – ${end}`;
}

function Msg({ state }: { state: ActionResult | null }) {
  if (!state) return null;
  return <div className={state.ok ? "ok-msg" : "err"}>{state.message}</div>;
}

// EditDealModal — tombol "Edit" (atau "Lengkapi Data" untuk baris hasil Import
// Master Deal) per baris. Memakai DealIntakeFields yang sama dengan
// RegisterDealModal supaya field tidak pernah menyimpang.
function DeleteDealButton({ dealId, label }: { dealId: string; label: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(deleteDealTransaction, null);
  return (
    <form
      action={action}
      className="inline-form"
      onSubmit={(e) => {
        if (!confirm(`Hapus deal "${label}"? Tindakan ini tidak dapat dibatalkan.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="deal_id" value={dealId} />
      <button className="sm dangerbtn" disabled={pending}>
        {pending ? "…" : "Hapus"}
      </button>
      {state && !state.ok && (
        <span className="badge red" title={state.message}>
          gagal
        </span>
      )}
    </form>
  );
}

function BulkDeleteBar({ ids }: { ids: string[] }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    deleteDealTransactionsBulk,
    null
  );
  return (
    <form
      action={action}
      className="inline-form"
      onSubmit={(e) => {
        if (!confirm(`Hapus ${ids.length} deal terpilih? Tindakan ini tidak dapat dibatalkan.`)) {
          e.preventDefault();
        }
      }}
    >
      {ids.map((id) => (
        <input key={id} type="hidden" name="deal_ids" value={id} />
      ))}
      <button className="sm dangerbtn" disabled={pending || ids.length === 0}>
        {pending ? "Menghapus…" : `Hapus ${ids.length} Terpilih`}
      </button>
      {state && <Msg state={state} />}
    </form>
  );
}

function EditDealModal({
  deal,
  dealingLeads,
  bdOptions,
  benefitOptions,
}: {
  deal: Deal;
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  benefitOptions: string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    updateDealTransaction,
    null
  );
  const incomplete = isIncomplete(deal);

  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);

  return (
    <>
      <button type="button" className={incomplete ? "sm" : "sm ghost2"} onClick={() => setOpen(true)}>
        {incomplete ? "Lengkapi Data" : "Edit"}
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{incomplete ? "Lengkapi Data Transaksi" : "Edit Transaksi"}{deal.code ? ` · ${deal.code}` : ""}</h3>
              <button type="button" className="sm ghost2" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <form action={action}>
              <div className="modal-body">
                {state && !state.ok && <div className="err">{state.message}</div>}
                <input type="hidden" name="deal_id" value={deal.id} />
                <DealIntakeFields
                  idPrefix={`edit-${deal.id}`}
                  dealingLeads={dealingLeads}
                  bdOptions={bdOptions}
                  benefitOptions={benefitOptions}
                  defaults={{
                    lead_id: deal.lead_id ?? "",
                    bd_id: deal.bd_id ?? "",
                    ops_name: deal.ops_name ?? "",
                    kategori_poi: (deal.kategori_poi as BrandCategory | null) ?? "",
                    pic_name: deal.pic_name ?? "",
                    pic_whatsapp: deal.pic_whatsapp ?? "",
                    tanggal_mulai_kontrak: deal.tanggal_mulai_kontrak ?? "",
                    tanggal_akhir_kontrak: deal.tanggal_akhir_kontrak ?? "",
                    bentuk_kerjasama: (deal.bentuk_kerjasama as BentukKerjasama | null) ?? "",
                    nominal_harga: deal.nominal_harga,
                    benefit: deal.benefit ?? "",
                    visit_mulai: toDatetimeLocal(deal.visit_start_date, deal.visit_start_time),
                    visit_berakhir: toDatetimeLocal(deal.visit_end_date, deal.visit_end_time),
                    kreator_needed: deal.kreator_needed ?? "",
                    konten_needed: deal.konten_needed ?? "",
                    total_jam_live: deal.total_jam_live ?? "",
                    brief_link: deal.brief_link ?? "",
                  }}
                />
              </div>
              <div className="modal-foot">
                <button type="button" className="ghost2" onClick={() => setOpen(false)} disabled={pending}>
                  Batal
                </button>
                <button type="submit" disabled={pending}>
                  {pending ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

type SortKey = "code" | "poi" | "bd" | "kategori" | "bentuk" | "nominal" | "visit" | "status";
type SortDir = "asc" | "desc";
const PAGE_SIZES = [10, 20, 50] as const;

function SortHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className="sortable" onClick={() => onSort(sortKey)}>
      {label} {active === sortKey ? (dir === "asc" ? "▲" : "▼") : ""}
    </th>
  );
}

// DealsBoard — scorecard + toolbar "Daftarkan Transaksi" + "Daftar Deal":
// search wildcard (POI/ID merchant/BD/Benefit), filter BD & tanggal visit,
// sort per kolom, paginasi 10/20/50, penanda "Lengkapi Data" untuk baris
// Import Master Deal yang belum dilengkapi. Scorecard dihitung dari hasil
// filter yang sama dengan tabel, supaya angkanya ikut berubah saat filter
// dipakai (bukan cuma baris tabelnya).
export function DealsBoard({
  deals,
  dealingLeads,
  bdOptions,
  bdNameById,
  benefitOptions,
  canRegister,
  canEditDelete,
}: {
  deals: Deal[];
  dealingLeads: PoolLead[];
  bdOptions: BdOption[];
  bdNameById: Record<string, string>;
  benefitOptions: string[];
  canRegister: boolean;
  canEditDelete: boolean;
}) {
  const [query, setQuery] = useState("");
  const [bdFilter, setBdFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("visit");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return deals.filter((d) => {
      if (bdFilter && d.bd_id !== bdFilter) return false;
      if (dateFrom && (!d.visit_start_date || d.visit_start_date < dateFrom)) return false;
      if (dateTo && (!d.visit_start_date || d.visit_start_date > dateTo)) return false;
      if (q) {
        const bd = (d.bd_id && bdNameById[d.bd_id]) ?? "";
        const hay = `${d.brand_name} ${d.code ?? ""} ${d.unique_id ?? ""} ${bd} ${d.benefit ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [deals, query, bdFilter, dateFrom, dateTo, bdNameById]);

  const filterActive = !!(query.trim() || bdFilter || dateFrom || dateTo);

  const stats = useMemo(() => {
    const totalTransaksi = filtered.length;
    const belumLengkap = filtered.filter(isIncomplete).length;
    const totalNominalDeals = filtered.reduce((sum, d) => sum + (d.nominal_harga ?? 0), 0);
    const berbayarCount = filtered.filter((d) => d.bentuk_kerjasama === "Berbayar").length;
    const freeBarterCount = filtered.filter((d) => d.bentuk_kerjasama === "Free/Barter").length;
    const skemaTotal = berbayarCount + freeBarterCount;
    const berbayarPct = skemaTotal > 0 ? Math.round((berbayarCount / skemaTotal) * 100) : 0;
    const freeBarterPct = skemaTotal > 0 ? 100 - berbayarPct : 0;
    return { totalTransaksi, belumLengkap, totalNominalDeals, berbayarCount, freeBarterCount, berbayarPct, freeBarterPct };
  }, [filtered]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (d: Deal): string => {
      switch (sortKey) {
        case "code":
          return d.code ?? "";
        case "poi":
          return d.brand_name;
        case "bd":
          return (d.bd_id && bdNameById[d.bd_id]) ?? "";
        case "kategori":
          return d.kategori_poi ?? "";
        case "bentuk":
          return d.bentuk_kerjasama ?? "";
        case "nominal":
          return String(d.nominal_harga).padStart(20, "0");
        case "visit":
          return d.visit_start_date ?? "";
        case "status":
          return isIncomplete(d) ? "0" : "1";
      }
    };
    return [...filtered].sort((a, b) => val(a).localeCompare(val(b)) * dir);
  }, [filtered, sortKey, sortDir, bdNameById]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const clampedPage = Math.min(page, pageCount);
  const paginated = sorted.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);

  function onSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
    setPage(1);
  }

  function toggleOne(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pageIds = paginated.map((d) => d.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  function toggleAllOnPage() {
    setSelected((s) => {
      const next = new Set(s);
      if (allPageSelected) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  const colCount = 9 + (canEditDelete ? 2 : 0);

  function exportExcel() {
    const rows = sorted.map((d) => ({
      "ID Merchant": d.code ?? "",
      "Unique ID": d.unique_id ?? "",
      "POI / Merchant": d.brand_name,
      BD: (d.bd_id && bdNameById[d.bd_id]) ?? "",
      Kategori: d.kategori_poi ?? "",
      "Bentuk Kerjasama": d.bentuk_kerjasama ?? "",
      Nominal: d.nominal_harga,
      Benefit: d.benefit ?? "",
      "Visit Mulai": d.visit_start_date ?? "",
      "Visit Berakhir": d.visit_end_date ?? "",
      Status: isIncomplete(d) ? "Belum Lengkap" : "Lengkap",
    }));
    exportRowsToExcel("merchant-deals", "Deals", rows);
  }

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="k">Total Transaksi{filterActive ? " (terfilter)" : ""}</div>
          <div className="v">{num(stats.totalTransaksi)}</div>
        </div>
        <div className="stat">
          <div className="k">Total Nominal Deals{filterActive ? " (terfilter)" : ""}</div>
          <div className="v small">{rupiah(stats.totalNominalDeals)}</div>
        </div>
        <div className="stat">
          <div className="k">Belum Lengkap</div>
          <div className="v" style={stats.belumLengkap > 0 ? { color: "#dc2626" } : undefined}>
            {num(stats.belumLengkap)}
          </div>
          {stats.belumLengkap > 0 && (
            <div className="muted" style={{ fontSize: 11, fontWeight: 500 }}>
              belum masuk tracker operasional
            </div>
          )}
        </div>
        <div className="stat">
          <div className="k">Skema Berbayar</div>
          <div className="v">
            {num(stats.berbayarCount)}{" "}
            <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
              ({stats.berbayarPct}%)
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="k">Skema Free/Barter</div>
          <div className="v">
            {num(stats.freeBarterCount)}{" "}
            <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>
              ({stats.freeBarterPct}%)
            </span>
          </div>
        </div>
      </div>

      {canRegister && (
        <DealsToolbar dealingLeads={dealingLeads} bdOptions={bdOptions} benefitOptions={benefitOptions} />
      )}

      <div className="card">
      <div className="table-toolbar">
        <h2>Daftar Deal ({sorted.length})</h2>
        <button type="button" className="sm ghost2" onClick={exportExcel} disabled={sorted.length === 0}>
          Export Excel
        </button>
      </div>
      <div className="filters-row">
        <div>
          <label>Cari POI, ID Merchant, BD, atau Benefit</label>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
            placeholder="search..."
          />
        </div>
        <div>
          <label>Nama BD</label>
          <select
            value={bdFilter}
            onChange={(e) => {
              setBdFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">— semua —</option>
            {bdOptions.map((b) => (
              <option key={b.id} value={b.id}>
                {b.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>Visit Dari Tanggal</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div>
          <label>Visit Sampai Tanggal</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </div>

      {canEditDelete && selected.size > 0 && (
        <div style={{ marginBottom: 12 }}>
          <BulkDeleteBar ids={[...selected]} />
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              {canEditDelete && (
                <th>
                  <input type="checkbox" checked={allPageSelected} onChange={toggleAllOnPage} />
                </th>
              )}
              <SortHeader label="ID Merchant" sortKey="code" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="POI / Merchant" sortKey="poi" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="BD" sortKey="bd" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Kategori" sortKey="kategori" active={sortKey} dir={sortDir} onSort={onSort} />
              <th>PIC &amp; WhatsApp</th>
              <SortHeader label="Bentuk" sortKey="bentuk" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Nominal / Benefit" sortKey="nominal" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Visit" sortKey="visit" active={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Status" sortKey="status" active={sortKey} dir={sortDir} onSort={onSort} />
              {canEditDelete && <th className="right">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {paginated.map((d) => (
              <tr key={d.id}>
                {canEditDelete && (
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(d.id)}
                      onChange={() => toggleOne(d.id)}
                    />
                  </td>
                )}
                <td className="mono">
                  {d.code ?? "—"}
                  {d.unique_id && (
                    <div className="muted" style={{ fontSize: 11 }}>
                      {d.unique_id}
                    </div>
                  )}
                </td>
                <td>{d.brand_name}</td>
                <td>{(d.bd_id && bdNameById[d.bd_id]) ?? "—"}</td>
                <td className="muted">{d.kategori_poi ?? "—"}</td>
                <td>
                  {d.pic_name ?? "—"}
                  <div className="mono" style={{ fontSize: 11 }}>
                    {d.pic_whatsapp ?? "—"}
                  </div>
                </td>
                <td className="muted">{d.bentuk_kerjasama ?? "—"}</td>
                <td>
                  {rupiah(d.nominal_harga)}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {d.benefit ?? "—"}
                  </div>
                </td>
                <td className="muted">{visitLabel(d.visit_start_date, d.visit_start_time, d.visit_end_date, d.visit_end_time)}</td>
                <td>
                  {isIncomplete(d) ? (
                    <span className="badge amber">Lengkapi Data</span>
                  ) : (
                    <span className="badge green">Lengkap</span>
                  )}
                </td>
                {canEditDelete && (
                  <td className="right">
                    <div className="actions-row" style={{ justifyContent: "flex-end" }}>
                      <EditDealModal
                        deal={d}
                        dealingLeads={dealingLeads}
                        bdOptions={bdOptions}
                        benefitOptions={benefitOptions}
                      />
                      <DeleteDealButton dealId={d.id} label={d.brand_name} />
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {paginated.length === 0 && (
              <tr>
                <td colSpan={colCount} className="muted">
                  Belum ada deal terdaftar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pagination">
        <div>
          Tampilkan{" "}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
              setPage(1);
            }}
            style={{ width: "auto", display: "inline-block", marginBottom: 0 }}
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>{" "}
          baris
        </div>
        <div className="actions-row">
          <button
            type="button"
            className="sm ghost2"
            disabled={clampedPage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            ‹ Sebelumnya
          </button>
          <span className="muted" style={{ alignSelf: "center" }}>
            Halaman {clampedPage} dari {pageCount}
          </span>
          <button
            type="button"
            className="sm ghost2"
            disabled={clampedPage >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          >
            Selanjutnya ›
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
