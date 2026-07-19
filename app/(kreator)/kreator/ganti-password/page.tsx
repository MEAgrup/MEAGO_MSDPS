import { ChangePasswordForm } from "@/app/(app)/ganti-password/forms";

export default function GantiPasswordKreatorPage() {
  return (
    <>
      <h1>Ganti Password</h1>
      <p className="page-sub">Ubah password akun Anda. Password lama akan diverifikasi terlebih dahulu.</p>
      <div className="card" style={{ maxWidth: 420 }}>
        <ChangePasswordForm />
      </div>
    </>
  );
}
