/**
 * Copy week logic: clone week slots with offset to new week, reset state.
 */

export interface SlotToCopy {
  schedule_date: string; // YYYY-MM-DD
  start_time?: string;
  end_time?: string;
  status: 'scheduled' | 'tentative' | 'off' | 'done';
  brand_name?: string;
  deal_id?: string | null;
  deals_by?: string;
  ads_payer?: string;
  ads_note?: string;
  [key: string]: any;
}

export interface CopiedSlot extends SlotToCopy {
  schedule_date: string;
  status: 'scheduled';
  pk_ready: false;
  product_connected_tap: false;
  verified_by: null;
  verified_at: null;
}

/**
 * Build copied slots for a target Monday (week start).
 * Offset each slot's date to same day-of-week in target week.
 * Reset status to 'scheduled', reset pk/tap/verification, skip OFF slots.
 * @param slots source week slots
 * @param targetMonday YYYY-MM-DD (must be a Monday)
 * @returns copied slots with reset state
 */
export function buildCopiedSlots(
  slots: SlotToCopy[],
  targetMonday: string
): CopiedSlot[] {
  // Find source Monday (earliest date in slots)
  const dates = slots
    .map((s) => new Date(s.schedule_date))
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length === 0) return [];

  const sourceMonday = dates[0];
  const targetMondayDate = new Date(targetMonday);

  // Calculate offset in days
  const offsetMs = targetMondayDate.getTime() - sourceMonday.getTime();
  const offsetDays = Math.round(offsetMs / (24 * 60 * 60 * 1000));

  // Copy each non-OFF slot
  return slots
    .filter((s) => s.status !== 'off')
    .map((s) => {
      const slotDate = new Date(s.schedule_date);
      const newDate = new Date(slotDate.getTime() + offsetDays * 24 * 60 * 60 * 1000);
      const newDateStr = newDate.toISOString().split('T')[0];

      return {
        ...s,
        schedule_date: newDateStr,
        status: 'scheduled',
        pk_ready: false,
        product_connected_tap: false,
        verified_by: null,
        verified_at: null,
      } as CopiedSlot;
    });
}

/**
 * Check if target week already has non-off slots (for conflict detection).
 */
export function targetWeekHasSlots(
  allSlots: SlotToCopy[],
  targetMonday: string
): boolean {
  // Calculate target week's date range (Mon–Sun)
  const targetDate = new Date(targetMonday);
  const targetSunday = new Date(targetDate);
  targetSunday.setDate(targetSunday.getDate() + 6);

  const targetEnd = targetSunday.toISOString().split('T')[0];

  return allSlots.some(
    (s) =>
      s.status !== 'off' &&
      s.schedule_date >= targetMonday &&
      s.schedule_date <= targetEnd
  );
}
