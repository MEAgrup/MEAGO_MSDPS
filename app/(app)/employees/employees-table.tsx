"use client";

import { useMemo, useState } from "react";
import { ResetPasswordButton } from "./add-form";

type Employee = {
  id: string;
  full_name: string;
  email: string | null;
  division: string;
  rank: string;
  is_od: boolean;
  is_director: boolean;
  active: boolean;
  created_by: string | null;
  created_via: string | null;
  must_change_password: boolean;
};

type SortKey = "full_name" | "email" | "division" | "rank" | "role" | "password" | "created_by";
type SortDir = "asc" | "desc";

const ROLE_LABEL = (e: Employee) =>
  e.is_director ? "Director" : e.is_od ? "OD" : "Staff";

const RANK_LABEL = (e: Employee) => (e.rank === "lead" ? "Lead / SPV" : "Staff");

// Password sementara diurutkan lebih dulu: baris inilah yang menuntut tindakan
// (pemiliknya belum pernah login), bukan yang sudah beres.
const PASSWORD_LABEL = (e: Employee) => (e.must_change_password ? "sementara" : "sendiri");

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "full_name", label: "Nama" },
  { key: "email", label: "Email / Username" },
  { key: "division", label: "Divisi" },
  { key: "rank", label: "Level" },
  { key: "role", label: "Peran" },
  { key: "password", label: "Password" },
  { key: "created_by", label: "Ditambahkan oleh" },
];

export function EmployeesTable({
  employees,
  canManage = false,
}: {
  employees: Employee[];
  canManage?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("division");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Nama penambah dicari dari daftar yang sama — nol query tambahan, dan baris
  // yang penambahnya sudah dihapus tetap tampil (jatuh ke "—").
  const nameById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.full_name])),
    [employees]
  );

  const sortValue = useMemo(
    () =>
      (e: Employee, key: SortKey): string => {
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
          case "password":
            return PASSWORD_LABEL(e);
          case "created_by":
            return e.created_by ? (nameById.get(e.created_by) ?? "") : "";
        }
      },
    [nameById]
  );

  const sorted = useMemo(() => {
    const rows = [...employees];
    rows.sort((a, b) => {
      const cmp = sortValue(a, sortKey).localeCompare(sortValue(b, sortKey), "id");
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [employees, sortKey, sortDir, sortValue]);

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
          {canManage && <th>Aksi</th>}
        </tr>
      </thead>
      <tbody>
        {sorted.map((e) => (
          <tr key={e.id}>
            <td>
              {e.full_name}
              {!e.active && (
                <span className="badge gray" style={{ marginLeft: 6 }}>
                  nonaktif
                </span>
              )}
            </td>
            <td>{e.email ?? "—"}</td>
            <td>{e.division}</td>
            <td>{RANK_LABEL(e)}</td>
            <td>
              {e.is_director && <span className="badge indigo">Director</span>}{" "}
              {e.is_od && <span className="badge amber">OD</span>}
              {!e.is_director && !e.is_od && <span className="badge gray">Staff</span>}
            </td>
            <td>
              {e.must_change_password ? (
                <span className="badge amber">sementara</span>
              ) : (
                <span className="badge green">sendiri</span>
              )}
            </td>
            <td style={{ color: "var(--muted)", fontSize: 13 }}>
              {e.created_by ? (nameById.get(e.created_by) ?? "—") : "—"}
              {e.created_via === "lead_window" && (
                <span className="badge gray" style={{ marginLeft: 6 }}>
                  via SPV
                </span>
              )}
            </td>
            {canManage && (
              <td>
                <ResetPasswordButton employeeId={e.id} name={e.full_name} />
              </td>
            )}
          </tr>
        ))}
        {sorted.length === 0 && (
          <tr>
            <td colSpan={COLUMNS.length + (canManage ? 1 : 0)} style={{ color: "var(--muted)" }}>
              Belum ada karyawan. Jalankan seed atau tambah di bawah.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
