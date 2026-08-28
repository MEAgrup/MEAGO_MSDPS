import { missingSupabasePublicEnv, SUPABASE_ADMIN_ENV } from "@/lib/supabase/env";
import { supabaseProjectLabel } from "@/lib/supabase/project-ref";

// Halaman diagnosa konfigurasi. Middleware me-rewrite SEMUA route ke sini saat
// env var Supabase tidak lengkap — sebelum satu pun Server Component sempat
// memanggil Supabase dan melempar "supabaseUrl is required." (pesan yang
// disembunyikan build production, sehingga user cuma melihat digest).
//
// Halaman ini sengaja TIDAK menyentuh Supabase sama sekali.
//
// Aman ditampilkan: hanya NAMA variabel dan ref project (ref sudah terlihat di
// setiap URL request dari browser). Nilai key tidak pernah dicetak.
export default function KonfigurasiPage() {
  const missing = missingSupabasePublicEnv();

  if (missing.length === 0) {
    return (
      <div className="card" style={{ maxWidth: 680, margin: "40px auto" }}>
        <h2>Konfigurasi Supabase lengkap</h2>
        <p style={{ fontSize: 13, margin: 0 }}>
          Deployment ini membaca project <code>{supabaseProjectLabel()}</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 680, margin: "40px auto" }}>
      <h2>Konfigurasi Supabase belum lengkap</h2>
      <div className="err" style={{ display: "block" }}>
        Deployment ini tidak bisa menghubungi database karena environment variable
        berikut tidak terbaca:
        <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
          {missing.map((name) => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
      </div>

      <p style={{ fontSize: 13, margin: "0 0 10px" }}>
        Perbaiki di <strong>Vercel → Settings → Environment Variables</strong>, scope-kan ke
        branch yang benar (lihat <code>docs/STAGING.md</code> §3), lalu{" "}
        <strong>Redeploy</strong>. Jangan lupa <code>{SUPABASE_ADMIN_ENV[0]}</code> juga —
        variabel itu tidak dipakai halaman ini, tapi dibutuhkan fitur yang memakai
        service-role.
      </p>
      <p style={{ fontSize: 13, margin: 0, color: "var(--muted)" }}>
        Redeploy wajib: variabel <code>NEXT_PUBLIC_*</code> di-inline Next saat build, jadi
        menambahkannya di dashboard tidak berpengaruh pada deployment yang sudah jadi.
      </p>
    </div>
  );
}
