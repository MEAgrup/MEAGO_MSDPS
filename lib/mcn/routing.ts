// State machine murni untuk routing campaign (BizDev <-> CM <-> brand). Tidak ada
// I/O di sini sama sekali — server action di lib/actions/bizdev.ts yang memanggil
// fungsi ini lalu menulis hasilnya + audit. Transisi ilegal SELALU ditolak dgn pesan
// Indonesia yang jelas (bukan throw), supaya action layer tinggal meneruskan ke UI.

export type CmConfirmStatus = "menunggu" | "mau" | "tidak";
export type BrandAccStatus = "n_a" | "menunggu" | "approved" | "ditolak";
export type FinalStatus = "proses" | "fix" | "batal";

export type CampaignRoutingState = {
  cm_confirm_status: CmConfirmStatus;
  needs_brand_acc: boolean;
  brand_acc_status: BrandAccStatus;
  final_status: FinalStatus;
  handover_done: boolean;
};

export type CampaignRoutingEvent =
  | "route"
  | "cm_mau"
  | "cm_tidak"
  | "brand_approve"
  | "brand_reject"
  | "finalize_fix"
  | "finalize_batal"
  | "handover";

export type CampaignRoutingResult =
  | { ok: true; next: CampaignRoutingState }
  | { ok: false; error: string };

export function campaignRoutingNext(
  state: CampaignRoutingState,
  event: CampaignRoutingEvent,
): CampaignRoutingResult {
  switch (event) {
    case "route": {
      // "route" hanya menegaskan campaign request masih dalam kondisi baru (owner_cpm
      // sudah di-derive otomatis di lapisan action saat insert) — tak mengubah state.
      const isFresh =
        state.cm_confirm_status === "menunggu" &&
        state.final_status === "proses" &&
        !state.handover_done;
      if (!isFresh) {
        return {
          ok: false,
          error: "Routing hanya berlaku untuk campaign request yang baru dan belum diproses.",
        };
      }
      return { ok: true, next: { ...state } };
    }

    case "cm_mau": {
      if (state.cm_confirm_status !== "menunggu") {
        return {
          ok: false,
          error: `CM sudah konfirmasi sebelumnya (status saat ini: ${state.cm_confirm_status}).`,
        };
      }
      return {
        ok: true,
        next: {
          ...state,
          cm_confirm_status: "mau",
          // Bila butuh acc brand, sekarang baru relevan menunggu -> pindah dari 'n_a'.
          brand_acc_status: state.needs_brand_acc ? "menunggu" : state.brand_acc_status,
        },
      };
    }

    case "cm_tidak": {
      if (state.cm_confirm_status !== "menunggu") {
        return {
          ok: false,
          error: `CM sudah konfirmasi sebelumnya (status saat ini: ${state.cm_confirm_status}).`,
        };
      }
      return { ok: true, next: { ...state, cm_confirm_status: "tidak" } };
    }

    case "brand_approve":
    case "brand_reject": {
      if (!state.needs_brand_acc) {
        return { ok: false, error: "Campaign request ini tidak memerlukan approval brand." };
      }
      if (state.cm_confirm_status !== "mau") {
        return { ok: false, error: "CM belum konfirmasi 'mau' — approval brand belum relevan." };
      }
      if (state.brand_acc_status !== "menunggu") {
        return {
          ok: false,
          error: `Approval brand sudah diproses sebelumnya (status: ${state.brand_acc_status}).`,
        };
      }
      return {
        ok: true,
        next: { ...state, brand_acc_status: event === "brand_approve" ? "approved" : "ditolak" },
      };
    }

    case "finalize_fix": {
      if (state.final_status !== "proses") {
        return {
          ok: false,
          error: `Campaign request sudah difinalisasi (status: ${state.final_status}).`,
        };
      }
      if (state.cm_confirm_status !== "mau") {
        return { ok: false, error: "CM belum konfirmasi 'mau' — tidak bisa finalisasi fix." };
      }
      if (state.needs_brand_acc && state.brand_acc_status !== "approved") {
        return { ok: false, error: "Butuh approval brand terlebih dahulu sebelum finalisasi fix." };
      }
      return { ok: true, next: { ...state, final_status: "fix" } };
    }

    case "finalize_batal": {
      // Boleh dari 'proses' kapan pun, tak peduli status konfirmasi CM/brand.
      if (state.final_status !== "proses") {
        return {
          ok: false,
          error: `Campaign request sudah difinalisasi (status: ${state.final_status}).`,
        };
      }
      return { ok: true, next: { ...state, final_status: "batal" } };
    }

    case "handover": {
      if (state.final_status !== "fix") {
        return { ok: false, error: "Handover hanya bisa dilakukan setelah campaign difinalisasi 'fix'." };
      }
      if (state.handover_done) {
        return { ok: false, error: "Handover sudah dilakukan sebelumnya." };
      }
      return { ok: true, next: { ...state, handover_done: true } };
    }

    default: {
      const exhaustiveCheck: never = event;
      return { ok: false, error: `Event tidak dikenali: ${String(exhaustiveCheck)}.` };
    }
  }
}
