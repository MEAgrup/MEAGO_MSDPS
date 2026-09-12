import { RetiredModule } from "@/components/retired";

// PENSIUN 2026-09-12 — M6 — strategi/brief/komplain kini SVC-/BRF- di CDPS.
// Isi halaman lama ada di riwayat git (commit terakhir sebelum pensiun).
// forms.tsx & lib/actions di modul ini sengaja dibiarkan yatim — baca alasannya
// di header components/retired.tsx sebelum menghapus apa pun.
export default function Page() {
  return <RetiredModule modul="Account & Service" />;
}
