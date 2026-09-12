-- =============================================================================
-- MSDPS · Pensiun Account & Service — penutupan §5 P5+P7 · migrasi 0363
-- =============================================================================
-- Jawaban pemilik atas dua pertanyaan terbuka di
-- docs/HANDOFF_PENSIUN_ACCOUNT_SERVICE_20260912.md §5:
--
-- P5 (ya) — cron M13/M14 sudah di-unschedule (migr. 0361), tapi
-- generate_health_snapshots/_monthly dan generate_performance_scores masih
-- bisa dipanggil manual oleh OD/Director (fungsinya sendiri menggerbangi
-- `is_od() or is_director()`, bukan cuma cron yang mati). Modul M6-M15
-- pensiun ⇒ jalur tulis manual terakhir ini ditutup juga, simetris dengan
-- `forms.tsx`/lib/actions/{account,...} yang sudah dibiarkan yatim di UI
-- (migr. 0361, alasan sama: tutup jalur, jangan hapus baris).
-- REVERSIBEL dengan satu `grant execute ... to authenticated` — nol DROP.
--
-- P7 (ditandai inert, bukan dibiarkan tanpa keterangan) — `okr_targets` lama
-- (enum perf_role) dan `v_okr_attainment` lama TETAP HIDUP tanpa `DROP`
-- (alasan sudah dicatat migr. 0361: alter type enum tidak bisa dibatalkan),
-- tapi keduanya sekarang beri `comment on` yang menunjuk pembacanya ke
-- pengganti (`okr_targets_meago` / `v_okr_attainment_meago`, migr. 0361) —
-- supaya siapa pun yang membuka skema tidak mengira ini masih sumber
-- kebenaran OKR yang dibaca UI.
-- =============================================================================

revoke execute on function generate_health_snapshots(date)   from authenticated;
revoke execute on function generate_health_monthly(char)      from authenticated;
revoke execute on function generate_performance_scores(date)  from authenticated;

comment on function generate_health_snapshots(date) is
  'DITUTUP dari authenticated 2026-09-12 (migr. 0363, P5) — M13 pensiun (migr. 0361), cron msdps_health_weekly/monthly sudah unschedule. Reversibel: grant execute ... to authenticated.';
comment on function generate_health_monthly(char) is
  'DITUTUP dari authenticated 2026-09-12 (migr. 0363, P5) — M13 pensiun (migr. 0361), cron msdps_health_weekly/monthly sudah unschedule. Reversibel: grant execute ... to authenticated.';
comment on function generate_performance_scores(date) is
  'DITUTUP dari authenticated 2026-09-12 (migr. 0363, P5) — M14 pensiun (migr. 0361), cron msdps_perf_weekly sudah unschedule. Reversibel: grant execute ... to authenticated.';

comment on table okr_targets is
  'INERT sejak 2026-09-12 (migr. 0361 P.7/0363) — OKR MSDPS menilai divisi non-operasional lewat okr_targets_meago (jenis kolom text, bukan enum perf_role). Baris lama TETAP di sini (nol DROP, alter type enum tidak bisa dibatalkan), tapi tidak dibaca UI mana pun lagi.';
comment on view v_okr_attainment is
  'INERT sejak 2026-09-12 (migr. 0361 P.7/0363) — pengganti dibaca UI adalah v_okr_attainment_meago. View ini TETAP ada (nol DROP) tapi tidak dibaca /okr lagi.';
