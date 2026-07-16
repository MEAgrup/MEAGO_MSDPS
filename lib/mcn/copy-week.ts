// "Copy week" jadwal live: duplikasi slot satu minggu (Senin-start) ke minggu target
// dengan offset hari yang sama, lalu reset semua field yang bersifat "state minggu
// berjalan" (status, kesiapan PK/TAP, verifikasi) supaya minggu baru mulai bersih.

import { addDays, diffDaysYMD, type YMD } from "./weeks";

export type CopySourceSlot = {
  mcn_creator_id: string;
  schedule_date: YMD;
  start_time: string | null;
  end_time: string | null;
  status: "scheduled" | "tentative" | "off" | "done";
  brand_name: string | null;
  deal_id: string | null;
  deals_by: "bd" | "cm" | "creator" | null;
  ads_payer: "brand" | "mea" | "invoicing_mea" | "organik" | null;
  ads_note: string | null;
  product_set_title: string | null;
  fokus_produk: string | null;
};

export type CopiedSlot = {
  mcn_creator_id: string;
  schedule_date: YMD;
  start_time: string | null;
  end_time: string | null;
  status: "scheduled";
  off_reason: null;
  brand_name: string | null;
  deal_id: string | null;
  deals_by: "bd" | "cm" | "creator" | null;
  ads_payer: "brand" | "mea" | "invoicing_mea" | "organik" | null;
  ads_note: string | null;
  pk_ready: false;
  product_set_title: string | null;
  product_connected_tap: false;
  fokus_produk: string | null;
  actual_start: null;
  actual_end: null;
  verified_by: null;
  verified_at: null;
};

// `slots` diasumsikan berasal dari satu minggu Senin-start (mis. hasil query per
// ?week=YYYY-MM-DD di halaman Jadwal Live). Senin sumber diturunkan sbg tanggal
// paling awal di antara slot yang tersisa setelah slot 'off' dibuang.
export function buildCopiedSlots(slots: CopySourceSlot[], targetMonday: YMD): CopiedSlot[] {
  const active = slots.filter((s) => s.status !== "off"); // skip OFF — tak ada yg dicopy
  if (active.length === 0) return [];

  const sourceMonday = active.reduce(
    (min, s) => (s.schedule_date < min ? s.schedule_date : min),
    active[0].schedule_date,
  );

  return active.map((s) => {
    const offsetDays = diffDaysYMD(sourceMonday, s.schedule_date);
    const targetDate = addDays(targetMonday, offsetDays);
    return {
      mcn_creator_id: s.mcn_creator_id,
      schedule_date: targetDate,
      start_time: s.start_time,
      end_time: s.end_time,
      status: "scheduled",
      off_reason: null,
      brand_name: s.brand_name,
      deal_id: s.deal_id,
      deals_by: s.deals_by,
      ads_payer: s.ads_payer,
      ads_note: s.ads_note,
      pk_ready: false,
      product_set_title: s.product_set_title,
      product_connected_tap: false,
      fokus_produk: s.fokus_produk,
      actual_start: null,
      actual_end: null,
      verified_by: null,
      verified_at: null,
    };
  });
}
