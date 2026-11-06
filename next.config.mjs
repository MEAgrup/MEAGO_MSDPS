/** @type {import('next').NextConfig} */
const nextConfig = {
  // Upload logo merchant (≤1 MB) lewat server action butuh sedikit di atas batas
  // default 1 MB karena overhead multipart. File export mentah TIDAK lewat sini —
  // dikirim langsung ke Storage (signed upload URL), lihat lib/actions/merchant-report.ts.
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};
export default nextConfig;
