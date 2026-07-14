-- =============================================================================
-- MSDPS · Seed (example) — Indonesian public holidays for SLA working-day math.
-- =============================================================================
-- working_calendar defaults to Mon-Fri = working when a date is absent, so you
-- ONLY need to insert exceptions (holidays + any "cuti bersama"/weekend work).
-- Below is an illustrative 2026 set — replace with the official HR calendar.
-- =============================================================================

insert into working_calendar (cal_date, is_working_day, note) values
  ('2026-01-01', false, 'Tahun Baru'),
  ('2026-03-19', false, 'Hari Raya Nyepi (contoh)'),
  ('2026-03-20', false, 'Idul Fitri (contoh)'),
  ('2026-03-21', false, 'Idul Fitri (contoh)'),
  ('2026-05-01', false, 'Hari Buruh'),
  ('2026-06-01', false, 'Hari Lahir Pancasila'),
  ('2026-08-17', false, 'HUT RI'),
  ('2026-12-25', false, 'Natal')
on conflict (cal_date) do update
  set is_working_day = excluded.is_working_day, note = excluded.note;
