import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import { AddEmployeeForm, AdminConnectionCheck } from "./add-form";
import { EmployeesTable } from "./employees-table";

export default async function EmployeesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const canManage = !!(me?.is_od || me?.is_director);

  const supabase = await getCachedClient();
  const { data: employees } = await supabase
    .from("employees")
    .select("id, full_name, email, division, rank, is_od, is_director, active")
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
        <EmployeesTable employees={employees ?? []} />
      </div>

      {canManage && (
        <div className="card">
          <h2>Tambah Karyawan</h2>
          <AdminConnectionCheck />
          <AddEmployeeForm />
        </div>
      )}
    </>
  );
}
