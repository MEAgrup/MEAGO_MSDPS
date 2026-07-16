// Indikator visual utk halaman Jadwal Live: PK belum siap, TAP belum terhubung,
// slot yang perlu diverifikasi, dan warning "besok belum ada jadwal".

import { addDays, type YMD } from "./weeks";

export type SlotStatus = "scheduled" | "tentative" | "off" | "done";

export type SlotForIndicators = {
  status: SlotStatus;
  schedule_date: YMD;
  pk_ready: boolean;
  product_connected_tap: boolean;
};

export type SlotIndicatorFlags = {
  pkMissing: boolean;
  tapMissing: boolean;
  needsVerification: boolean;
};

export function slotIndicators(slot: SlotForIndicators, todayStr: YMD): SlotIndicatorFlags {
  // Slot 'off' bukan sesi live — PK/TAP tak relevan, jangan ditandai "missing".
  const isOff = slot.status === "off";
  const pkMissing = !isOff && !slot.pk_ready;
  const tapMissing = !isOff && !slot.product_connected_tap;
  // "Butuh verifikasi": masih pending (scheduled/tentative) TAPI tanggalnya sudah lewat.
  const needsVerification =
    (slot.status === "scheduled" || slot.status === "tentative") && slot.schedule_date < todayStr;

  return { pkMissing, tapMissing, needsVerification };
}

export type SlotsByDate = Record<YMD, { status: SlotStatus }[]>;

// true HANYA bila besok tidak ada baris jadwal SAMA SEKALI. Bila besok ada slot tapi
// semua berstatus 'off', itu tetap dianggap "ada jadwal" (keputusan sadar utk libur)
// -> TIDAK memicu warning ini, walau tak ada sesi live sungguhan.
export function tomorrowEmpty(slotsByDate: SlotsByDate, todayStr: YMD): boolean {
  const tomorrow = addDays(todayStr, 1);
  const slots = slotsByDate[tomorrow] ?? [];
  return slots.length === 0;
}
