"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      setErr(error?.message ?? "Gagal masuk.");
      setLoading(false);
      return;
    }

    // Route pasca-login by identitas: employee → app karyawan; kreator → portal;
    // bukan keduanya → sign-out + error (tidak ada akun tanpa identitas).
    const { data: emp } = await supabase
      .from("employees")
      .select("id")
      .eq("id", data.user.id)
      .maybeSingle();
    if (emp) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    const { data: creator } = await supabase
      .from("mcn_creators")
      .select("id")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (creator) {
      router.push("/kreator/performa");
      router.refresh();
      return;
    }

    await supabase.auth.signOut();
    setErr("Akun ini tidak terhubung ke karyawan maupun kreator. Hubungi admin.");
    setLoading(false);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand">MSDPS</div>
        <div className="sub">MEAGO! — Merchant Service Delivery &amp; Performance</div>
        {err && <div className="err">{err}</div>}
        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nama@meago.test"
          required
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Masuk..." : "Masuk"}
        </button>
        <p className="hint">Akun dibuat oleh admin (OD/Director). Tidak ada pendaftaran mandiri.</p>
      </form>
    </div>
  );
}
