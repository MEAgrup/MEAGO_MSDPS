"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Halaman ganti password wajib untuk akun yang masih memegang password
// sementara (migrasi 0365). SENGAJA di luar grup route (app): layout (app)
// me-redirect ke sini, jadi kalau halaman ini ikut di dalamnya, redirect-nya
// memutar tanpa henti.
//
// Password diganti lewat GoTrue dengan sesi pemilik akun sendiri — penambah
// (SPV/Lead maupun OD) tidak pernah tahu password barunya. Penandaan
// must_change_password ditutup RPC mark_password_changed() yang hanya menyentuh
// baris pemanggil.
export default function GantiPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (password.length < 8) {
      setErr("Password baru minimal 8 karakter.");
      return;
    }
    if (password !== confirm) {
      setErr("Konfirmasi password tidak sama.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const { error: uErr } = await supabase.auth.updateUser({ password });
    if (uErr) {
      setErr(uErr.message);
      setLoading(false);
      return;
    }

    // Kalau RPC ini gagal, passwordnya SUDAH berganti — user tidak boleh
    // diminta mengulang. Ia dilepas masuk; flag tertutup pada percobaan
    // berikutnya karena layout mengarahkannya ke sini lagi.
    const { error: rErr } = await supabase.rpc("mark_password_changed");
    if (rErr) console.error("[ganti-password] mark_password_changed gagal:", rErr.message);

    router.push("/dashboard");
    router.refresh();
  }

  async function onSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand">MSDPS</div>
        <div className="sub">Ganti password sementara</div>
        <p style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
          Akun Anda dibuat dengan password sementara. Tetapkan password sendiri
          sebelum memakai sistem — password sementara tidak lagi berlaku setelah ini.
        </p>
        {err && <div className="err">{err}</div>}
        <label>Password Baru</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          placeholder="minimal 8 karakter"
          required
        />
        <label>Ulangi Password Baru</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={8}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Menyimpan…" : "Simpan Password"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          style={{ marginTop: 10, width: "100%" }}
          onClick={onSignOut}
        >
          Keluar
        </button>
      </form>
    </div>
  );
}
