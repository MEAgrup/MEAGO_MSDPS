-- =============================================================================
-- MSDPS · Phase 0 · Migration 0006 — Working calendar (SLA "hari kerja")
-- =============================================================================
-- Resolves OTA-5. Module 12 SLAs are stated in working days:
--   E-commerce 3 working days / 20 SKU (pro-rata)
--   Ads        6 working days to go-live
--   KOL        5 working days  [your decision, overrides PRD's provisional 7]
--   LiveStream start within 3 working days of vendor forward
--
-- A calendar table lets ops mark public holidays. add_working_days() counts
-- forward over working days only; pro-rata fractions round UP (ceil) so an SLA
-- target is never shorter than the entitlement.
-- =============================================================================

create table working_calendar (
  cal_date       date primary key,
  is_working_day boolean not null,
  note           text                 -- e.g. 'Idul Fitri', 'Cuti Bersama'
);

comment on table working_calendar is 'Per-date working-day flag for SLA math. Default Mon-Fri = working; admin marks holidays.';

-- Returns the date that is p_days working days after p_start (ceil of fractional).
-- Falls back to Mon-Fri logic for dates not present in the calendar table.
create or replace function add_working_days(p_start date, p_days numeric)
returns date
language plpgsql stable security definer set search_path = public as $$
declare
  v_remaining int := ceil(p_days)::int;
  v_date date := p_start;
  v_is_working boolean;
begin
  while v_remaining > 0 loop
    v_date := v_date + 1;
    select is_working_day into v_is_working from working_calendar where cal_date = v_date;
    if v_is_working is null then
      v_is_working := extract(isodow from v_date) < 6;   -- Mon..Fri default
    end if;
    if v_is_working then
      v_remaining := v_remaining - 1;
    end if;
  end loop;
  return v_date;
end $$;

comment on function add_working_days(date, numeric) is 'SLA due-date helper. Fractional days round up. Uses working_calendar, falls back to Mon-Fri.';

-- Reference data: readable by all internal users, editable by Director/OD.
alter table working_calendar enable row level security;

create policy working_calendar_select on working_calendar
  for select to authenticated using (true);

create policy working_calendar_manage on working_calendar
  for all to authenticated
  using (is_director() or is_od())
  with check (is_director() or is_od());
