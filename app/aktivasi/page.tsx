import Link from "next/link";
import { checkActivationToken, type InviteStatus } from "@/lib/portal/activation";
import { ActivationForm } from "./activation-form";

// Halaman publik (lihat middleware): link dari "Kirim Akses Portal".
const FAIL_MESSAGE: Record<Exclude<InviteStatus, "valid">, string> = {
  expired: "Link aktivasi ini sudah kedaluwarsa (berlaku 72 jam).",
  used: "Link aktivasi ini sudah pernah dipakai. Silakan masuk dengan password yang sudah dibuat.",
  revoked: "Link aktivasi ini sudah diganti dengan link yang lebih baru atau dinonaktifkan.",
  ineligible: "Akses portal untuk akun ini sedang tidak aktif.",
  not_found: "Link aktivasi tidak dikenali.",
};

export default async function AktivasiPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t = "" } = await searchParams;
  const check = await checkActivationToken(t);
  const portal = check.kind === "merchant" ? "Merchant Portal" : "Creator Portal";

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">MEAGO!</div>
        <div className="sub">Aktivasi {check.status === "valid" ? portal : "Akun Portal"}</div>
        {check.status === "valid" ? (
          <ActivationForm token={t} email={check.email ?? ""} />
        ) : (
          <>
            <div className="err">{FAIL_MESSAGE[check.status]}</div>
            <p className="hint">
              Hubungi tim MEAGO! untuk mendapatkan link aktivasi baru.{" "}
              {check.status === "used" && <Link href="/login">Masuk</Link>}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
