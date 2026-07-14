import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: me } = await supabase
    .from("employees")
    .select("full_name, division, rank, is_od, is_director")
    .eq("id", user!.id)
    .maybeSingle();

  return (
    <>
      <h1>Dashboard</h1>
      <p className="page-sub">
        Fase A (Foundation) + Fase B (Lead-to-Cash: Kampanye → Leads → Merchant → Keuangan) aktif.
        Modul divisi & koordinasi menyusul per fase.
      </p>

      <div className="card">
        <h2>Profil Anda</h2>
        {me ? (
          <table>
            <tbody>
              <tr>
                <th style={{ width: 160 }}>Nama</th>
                <td>{me.full_name}</td>
              </tr>
              <tr>
                <th>Divisi</th>
                <td>{me.division}</td>
              </tr>
              <tr>
                <th>Level</th>
                <td>{me.rank === "lead" ? "Lead / SPV" : "Staff"}</td>
              </tr>
              <tr>
                <th>Peran berlapis</th>
                <td>
                  {me.is_director && <span className="badge indigo">Director</span>}{" "}
                  {me.is_od && <span className="badge amber">OD</span>}
                  {!me.is_director && !me.is_od && <span className="badge gray">—</span>}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p>
            Akun login Anda ({user!.email}) belum tertaut ke data karyawan. Minta OD/Director
            menambahkan Anda di <strong>Kelola Karyawan</strong>.
          </p>
        )}
      </div>

      <div className="card">
        <h2>Status Sistem</h2>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          Engine fondasi sudah aktif: penomoran ID otomatis, penguncian transisi status,
          dan audit log permanen. Hak akses (RLS) per peran sudah berlaku di database.
        </p>
      </div>
    </>
  );
}
