-- =============================================================================
-- MSDPS · Fase B · Module 1 — Leads Database (`LEAD-…`, `PRSP-…`)
-- =============================================================================
-- Lead record = one canonical entry per real merchant lead (dedup by normalized
-- phone). Prospect attempt = a BizDev's working copy. Pool leads are contestable
-- (many attempts); the first attempt to reach [Closed - Success] WINS and all
-- other open attempts auto-close as [Closed - Kalah Kompetisi] — atomically.
-- =============================================================================

create type lead_source as enum (
  'Scouting','Leads-Socmed','Leads-Iklan','Website','Referral','Broadcast',
  'Event','Kulwa-Webinar','GO-Program','Database','Others'
);
create type lead_origin_type as enum ('Pool','Scouted');
create type lead_status as enum (
  '[Pool]','[Scouted - Aktif]','[Closed - Success]','[Tidak Berkualitas]','[Ditolak]'
);
create type attempt_status as enum (
  '[Pending Validation]','[New Lead]','[Contacted]','[Qualified]','[Not Qualified]',
  '[Negotiation]','[Closed - Success]','[Closed - Lost]','[Closed - Kalah Kompetisi]'
);
create type not_qualified_reason as enum (
  '[Bukan merchant/seller]','[Skala terlalu kecil]','[Tidak ada respon]','[Lainnya]'
);

-- Indonesia phone normalization (OTA-6): strip non-digits, drop leading 0, force +62.
create or replace function normalize_phone_id(p text)
returns text language sql immutable set search_path = public as $$
  select case when p is null or btrim(p) = '' then null else
    '+62' || regexp_replace(regexp_replace(regexp_replace(p, '[^0-9]', '', 'g'), '^0', ''), '^62', '')
  end
$$;

create table leads (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique,                     -- LEAD-YYYYMM-NNNN
  lead_name              text not null,
  phone_raw              text not null,
  phone_normalized       text not null,                   -- dedup primary key
  email                  text,
  source                 lead_source not null,
  origin_type            lead_origin_type not null default 'Pool',
  origin_campaign_id     uuid references campaigns(id),
  last_touch_campaign_id uuid references campaigns(id),
  status                 lead_status not null default '[Pool]',
  stale                  boolean not null default false,  -- 24h TTL flag (pg_cron)
  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  status_changed_by      uuid,
  status_changed_at      timestamptz
);

-- Hard dedup backstop: one lead record per normalized phone.
create unique index leads_phone_uniq on leads (phone_normalized);

create table prospect_attempts (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,                      -- PRSP- (issued at [New Lead]+)
  parent_lead_id        uuid not null references leads(id),
  owner_id              uuid not null references employees(id),
  status                attempt_status not null default '[Pending Validation]',
  not_qualified_reason  not_qualified_reason,
  won                   boolean not null default false,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  status_changed_by     uuid,
  status_changed_at     timestamptz
);

-- ---- Leads: validation + ID ----
create or replace function leads_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone_raw is not null then
    new.phone_normalized := normalize_phone_id(new.phone_raw);
  end if;
  if new.lead_name is null or btrim(new.lead_name) = ''
     or new.phone_normalized is null
     or new.source is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;
  if new.source in ('Leads-Iklan','Broadcast','Event','Kulwa-Webinar','GO-Program')
     and new.origin_campaign_id is null then
    raise exception '[kampanye asal wajib untuk sumber ini]' using errcode = 'check_violation';
  end if;
  if new.code is null then
    new.code := next_code('LEAD');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_leads_validate before insert or update on leads
  for each row execute function leads_validate();
create trigger trg_leads_status before update on leads
  for each row execute function enforce_status_transition('lead');
create trigger trg_leads_audit after insert or update on leads
  for each row execute function capture_audit('lead');

