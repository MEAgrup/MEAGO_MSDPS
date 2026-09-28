"use client";

import { useMemo, useState } from "react";
import { rupiah } from "@/lib/format";
import { EditCreatorModal, type CreatorEditable } from "./forms";

type CmOption = { id: string; full_name: string; rank: string };

// Baris flat siap-render — nilai rata-rata & label CM sudah dihitung di server
// (page.tsx), tabel ini murni tampilan (sort + paginasi), tidak query apa pun.
export type MasterCreatorRow = {
  id: string;
  code: string | null;
  name: string;
  username: string | null;
  cmName: string | null;
  bindingLabel: string | null; // label badge binding, "Unbounded" bila null di status
  bindingCls: string; // kelas badge
  niche: string | null;
  jenis_creator: string | null;
  creator_level: string | null;
  avgPayGmv: number | null;
  redeemedGmv: number | null;
  commission_share: number | null;
  totalPost: number | null;
  postsWithSales: number | null;
  liveStream: number | null;
  validLiveStream: number | null;
  live_roster: boolean;
  status_kontrak: string | null;
  raw: CreatorEditable;
};

type SortKey =
  | "name"
  | "username"
  | "cmName"
  | "binding"
  | "niche"
  | "jenis_creator"
  | "creator_level"
  | "avgPayGmv"
  | "redeemedGmv"
  | "commission_share"
  | "totalPost"
  | "postsWithSales"
  | "liveStream"
  | "validLiveStream"
  | "live_roster"
  | "status_kontrak";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Nama" },
  { key: "username", label: "Username" },
  { key: "cmName", label: "CM" },
  { key: "binding", label: "Status" },
  { key: "niche", label: "Industry" },
  { key: "jenis_creator", label: "Jenis" },
  { key: "creator_level", label: "Level" },
  { key: "avgPayGmv", label: "Avg Pay GMV", numeric: true },
  { key: "redeemedGmv", label: "Redeemed GMV", numeric: true },
  { key: "commission_share", label: "Komisi", numeric: true },
  { key: "totalPost", label: "Total post", numeric: true },
  { key: "postsWithSales", label: "Posts with sales", numeric: true },
  { key: "liveStream", label: "Live stream", numeric: true },
  { key: "validLiveStream", label: "Valid live stream", numeric: true },
  { key: "live_roster", label: "Roster Live" },
  { key: "status_kontrak", label: "Kontrak" },
];

const STATUS_KONTRAK_BADGE: Record<string, { cls: string; label: string }> = {
  kontrak: { cls: "green", label: "Kontrak" },
  "non kontrak": { cls: "slate", label: "Non Kontrak" },
};

const PAGE_SIZES = [10, 20, 50, 100] as const;

function sortValue(r: MasterCreatorRow, key: SortKey): string | number {
  switch (key) {
    case "name":
      return r.name ?? "";
    case "username":
      return r.username ?? "";
    case "cmName":
      return r.cmName ?? "";
    case "binding":
      return r.bindingLabel ?? "";
    case "niche":
      return r.niche ?? "";
    case "jenis_creator":
      return r.jenis_creator ?? "";
    case "creator_level":
      return r.creator_level ?? "";
    case "avgPayGmv":
      return r.avgPayGmv ?? -Infinity;
    case "redeemedGmv":
      return r.redeemedGmv ?? -Infinity;
    case "commission_share":
      return r.commission_share ?? -Infinity;
    case "totalPost":
      return r.totalPost ?? -Infinity;
    case "postsWithSales":
      return r.postsWithSales ?? -Infinity;
    case "liveStream":
      return r.liveStream ?? -Infinity;
    case "validLiveStream":
      return r.validLiveStream ?? -Infinity;
    case "live_roster":
      return r.live_roster ? 1 : 0;
    case "status_kontrak":
      return r.status_kontrak ?? "";
  }
}

const num1 = (n: number | null): string =>
  n === null ? "—" : new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(n);

export function MasterCreatorsTable({
  rows,
  cmEmployees,
  canManageOps,
}: {
  rows: MasterCreatorRow[];
  cmEmployees: CmOption[];
  canManageOps: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [pageSize, setPageSize] = useState<(typeof PAGE_SIZES)[number]>(10);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    const numeric = !!col?.numeric || sortKey === "live_roster";
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = numeric
        ? (av as number) - (bv as number)
        : String(av).localeCompare(String(bv), "id");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  const colSpan = COLUMNS.length + (canManageOps ? 1 : 0);

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} className={col.numeric ? "right" : undefined}>
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="th-sort"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      font: "inherit",
                      color: "inherit",
                      padding: 0,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    {col.label}
                    {sortKey === col.key ? (sortDir === "asc" ? "▲" : "▼") : ""}
                  </button>
                </th>
              ))}
              {canManageOps && <th>Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.name}
                  {r.code && <div className="mono muted" style={{ fontSize: 11 }}>{r.code}</div>}
                </td>
                <td className="mono">{r.username ?? "—"}</td>
                <td>{r.cmName ?? <span className="muted">—</span>}</td>
                <td>
                  {r.bindingLabel ? (
                    <span className={`badge ${r.bindingCls}`}>{r.bindingLabel}</span>
                  ) : (
                    <span className="muted">Unbounded</span>
                  )}
                </td>
                <td className="muted">{r.niche ?? "—"}</td>
                <td className="muted">{r.jenis_creator ?? "—"}</td>
                <td>
                  {r.creator_level ? (
                    <span className="badge slate">{r.creator_level}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td className="right">{rupiah(r.avgPayGmv)}</td>
                <td className="right">{rupiah(r.redeemedGmv)}</td>
                <td className="muted">
                  {r.commission_share !== null ? `${r.commission_share}%` : "—"}
                </td>
                <td className="right">{num1(r.totalPost)}</td>
                <td className="right">{num1(r.postsWithSales)}</td>
                <td className="right">{num1(r.liveStream)}</td>
                <td className="right">{num1(r.validLiveStream)}</td>
                <td>
                  {r.live_roster ? (
                    <span className="badge green">Roster</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {r.status_kontrak ? (
                    <span className={`badge ${STATUS_KONTRAK_BADGE[r.status_kontrak]?.cls ?? "gray"}`}>
                      {STATUS_KONTRAK_BADGE[r.status_kontrak]?.label ?? r.status_kontrak}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                {canManageOps && (
                  <td>
                    <EditCreatorModal creator={r.raw} cmOptions={cmEmployees} />
                  </td>
                )}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="muted">
                  Belum ada kreator terdaftar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 12,
          }}
        >
          <div className="muted" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
            Tampilkan
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value) as (typeof PAGE_SIZES)[number]);
                setPage(1);
              }}
              style={{ width: "auto" }}
              aria-label="Jumlah baris per halaman"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            dari {sorted.length.toLocaleString("id-ID")} kreator
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              ‹ Sebelumnya
            </button>
            <span className="muted" style={{ fontSize: 13 }}>
              Halaman {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Berikutnya ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}
