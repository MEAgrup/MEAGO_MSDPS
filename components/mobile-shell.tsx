"use client";

import { useState } from "react";

// Shell dipakai layout (app) & (kreator): sidebar desktop tetap statis,
// di mobile jadi drawer yang dibuka via hamburger dan tertutup otomatis
// saat sebuah link di sidebar diklik (event delegation, bukan router hook,
// supaya tidak perlu tahu apa-apa soal isi sidebar).
export function MobileShell({
  brand,
  sidebar,
  children,
}: {
  brand: string;
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="app-shell">
      <div className="mobile-topbar">
        <button
          type="button"
          className="hamburger-btn"
          aria-label={open ? "Tutup menu" : "Buka menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="mobile-topbar-brand">{brand}</div>
      </div>

      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} />}

      <nav
        className={`sidebar${open ? " open" : ""}`}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setOpen(false);
        }}
      >
        {sidebar}
      </nav>

      <main className="main">{children}</main>
    </div>
  );
}
