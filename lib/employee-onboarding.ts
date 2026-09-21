// Jendela onboarding karyawan (migrasi 0365) — logika murni.
//
// Aturan siapa-boleh-menambah-siapa ditegakkan DI DB (policy
// `employees_lead_onboard_insert`). File ini bukan gerbangnya; ia ada supaya UI
// bisa menjelaskan keadaan jendela sebelum user menekan tombol, dan supaya
// server action menolak lebih awal dengan pesan yang bisa dibaca manusia —
// bukan dengan "new row violates row-level security policy".
//
// Nol impor: dipakai dari Server Component, Server Action, dan komponen klien.

import { DIVISIONS, type Division } from "@/lib/divisions";

export const LEAD_ONBOARDING_KEY = "employees.lead_onboarding";

export type LeadOnboardingWindow = {
  enabled: boolean;
  opens_at: string | null;
  closes_at: string | null;
  /** null / [] = semua divisi boleh. */
  divisions: Division[] | null;
  note: string | null;
};

export const WINDOW_CLOSED: LeadOnboardingWindow = {
  enabled: false,
  opens_at: null,
  closes_at: null,
  divisions: null,
  note: null,
};

function asIso(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// Bentuk value app_config datang dari DB dan bisa diedit manusia lewat /okr
// (form JSON bebas). Apa pun yang tidak dikenali dibaca sebagai "tutup", bukan
// dilempar — jendela yang rusak harus menutup, bukan membuka.
export function parseWindow(raw: unknown): LeadOnboardingWindow {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return WINDOW_CLOSED;
  const o = raw as Record<string, unknown>;

  const divisionsRaw = o.divisions;
  let divisions: Division[] | null = null;
  if (Array.isArray(divisionsRaw)) {
    const kept = divisionsRaw.filter(
      (d): d is Division => typeof d === "string" && (DIVISIONS as readonly string[]).includes(d)
    );
    divisions = kept.length > 0 ? kept : null;
  }

  return {
    enabled: o.enabled === true,
    opens_at: asIso(o.opens_at),
    closes_at: asIso(o.closes_at),
    divisions,
    note: typeof o.note === "string" && o.note.trim() !== "" ? o.note.trim() : null,
  };
}

export type WindowStatus =
  | { open: true; closes_at: string | null; reason: string }
  | { open: false; closes_at: string | null; reason: string };

export function windowStatus(w: LeadOnboardingWindow, now: Date = new Date()): WindowStatus {
  const t = now.getTime();
  if (!w.enabled) {
    return { open: false, closes_at: w.closes_at, reason: "Jendela onboarding ditutup OD/Director." };
  }
  if (w.opens_at && Date.parse(w.opens_at) > t) {
    return { open: false, closes_at: w.closes_at, reason: `Jendela baru terbuka ${formatWib(w.opens_at)}.` };
  }
  if (w.closes_at && Date.parse(w.closes_at) <= t) {
    return {
      open: false,
      closes_at: w.closes_at,
      reason: `Jendela berakhir ${formatWib(w.closes_at)} — wewenang menambah karyawan kembali ke OD/HR.`,
    };
  }
  return {
    open: true,
    closes_at: w.closes_at,
    reason: w.closes_at
      ? `Jendela terbuka sampai ${formatWib(w.closes_at)}.`
      : "Jendela terbuka tanpa tanggal tutup — sebaiknya OD menetapkan tanggalnya.",
  };
}

export function isWindowOpen(w: LeadOnboardingWindow, now: Date = new Date()): boolean {
  return windowStatus(w, now).open;
}

export function windowAllowsDivision(w: LeadOnboardingWindow, division: string): boolean {
  if (!w.divisions || w.divisions.length === 0) return true;
  return (w.divisions as readonly string[]).includes(division);
}

export type Actor = {
  division: string;
  rank: string;
  is_od: boolean;
  is_director: boolean;
};

export type AddVerdict = { ok: true; via: "od" | "lead_window" } | { ok: false; message: string };

// Satu tempat yang menjawab "boleh atau tidak" — dipakai server action (sebelum
// menyentuh Supabase) dan halaman /employees (untuk memutuskan form mana yang
// dirender). Cerminan WITH CHECK policy 0365; DB tetap pemutus terakhir.
export function verdictForAdd(
  me: Actor,
  target: { division: string; rank: string; is_od: boolean; is_director: boolean },
  w: LeadOnboardingWindow,
  now: Date = new Date()
): AddVerdict {
  if (me.is_od || me.is_director) return { ok: true, via: "od" };

  if (me.rank !== "lead") {
    return { ok: false, message: "Hanya OD/Director (atau SPV/Lead selama jendela onboarding) yang boleh menambah karyawan." };
  }

  const status = windowStatus(w, now);
  if (!status.open) {
    return { ok: false, message: `${status.reason} Minta OD/HR yang menambahkan.` };
  }
  if (!windowAllowsDivision(w, me.division)) {
    return { ok: false, message: `Jendela onboarding tidak dibuka untuk divisi ${me.division}.` };
  }
  if (target.division !== me.division) {
    return { ok: false, message: `SPV/Lead hanya boleh menambah karyawan divisi ${me.division}.` };
  }
  if (target.rank !== "staff") {
    return { ok: false, message: "SPV/Lead hanya boleh menambah level Staff. Pengangkatan Lead/SPV lewat OD." };
  }
  if (target.is_od || target.is_director) {
    return { ok: false, message: "SPV/Lead tidak boleh memberi peran OD atau Director." };
  }
  return { ok: true, via: "lead_window" };
}

// ---- Password sementara -----------------------------------------------------
// Dibuat sistem, bukan diketik penambah: password yang diketik manusia untuk
// belasan akun sekaligus selalu berpola ("meago123"), dan pola itu yang bertahan
// kalau pemiliknya lupa mengganti. Huruf/angka ambigu (0/O, 1/I/l) dibuang
// karena password ini dibacakan atau disalin lewat chat.
const TEMP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TEMP_GROUPS = 3;
const TEMP_GROUP_LEN = 4;

export function generateTempPassword(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes
): string {
  const n = TEMP_GROUPS * TEMP_GROUP_LEN;
  const bytes = randomBytes(n);
  const chars: string[] = [];
  for (let i = 0; i < n; i++) chars.push(TEMP_ALPHABET[bytes[i] % TEMP_ALPHABET.length]);
  const groups: string[] = [];
  for (let g = 0; g < TEMP_GROUPS; g++) {
    groups.push(chars.slice(g * TEMP_GROUP_LEN, (g + 1) * TEMP_GROUP_LEN).join(""));
  }
  return `MEAGO-${groups.join("-")}`;
}

function defaultRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

// ---- Format tanggal ---------------------------------------------------------
// Semua tanggal jendela ditampilkan WIB: yang membaca layar ini ada di Bandung,
// dan "tutup 17:00Z" pernah dibaca sebagai jam 5 sore lokal.
export function formatWib(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  return (
    new Date(t).toLocaleString("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " WIB"
  );
}

// <input type="datetime-local"> berbicara waktu lokal browser tanpa zona. Nilai
// yang dikirimnya diperlakukan sebagai WIB (UTC+7) — bukan zona server Vercel
// (UTC), yang akan menggeser tanggal tutup 7 jam tanpa ada yang sadar.
export function wibLocalInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +h - 7, +mi);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function isoToWibLocalInput(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const wib = new Date(t + 7 * 3600 * 1000);
  return wib.toISOString().slice(0, 16);
}
