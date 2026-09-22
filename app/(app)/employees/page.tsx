import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getEmployee } from "@/lib/supabase/server";
import {
  LEAD_ONBOARDING_KEY,
  parseWindow,
  windowStatus,
} from "@/lib/employee-onboarding";
import { DIVISION_LABELS, type Division } from "@/lib/divisions";
import {
  AddEmployeeForm,
  AdminConnectionCheck,
  LeadAddEmployeeForm,
  OnboardingWindowForm,
} from "./add-form";
import { EmployeesTable } from "./employees-table";

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

export default async function EmployeesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const me = await getEmployee();
  const mgmt = !!(me?.is_od || me?.is_director);
  const isLead = me?.rank === "lead";

  const supabase = await getCachedClient();
  const [{ data: employees }, { data: cfg }] = await Promise.all([
    supabase
      .from("employees")
      .select(
        "id, full_name, email, division, rank, is_od, is_director, active, created_by, created_via, must_change_password"
      )
      .order("division")
      .order("full_name"),
    supabase.from("app_config").select("value").eq("key", LEAD_ONBOARDING_KEY).maybeSingle(),
  ]);

  const rows = (employees as Employee[] | null) ?? [];

  const window = parseWindow(cfg?.value);
  const status = windowStatus(window);

  // SPV/Lead menambah hanya selama jendela berlaku DAN divisinya termasuk. Yang
  // ditegakkan tetap policy 0367 di DB; ini hanya menentukan form mana dirender.
  const leadDivisionAllowed =
    !window.divisions ||
    window.divisions.length === 0 ||
    (me?.division ? window.divisions.includes(me.division as Division) : false);
  const leadCanAdd = !mgmt && isLead && status.open && leadDivisionAllowed;

  const tempPasswordCount = rows.filter((e) => e.must_change_password).length;

  return (
    <>
      <h1>Kelola Karyawan</h1>
      <p className="page-sub">
        Daftar akun internal MSDPS + perannya. Penambahan karyawan adalah wewenang
        OD/HR dan Director; SPV/Lead ikut menambah hanya selama jendela onboarding
        dibuka.
      </p>

      {/* ---- Status jendela onboarding ---- */}
      {(mgmt || isLead) && (
        <div className="card">
          <h2>Jendela Onboarding SPV/Lead</h2>
          <p style={{ marginTop: 0 }}>
            <span className={status.open ? "badge green" : "badge gray"}>
              {status.open ? "TERBUKA" : "TERTUTUP"}
            </span>{" "}
            {status.reason}
          </p>
          <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6, marginTop: 0 }}>
            Selama terbuka, SPV/Lead boleh menambah <strong>staff divisinya sendiri</strong> dengan
            password sementara — tidak bisa mengangkat Lead/SPV, tidak bisa memberi peran OD atau
            Director, dan tidak bisa mengubah atau menghapus data karyawan. Jendela berhenti berlaku
            sendiri pada tanggal tutup; sesudah itu penambahan karyawan kembali sepenuhnya ke OD/HR.
            {window.divisions && window.divisions.length > 0 && (
              <>
                {" "}
                Dibatasi ke divisi:{" "}
                <strong>
                  {window.divisions.map((d) => DIVISION_LABELS[d] ?? d).join(", ")}
                </strong>
                .
              </>
            )}
            {window.note && (
              <>
                <br />
                Catatan: {window.note}
              </>
            )}
          </p>
          {mgmt && <OnboardingWindowForm window={window} />}
          {!mgmt && isLead && !leadDivisionAllowed && status.open && (
            <div className="err">
              Jendela terbuka, tetapi tidak untuk divisi {me?.division}. Hubungi OD/HR.
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2>Daftar Karyawan ({rows.length})</h2>
        {tempPasswordCount > 0 && (
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
            {tempPasswordCount} akun masih memegang password sementara — pemiliknya diarahkan
            mengganti password sendiri saat login pertama.
          </p>
        )}
        <EmployeesTable employees={rows} canManage={mgmt} />
      </div>

      {mgmt && (
        <div className="card">
          <h2>Tambah Karyawan</h2>
          <AdminConnectionCheck />
          <AddEmployeeForm />
        </div>
      )}

      {leadCanAdd && me && (
        <div className="card">
          <h2>Tambah Anggota Tim {DIVISION_LABELS[me.division as Division] ?? me.division}</h2>
          <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 0 }}>
            Divisi dan level terkunci: anggota masuk sebagai <strong>Staff</strong> di divisi Anda.
            Sistem yang membuat password sementaranya — salin dan serahkan ke yang bersangkutan;
            password itu hanya tampil sekali dan wajib diganti sendiri saat login pertama.
          </p>
          <LeadAddEmployeeForm division={me.division} />
        </div>
      )}
    </>
  );
}
