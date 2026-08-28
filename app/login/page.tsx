"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Ubah error auth apa pun jadi kalimat yang bisa ditindaklanjuti.
//
// supabase-js tidak menjamin `error.message` terisi: pada 500 GoTrue badan
// responsnya bisa kosong, sehingga `String(error)` / render mentahnya keluar
// sebagai "{}" — persis yang dilihat user saat akun dengan kolom token NULL
// mencoba login (lihat migrasi 0318). Fungsi ini selalu menghasilkan teks, dan
// menempelkan kode/status supaya keluhan user bisa langsung dicocokkan dengan
// auth log Supabase.
function describeAuthError(error: unknown): string {
  const e = error as { message?: unknown; status?: unknown; code?: unknown; name?: unknown };
  const message = typeof e?.message === "string" ? e.message.trim() : "";
  const status = typeof e?.status === "number" ? e.status : undefined;
  const code = typeof e?.code === "string" ? e.code : undefined;

  if (code === "invalid_credentials" || status === 400) {
    return "Email atau password salah.";
  }
  if (status === 429 || code === "over_request_rate_limit") {
    return "Terlalu banyak percobaan login. Tunggu beberapa menit lalu coba lagi.";
  }
  if (status === 403 && code === "user_banned") {
    return "Akun ini dinonaktifkan. Hubungi admin (OD/Director).";
  }
  if (status && status >= 500) {
    return (
      "Server autentikasi Supabase gagal memproses login akun ini " +
      `(${status}${code ? ` ${code}` : ""}${message ? `: ${message}` : ""}). ` +
      "Passwordnya belum sempat diperiksa — ini masalah di sisi server, bukan salah ketik. " +
      "Laporkan ke admin beserta jam percobaan login."
    );
  }
  if (e?.name === "AuthRetryableFetchError" || (!status && !message)) {
    return "Tidak bisa menghubungi server autentikasi. Periksa koneksi internet lalu coba lagi.";
  }
  return `Gagal masuk (${status ?? "tanpa status"}${code ? ` ${code}` : ""}): ${message || "tanpa keterangan"}`;
}

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

    let signIn;
    try {
      signIn = await supabase.auth.signInWithPassword({ email, password });
    } catch (e) {
      // signInWithPassword biasanya mengembalikan error, tapi kegagalan jaringan
      // bisa melempar — tanpa catch ini halaman berhenti di status "Masuk...".
      console.error("[login] signInWithPassword melempar:", e);
      setErr(describeAuthError(e));
      setLoading(false);
      return;
    }

    const { data, error } = signIn;
    if (error || !data.user) {
      if (error) console.error("[login] signInWithPassword gagal:", error);
      setErr(error ? describeAuthError(error) : "Gagal masuk: Supabase tidak mengembalikan user.");
      setLoading(false);
      return;
    }

    // Route pasca-login by identitas: employee → app karyawan; kreator → portal;
    // bukan keduanya → sign-out + error (tidak ada akun tanpa identitas).
    const { data: emp, error: empErr } = await supabase
      .from("employees")
      .select("id")
      .eq("id", data.user.id)
      .maybeSingle();
    if (empErr) {
      // Jangan sign-out karena query gagal: sesi login-nya sendiri sudah sah, dan
      // "tidak terhubung ke karyawan" akan jadi diagnosa yang menyesatkan.
      console.error("[login] lookup employees gagal:", empErr);
      setErr(`Login berhasil, tapi profil karyawan gagal dibaca: ${empErr.message}`);
      setLoading(false);
      return;
    }
    if (emp) {
      router.push("/dashboard");
      router.refresh();
      return;
    }

    const { data: creator, error: creatorErr } = await supabase
      .from("mcn_creators")
      .select("id")
      .eq("auth_user_id", data.user.id)
      .maybeSingle();
    if (creatorErr) {
      console.error("[login] lookup mcn_creators gagal:", creatorErr);
      setErr(`Login berhasil, tapi profil kreator gagal dibaca: ${creatorErr.message}`);
      setLoading(false);
      return;
    }
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
