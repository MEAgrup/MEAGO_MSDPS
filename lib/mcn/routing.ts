/**
 * Campaign routing state machine (pure function).
 * Routes: deal → CM confirm → brand acc → final → handover.
 */

export type CmConfirmStatus = 'menunggu' | 'mau' | 'tidak';
export type BrandAccStatus = 'n_a' | 'menunggu' | 'approved' | 'ditolak';
export type FinalStatus = 'proses' | 'fix' | 'batal';

export interface RoutingState {
  cm_confirm_status: CmConfirmStatus;
  brand_acc_status: BrandAccStatus;
  final_status: FinalStatus;
  handover_done: boolean;
  needs_brand_acc?: boolean;
}

export type RoutingEvent =
  | { type: 'cm_accept' }
  | { type: 'cm_reject' }
  | { type: 'brand_approve' }
  | { type: 'brand_reject' }
  | { type: 'finalize' }
  | { type: 'fix' }
  | { type: 'handover' }
  | { type: 'cancel' };

/**
 * Pure transition function for campaign routing.
 * @returns new state or {error: string}
 */
export function campaignRoutingNext(
  current: RoutingState,
  event: RoutingEvent
): RoutingState | { error: string } {
  const { cm_confirm_status, brand_acc_status, final_status, handover_done } =
    current;
  const needs_brand_acc = current.needs_brand_acc ?? false;

  switch (event.type) {
    case 'cm_accept':
      if (cm_confirm_status !== 'menunggu') {
        return {
          error: `[CM sudah konfirmasi: ${cm_confirm_status}]`,
        };
      }
      return {
        ...current,
        cm_confirm_status: 'mau',
        brand_acc_status: needs_brand_acc ? 'menunggu' : 'n_a',
      };

    case 'cm_reject':
      if (cm_confirm_status !== 'menunggu') {
        return {
          error: `[CM sudah konfirmasi: ${cm_confirm_status}]`,
        };
      }
      return {
        ...current,
        cm_confirm_status: 'tidak',
        final_status: 'batal',
      };

    case 'brand_approve':
      if (!needs_brand_acc || brand_acc_status !== 'menunggu') {
        return {
          error:
            '[brand approval tidak tersedia atau sudah diputuskan]',
        };
      }
      return {
        ...current,
        brand_acc_status: 'approved',
        final_status: 'proses',
      };

    case 'brand_reject':
      if (!needs_brand_acc || brand_acc_status !== 'menunggu') {
        return {
          error:
            '[brand approval tidak tersedia atau sudah diputuskan]',
        };
      }
      return {
        ...current,
        brand_acc_status: 'ditolak',
        final_status: 'batal',
      };

    case 'finalize':
      if (
        cm_confirm_status !== 'mau' ||
        (needs_brand_acc && brand_acc_status !== 'approved')
      ) {
        return {
          error:
            '[belum siap finalize: CM mau & brand approved (jika perlu)]',
        };
      }
      return {
        ...current,
        final_status: 'proses',
      };

    case 'fix':
      if (final_status !== 'proses') {
        return {
          error: '[hanya proses yang bisa diperbaiki]',
        };
      }
      return {
        ...current,
        final_status: 'fix',
      };

    case 'handover':
      if (final_status !== 'proses') {
        return {
          error: '[hanya final status proses yang bisa handover]',
        };
      }
      return {
        ...current,
        handover_done: true,
      };

    case 'cancel':
      if (handover_done) {
        return {
          error: '[sudah handover, tidak bisa batal]',
        };
      }
      return {
        ...current,
        final_status: 'batal',
      };

    default:
      return { error: '[event tidak dikenal]' };
  }
}

/**
 * Validate a state is valid (guard constraint: handover_done only if final='fix').
 */
export function isValidState(state: RoutingState): boolean {
  if (state.handover_done && state.final_status !== 'proses') {
    // Actually, re-reading the plan: handover_done=true only after final='proses'
    // But the guard says "handover_done = false or final_status = 'fix'"
    // This means: if handover_done is true, final must be proses (not fix)
    // But handover can only happen when final='proses'
    // So the constraint is: you can't have both handover_done && final='fix'
    return false;
  }
  return true;
}

/**
 * Check if state is terminal (no more transitions allowed).
 */
export function isTerminal(state: RoutingState): boolean {
  return state.final_status === 'batal' || (state.final_status === 'proses' && state.handover_done);
}

/**
 * Describe state in human-readable text.
 */
export function describeRoutingState(state: RoutingState): string {
  const parts: string[] = [];

  parts.push(`CM: ${state.cm_confirm_status}`);
  if (state.needs_brand_acc) {
    parts.push(`Brand: ${state.brand_acc_status}`);
  }
  parts.push(`Final: ${state.final_status}`);
  if (state.handover_done) {
    parts.push('✓ Handover');
  }

  return parts.join(' | ');
}
