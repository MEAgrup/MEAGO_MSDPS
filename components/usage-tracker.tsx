"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

// Mencatat halaman yang dibuka karyawan (migrasi 0376) — hanya dirender layout
// (app), yang sudah menolak kreator & merchant. usePathname() tanpa query
// string. Dikirim 1 detik sesudah path stabil (redirect beruntun hanya tercatat
// sekali) dan path yang sama berturut-turut tidak dikirim ulang (router.refresh,
// render ulang). Fire-and-forget: tidak ditunggu, galat ditelan.
export function UsageTracker() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || pathname === lastSent.current) return;
    const timer = setTimeout(() => {
      lastSent.current = pathname;
      fetch("/api/usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pathname }),
        keepalive: true,
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}
