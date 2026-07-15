-- =============================================================================
-- MSDPS · MCN · Migration 0302 — Master Kreator MCN (`MCR-NNNN`)
-- =============================================================================
-- Master kreator affiliate TikTok, TERPISAH dari creators M9 (KOL). code global
-- MCR-NNNN (next_code_global). Unik per (platform, lower(name)). Lifecycle
-- prospek→binding→aktif↔nonaktif (transisi tercatat). GMV di sini = RATA-RATA
-- BULANAN hasil auto-fill ingest; commission_share read-only (sync platform).
-- Scope CPM: staff CM hanya kreator miliknya (owner_cpm_id); Lead CM lintas.
-- =============================================================================

create table mcn_creators (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                                  -- MCR-NNNN
  name              text not null,
  platform          text not null default 'tiktok',
  niche             text,
  top_niches        jsonb,
  status            text not null default 'prospek'
                      check (status in ('prospek','binding','aktif','nonaktif')),
  jenis_creator     text check (jenis_creator in ('live','video','mixed')),
  gmv               numeric,                                      -- rata-rata bulanan
  gmv_live          numeric,
  gmv_video         numeric,
  commission_share  numeric,                                      -- read-only (sync platform)
  owner_cpm_id      uuid references employees(id),
  live_roster       boolean not null default false,
  ads_budget_cap    numeric,
  notes             text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz
);

-- Kreator dipisah per platform: unik (platform, nama lower-case).
create unique index mcn_creators_platform_name_uniq on mcn_creators (platform, lower(name));
create index mcn_creators_owner_idx on mcn_creators (owner_cpm_id);
create index mcn_creators_status_idx on mcn_creators (status);

create or replace function mcn_creators_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.name is null or btrim(new.name) = ''
     or new.platform is null or btrim(new.platform) = '' then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.code is null then
    new.code := next_code_global('MCR');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_mcn_creators_validate before insert or update on mcn_creators
  for each row execute function mcn_creators_validate();
create trigger trg_mcn_creators_status before update on mcn_creators
  for each row execute function enforce_status_transition('mcn_creator');
create trigger trg_mcn_creators_audit after insert or update on mcn_creators
  for each row execute function capture_audit('mcn_creator');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('mcn_creator','prospek','binding',  null),
  ('mcn_creator','prospek','aktif',    null),
  ('mcn_creator','binding','aktif',    null),
  ('mcn_creator','aktif','nonaktif',   null),
  ('mcn_creator','nonaktif','aktif',   null);

-- ---- RLS ----
alter table mcn_creators enable row level security;
create policy mcn_creators_select on mcn_creators for select to authenticated
  using (is_od() or is_director()
         or auth_division() in ('CreatorManagement','BizDev','Acquisition','KOL'));
create policy mcn_creators_insert on mcn_creators for insert to authenticated
  with check (is_od() or is_director()
              or auth_division() in ('CreatorManagement','Acquisition'));
-- Update: mgmt + Lead CM lintas; staff CM hanya kreator miliknya; Acquisition boleh.
create policy mcn_creators_update on mcn_creators for update to authenticated
  using (
    is_od() or is_director()
    or auth_division() = 'Acquisition'
    or (auth_division() = 'CreatorManagement' and (is_lead() or owner_cpm_id = auth_emp_id()))
  );

revoke execute on function mcn_creators_validate() from public, anon, authenticated;
