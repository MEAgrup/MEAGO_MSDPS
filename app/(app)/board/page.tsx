import { RetiredModule } from "@/components/retired";

// PENSIUN 2026-09-12 — M11 — v_merchant_board memproyeksikan Brief M6-M10 yang tidak diisi lagi.
// Isi halaman lama ada di riwayat git (commit terakhir sebelum pensiun).
// forms.tsx & lib/actions di modul ini sengaja dibiarkan yatim — baca alasannya
// di header components/retired.tsx sebelum menghapus apa pun.
export default function Page() {
  return <RetiredModule modul="Merchant Board" />;
}
