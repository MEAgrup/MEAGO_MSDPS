"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Link sidebar yang tahu dirinya sedang aktif — dipakai app/(app) & app/(kreator)
// supaya user tahu sedang di tab/menu mana tanpa harus lihat isi halaman.
// "Aktif" = path sekarang sama persis, atau sub-halaman dari href (mis. /deals
// aktif juga saat di /deals/123), kecuali href root "/" yang harus sama persis.
export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));

  return (
    <Link href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
