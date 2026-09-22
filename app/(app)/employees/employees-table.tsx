"use client";

import { useMemo, useState } from "react";

type Employee = {
  id: string;
  full_name: string;
  email: string | null;
  division: string;
  rank: string;
  is_od: boolean;
  is_director: boolean;
  active: boolean;
};

type SortKey = "full_name" | "email" | "division" | "rank" | "role";
type SortDir = "asc" | "desc";

const ROLE_LABEL = (e: Employee) =>
  e.is_director ? "Director" : e.is_od ? "OD" : "Staff";

const RANK_LABEL = (e: Employee) => (e.rank === "lead" ? "Lead / SPV" : "Staff");

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "full_name", label: "Nama" },
  { key: "email", label: "Email / Username" },
  { key: "division", label: "Divisi" },
  { key: "rank", label: "Level" },
  { key: "role", label: "Peran" },
];

function sortValue(e: Employee, key: SortKey): string {
  switch (key) {
    case "full_name":
      return e.full_name ?? "";
    case "email":
      return e.email ?? "";
    case "division":
      return e.division ?? "";
    case "rank":
      return RANK_LABEL(e);
    case "role":
      return ROLE_LABEL(e);
  }
}

export function EmployeesTable({ employees }: { employees: Employee[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("division");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sorted = useMemo(() => {
    const rows = [...employees];
    rows.sort((a, b) => {
      const cmp = sortValue(a, sortKey).localeCompare(sortValue(b, sortKey), "id");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [employees, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <table>
      <thead>
        <tr>
          {COLUMNS.map((col) => (
            <th key={col.key}>
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
        </tr>
      </thead>
      <tbody>
        {sorted.map((e) => (
          <tr key={e.id}>
            <td>{e.full_name}</td>
            <td>{e.email ?? "—"}</td>
            <td>{e.division}</td>
            <td>{RANK_LABEL(e)}</td>
            <td>
              {e.is_director && <span className="badge indigo">Director</span>}{" "}
              {e.is_od && <span className="badge amber">OD</span>}
              {!e.is_director && !e.is_od && <span className="badge gray">Staff</span>}
            </td>
          </tr>
        ))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={COLUMNS.length} style={{ color: "var(--muted)" }}>
              Belum ada karyawan. Jalankan seed atau tambah di bawah.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
