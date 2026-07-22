-- =============================================================================
-- MSDPS · MCN · Migration 0316 — Status Kontrak + override manual metrik kreator
-- =============================================================================
-- Menambah dukungan edit penuh baris Master Kreator dari UI /meago/creators:
--   1. status_kontrak — kolom baru status kontrak kreator. Nilai terbatas
--      '-' (default / belum diisi), 'kontrak', 'non_kontrak'. Semua baris lama
--      otomatis mendapat default '-'.
--   2. manual_* — override manual untuk 6 kolom metrik yang di UI selama ini
--      DIHITUNG otomatis (rata-rata bulanan 3 bulan) dari creator_period_summary
--      dan tidak disimpan di baris kreator. Bila override diisi (non-null), nilai
--      itulah yang ditampilkan; bila null, UI tetap memakai hasil hitung otomatis.
--      Ini membuat metrik "bisa di-edit" tanpa membongkar pipeline ingest mingguan
--      (ingest menulis creator_period_summary; override tidak disentuh ingest).
--
-- Catatan: trigger validate/status/audit yang ada (0302) tetap berlaku apa adanya —
-- kolom-kolom ini tidak mengubah `status` (state machine) maupun `code`.
-- =============================================================================

alter table mcn_creators
  add column status_kontrak text not null default '-'
    check (status_kontrak in ('-', 'kontrak', 'non_kontrak')),
  add column manual_avg_pay_gmv        numeric,   -- override "Avg Pay GMV"
  add column manual_redeemed_gmv       numeric,   -- override "Redeemed GMV"
  add column manual_total_post         numeric,   -- override "Total post"
  add column manual_posts_with_sales   numeric,   -- override "Posts with sales"
  add column manual_live_stream        numeric,   -- override "Live stream"
  add column manual_valid_live_stream  numeric;   -- override "Valid live stream"

-- Metrik hitungan tidak boleh negatif — jaga integritas nilai override manual.
alter table mcn_creators
  add constraint mcn_creators_manual_metrics_nonneg check (
    (manual_avg_pay_gmv       is null or manual_avg_pay_gmv       >= 0) and
    (manual_redeemed_gmv      is null or manual_redeemed_gmv      >= 0) and
    (manual_total_post        is null or manual_total_post        >= 0) and
    (manual_posts_with_sales  is null or manual_posts_with_sales  >= 0) and
    (manual_live_stream       is null or manual_live_stream       >= 0) and
    (manual_valid_live_stream is null or manual_valid_live_stream >= 0)
  );

comment on column mcn_creators.status_kontrak is
  'Status kontrak kreator: ''-'' (belum diisi), ''kontrak'', ''non_kontrak''. Diisi manual di UI Data Kreator.';
