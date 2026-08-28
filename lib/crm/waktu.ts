// Konversi waktu untuk CRM Admin Ops.
//
// Masalah yang diselesaikan: input <input type="datetime-local"> mengirim jam
// dinding tanpa zona ("2026-08-28T14:00"). Kalau string itu langsung dikirim ke
// kolom timestamptz, Postgres menafsirkannya di timezone sesi (Supabase default
// UTC) sehingga 14:00 WIB tersimpan sebagai 14:00 UTC = 21:00 WIB. Semua konversi
// di sini memaksa zona bisnis Asia/Jakarta (WIB = +07:00 tetap, tanpa DST).

const JAKARTA = "Asia/Jakarta";
const WIB_OFFSET = "+07:00";

// "YYYY-MM-DDTHH:mm" (jam dinding WIB) -> ISO dengan offset eksplisit.
// Return null bila format tidak dikenali (form kosong / dimanipulasi).
export function jakartaInputToIso(local: string | null | undefined): string | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(local).trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${WIB_OFFSET}`;
}

// timestamptz dari DB -> "28 Agu 2026 14:00" (WIB).
export function waktuJakarta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const tanggal = new Intl.DateTimeFormat("id-ID", {
    timeZone: JAKARTA,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
  const jam = new Intl.DateTimeFormat("en-GB", {
    timeZone: JAKARTA,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
  return `${tanggal} ${jam}`;
}

// timestamptz dari DB -> nilai defaultValue untuk <input type="datetime-local">
// (jam dinding WIB), supaya form edit menampilkan waktu yang sama dengan tabel.
export function isoToJakartaInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// Tanggal hari ini (YYYY-MM-DD) zona Jakarta — untuk default nilai input date.
export function hariIniJakarta(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: JAKARTA }).format(new Date());
}
