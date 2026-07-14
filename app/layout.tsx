import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MSDPS — MEAGO!",
  description: "Merchant Service Delivery & Performance System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
