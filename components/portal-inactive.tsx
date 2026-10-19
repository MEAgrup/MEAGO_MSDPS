import { signOut } from "@/lib/actions/auth";

// Akun portal ada, tapi aksesnya tidak aktif lagi (binding kreator lepas / akses
// merchant dicabut). Data portal sudah tertutup di RLS; halaman ini hanya
// menjelaskan kenapa, alih-alih error kosong.
export function PortalInactive({ portal }: { portal: "Creator Portal" | "Merchant Portal" }) {
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">MEAGO!</div>
        <div className="sub">{portal}</div>
        <div className="warn-box">
          Akses {portal} untuk akun ini sedang tidak aktif. Hubungi tim MEAGO! untuk informasi lebih
          lanjut.
        </div>
        <form action={signOut}>
          <button style={{ width: "100%" }}>Keluar</button>
        </form>
      </div>
    </div>
  );
}
