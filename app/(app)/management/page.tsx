import { RetiredModule } from "@/components/retired";

// PENSIUN 2026-09-12 — M13+M14 — health & performa diturunkan dari M6-M10; cron dihentikan di migrasi 0361.
// Isi halaman lama ada di riwayat git (commit terakhir sebelum pensiun).
// forms.tsx & lib/actions di modul ini sengaja dibiarkan yatim — baca alasannya
// di header components/retired.tsx sebelum menghapus apa pun.
export default function Page() {
  return <RetiredModule modul="Management Dashboard" />;
}
