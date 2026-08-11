"use client";

// Error boundary root. Tanpa ini, exception apa pun di Server Component atau
// server action menghasilkan layar "internal server error" kosong tanpa jalan
// keluar. Di sini user melihat pesan + digest (untuk dicocokkan dengan log
// Vercel) dan bisa mencoba ulang tanpa reload penuh.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="card" style={{ maxWidth: 640, margin: "40px auto" }}>
      <h2>Terjadi kesalahan</h2>
      <div className="err" style={{ display: "block" }}>
        {error.message || "Kesalahan tak terduga di server."}
      </div>
      {error.digest && (
        <p style={{ fontSize: 12, color: "var(--muted)" }}>
          Kode kesalahan: <code>{error.digest}</code> — sebutkan kode ini saat melapor supaya
          log di Vercel bisa dicocokkan.
        </p>
      )}
      <button onClick={reset}>Coba lagi</button>
    </div>
  );
}
