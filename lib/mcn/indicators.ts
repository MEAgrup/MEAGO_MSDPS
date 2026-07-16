/**
 * Live schedule slot indicators and status helpers.
 */

export interface LiveSlot {
  status: 'scheduled' | 'tentative' | 'off' | 'done';
  pk_ready?: boolean;
  product_connected_tap?: boolean;
  verified_at?: string | null;
  schedule_date: string; // YYYY-MM-DD
}

/**
 * Check if slot needs PK setup.
 * Returns true if status ≠ 'off' and pk_ready ≠ true.
 */
export function needsPkSetup(slot: LiveSlot): boolean {
  return slot.status !== 'off' && !slot.pk_ready;
}

/**
 * Check if slot needs TAP (product) setup.
 * Returns true if status ≠ 'off' and product_connected_tap ≠ true.
 */
export function needsTapSetup(slot: LiveSlot): boolean {
  return slot.status !== 'off' && !slot.product_connected_tap;
}

/**
 * Check if slot needs verification (verification pending).
 * Returns true if status ∈ (scheduled, tentative) and schedule_date < today.
 */
export function needsVerification(slot: LiveSlot, today?: string): boolean {
  if (slot.status !== 'scheduled' && slot.status !== 'tentative') {
    return false;
  }

  const todayDate = today ? new Date(today) : new Date();
  const slotDate = new Date(slot.schedule_date);

  return slotDate < todayDate;
}

/**
 * Check if tomorrow is empty (no non-off slots scheduled).
 * @param slots all slots for creator
 * @param today YYYY-MM-DD (defaults to current date)
 * @returns true if tomorrow has no non-off slots
 */
export function isTomorrowEmpty(slots: LiveSlot[], today?: string): boolean {
  const todayDate = today ? new Date(today) : new Date();
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const tomorrowSlots = slots.filter(
    (s) => s.schedule_date === tomorrowStr && s.status !== 'off'
  );

  return tomorrowSlots.length === 0;
}

/**
 * Badge for PK status.
 */
export function pkBadge(slot: LiveSlot): '✓' | '✘' {
  return slot.pk_ready ? '✓' : '✘';
}

/**
 * Badge for TAP status.
 */
export function tapBadge(slot: LiveSlot): '✓' | '✘' {
  return slot.product_connected_tap ? '✓' : '✘';
}

/**
 * Slot needs verification ring (visual indicator).
 */
export function verificationRingIndicator(
  slot: LiveSlot,
  today?: string
): boolean {
  return needsVerification(slot, today);
}

/**
 * Check if slot is locked (done status).
 */
export function isLocked(slot: LiveSlot): boolean {
  return slot.status === 'done';
}
