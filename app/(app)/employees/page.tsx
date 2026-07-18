import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { AddEmployeeForm } from "./add-form";

type Employee = {
  id: string;
  full_name: string;
  division: string;
  rank: string;
  is_od: boolean;
  is_director: boolean;
  active: boolean;
};

export default async function EmployeesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const canManage = !!(me?.is_od || me?.is_director);

  const supabase = await getCachedClient();
  const { data: employees } = await supabase
    .from("employees")
    .select("id, full_name, division, rank, is_od, is_director, active")
    .order("division")
    .order("full_name");

  return (
    <>
      <h1>Kelola Karyawan</h1>
      <p className="page-sub">
        Daftar akun internal MSDPS + perannya. Hanya OD/Director yang dapat menambah.
      </p>

      <div className="card">
        <h2>Daftar Karyawan ({employees?.length ?? 0})</h2>
        <table>
          <thead>
            <tr>
              <th>Nama</th>
              <th>Divisi</th>
              <th>Level</th>
              <th>Peran</th>
            </tr>
          </thead>
          <tbody>
            {(employees as Employee[] | null)?.map((e) => (
              <tr key={e.id}>
                <td>{e.full_name}</td>
                <td>{e.division}</td>
                <td>{e.rank === "lead" ? "Lead / SPV" : "Staff"}</td>
                <td>
                  {e.is_director && <span className="badge indigo">Director</span>}{" "}
                  {e.is_od && <span className="badge amber">OD</span>}
                  {!e.is_director && !e.is_od && <span className="badge gray">Staff</span>}
                </td>
              </tr>
            ))}
            {(!employees || employees.length === 0) && (
              <tr>
                <td colSpan={4} style={{ color: "var(--muted)" }}>
                  Belum ada karyawan. Jalankan seed atau tambah di bawah.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="card">
          <h2>Tambah Karyawan</h2>
          <AddEmployeeForm />
        </div>
      )}
    </>
  );
}