-- ---- Attempts: validation + ID + win side-effects ----
create or replace function attempts_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = '[Not Qualified]' and new.not_qualified_reason is null then
    raise exception '[alasan tidak berkualitas wajib diisi]' using errcode = 'check_violation';
  end if;
  if new.status = '[Closed - Success]' then
    new.won := true;
  end if;
  -- Prospect ID issued once the attempt is validated (i.e. leaves Pending Validation).
  if new.code is null and new.status <> '[Pending Validation]' then
    new.code := next_code('PRSP');
  elsif tg_op = 'UPDATE' and old.code is not null and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Atomic win resolution (M1 §6). NOTE: M4 will CREATE OR REPLACE this to also
-- generate the Merchant + Transaction + Service(s) from the winning attempt.
create or replace function attempts_on_win()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = '[Closed - Success]' and old.status is distinct from '[Closed - Success]' then
    update prospect_attempts
      set status = '[Closed - Kalah Kompetisi]'
      where parent_lead_id = new.parent_lead_id
        and id <> new.id
        and status in ('[Pending Validation]','[New Lead]','[Contacted]','[Qualified]','[Negotiation]');
    update leads set status = '[Closed - Success]' where id = new.parent_lead_id;
  end if;
  return null;
end $$;

create trigger trg_attempts_validate before insert or update on prospect_attempts
  for each row execute function attempts_validate();
create trigger trg_attempts_status before update on prospect_attempts
  for each row execute function enforce_status_transition('prospect_attempt');
create trigger trg_attempts_win after update on prospect_attempts
  for each row execute function attempts_on_win();
create trigger trg_attempts_audit after insert or update on prospect_attempts
  for each row execute function capture_audit('prospect_attempt');

-- ---- Transitions ----
insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('lead','[Pool]','[Closed - Success]',           null),
  ('lead','[Scouted - Aktif]','[Closed - Success]',null),
  ('lead','[Pool]','[Tidak Berkualitas]',          null),
  ('lead','[Scouted - Aktif]','[Tidak Berkualitas]',null),
  ('lead','[Scouted - Aktif]','[Ditolak]',         null),
  ('lead','[Tidak Berkualitas]','[Pool]',          null),
  ('lead','[Ditolak]','[Pool]',                    null);

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('prospect_attempt','[Pending Validation]','[New Lead]',        null),
  ('prospect_attempt','[New Lead]','[Contacted]',                 null),
  ('prospect_attempt','[Contacted]','[Qualified]',               null),
  ('prospect_attempt','[Contacted]','[Not Qualified]',           null),
  ('prospect_attempt','[Qualified]','[Negotiation]',             null),
  ('prospect_attempt','[Qualified]','[Not Qualified]',           null),
  ('prospect_attempt','[Negotiation]','[Closed - Success]',      null),
  ('prospect_attempt','[Negotiation]','[Closed - Lost]',         null),
  ('prospect_attempt','[Pending Validation]','[Closed - Kalah Kompetisi]', null),
  ('prospect_attempt','[New Lead]','[Closed - Kalah Kompetisi]', null),
  ('prospect_attempt','[Contacted]','[Closed - Kalah Kompetisi]',null),
  ('prospect_attempt','[Qualified]','[Closed - Kalah Kompetisi]',null),
  ('prospect_attempt','[Negotiation]','[Closed - Kalah Kompetisi]',null);

-- ---- RLS ----
-- Leads are a shared pool worked by BizDev; Marketing imports them. Division-level
-- read is appropriate (attempts carry the per-owner privacy).
alter table leads enable row level security;
create policy leads_select on leads for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','Marketing'));
create policy leads_insert on leads for insert to authenticated
  with check (auth_division() in ('BizDev','Marketing') or is_director());
create policy leads_update on leads for update to authenticated
  using (auth_division() in ('BizDev','Marketing') or is_director());

alter table prospect_attempts enable row level security;
create policy attempts_select on prospect_attempts for select to authenticated
  using (
    is_od() or is_director()
    or (auth_division() = 'BizDev' and (owner_id = auth_emp_id() or is_lead()))
  );
create policy attempts_insert on prospect_attempts for insert to authenticated
  with check (auth_division() = 'BizDev' and owner_id = auth_emp_id());
create policy attempts_update on prospect_attempts for update to authenticated
  using (
    owner_id = auth_emp_id()
    or (is_lead() and auth_division() = 'BizDev')
    or is_director()
  );
