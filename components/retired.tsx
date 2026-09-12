import Link from "next/link";

// Halaman nisan untuk modul MSDPS yang dipensiunkan (2026-09-12).
//
// KENAPA ADA: MEAGO! menutup deal dengan merchant POI, tapi tim yang mengerjakan
// pekerjaan operasionalnya — Account, Ads, Creative, Store Operation — tidak ada di
// MEAGO; semuanya duduk di MEA Agency dan bekerja di CDPS. M6–M10 (+ turunannya
// M11–M15) dibangun lengkap sebagai mesin eksekusi kedua dan tidak pernah berpenghuni.
// Sejak Bridge MSDPS→CDPS Fase 1 (2026-09-11, migrasi 0360) deal Berbayar yang sudah
// terverifikasi Finance diteruskan sebagai satu order ORD- ke inbox CDPS, dan eksekusinya
// terjadi di sana. Lihat docs/BUILD_PLAN.md baris "Pensiun Account & Service".
//
// PENSIUNNYA LUNAK, BUKAN PENGHAPUSAN: tabel, RLS, trigger, dan seluruh data historis
// TETAP UTUH — nol DROP, nol DELETE. Yang berhenti hanyalah pintu masuk manusianya.
//
// ⚠️ JANGAN "merapikan" file yatim. `forms.tsx` dan `lib/actions/{account,ecommerce,
// ads,kol,livestream,blocks}.ts` sengaja DIBIARKAN UTUH di disk walau tidak di-import
// siapa pun lagi. Itu bukan kelalaian — itu mekanismenya: Next.js hanya mendaftarkan
// endpoint Server Action untuk action yang terjangkau dari module graph route yang
// di-render. Begitu page.tsx berhenti meng-import forms.tsx, seluruh action modul itu
// tidak ikut ter-bundle dan tidak bisa dipanggil lagi — jalur tulisnya tertutup TANPA
// menghapus satu baris riwayat pun, dan satu `git revert` mengembalikan seluruh UI.
// Menghapus file-file itu justru membuang jalan pulang tanpa menambah keamanan apa pun.
//
// Komponen ini TIDAK BOLEH menyentuh database. Nol query, nol import Supabase.

export function RetiredModule({ modul }: { modul: string }) {
  return (
    <>
      <h1>{modul}</h1>
      <p className="page-sub">
        [modul ini sudah pindah ke CDPS — eksekusi layanan tidak lagi dijalankan di MEAGO]
      </p>

      <div className="card">
        <h2>Modul ini sudah pensiun</h2>
        <p style={{ margin: "0 0 14px" }}>
          Sejak <strong>Bridge MSDPS→CDPS Fase 1</strong> (11 September 2026), deal berbayar
          yang sudah terverifikasi Finance diteruskan sebagai satu order{" "}
          <span className="mono">ORD-</span> ke CDPS. Tim Account, Ads, Creative, dan Store
          Operation mengerjakannya di sana — bukan lagi di halaman ini.
        </p>
        <p style={{ margin: "0 0 18px" }}>
          Teruskan pekerjaan baru lewat <strong>Merchant Deals</strong> → tombol{" "}
          <strong>&ldquo;Teruskan ke CDPS&rdquo;</strong>.
        </p>
        <Link className="btn" href="/deals">
          Ke Merchant Deals
        </Link>
        <p className="hint">
          Data historis modul ini <strong>tidak dihapus</strong> — seluruh baris, riwayat
          transisi, dan audit log tetap tersimpan di database dan masih bisa dibaca
          OD/Director lewat SQL.
        </p>
      </div>
    </>
  );
}
