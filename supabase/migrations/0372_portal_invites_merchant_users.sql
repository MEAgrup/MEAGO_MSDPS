-- =============================================================================
-- MSDPS · Portal · Migration 0372 — "Kirim Akses Portal" (undangan sekali pakai)
-- =============================================================================
-- Kenapa ada: hanya prospek yang CLOSING yang boleh punya akun portal, dan
-- aksesnya dikirim manual oleh tim lewat WhatsApp (bukan email otomatis).
--
-- Syarat closing (ditegakkan di DATABASE, bukan hanya UI):
--   kreator  = prospek [Bound] DAN mcn_creators.binding_status = 'Bound creators'
--              (Kirim Akses: Acquisition / OD / Director)
--   merchant = leads.crm_status Dealing/Renewal DAN sudah ada brand_deals untuk
--              lead itu (cara BizDev bekerja sekarang; keputusan Yohan
--              2026-10-19). Kirim Akses: BizDev / OD / Director.
--
--   portal_invites        : token aktivasi sekali pakai, berlaku 72 jam. Hanya
--                           sha256-nya yang disimpan — token mentah tidak pernah
--                           menyentuh database. Kirim ulang = token lama di-revoke.
--   merchant_portal_users : tautan akun auth ↔ lead merchant (merchant_id diisi
--                           bila lead sudah punya baris merchants via close_deal).
--
-- Alur: server action (sesi staf) → portal_invite_precheck() → buat/pakai ulang
-- auth user (service role, email_confirm, TANPA email Supabase) →
-- portal_grant_access() dengan sesi staf (audit actor = staf) → link wa.me.
-- /aktivasi memakai portal_invite_check()/portal_invite_consume() (service role).
--
-- Pencabutan otomatis (default keputusan #6):
--   * binding_status lepas dari 'Bound creators' → undangan terbuka di-revoke;
--     akses portal sendiri tertolak karena auth_creator_id() mensyaratkan Bound
--     (migrasi 0373) — berlaku di request berikutnya.
--   * lead merchant berubah ke 'Rejected' → merchant_portal_users nonaktif +
--     undangan terbuka di-revoke. BizDev lead/OD juga bisa mencabut manual.
-- Semua perubahan tercatat di audit_log lewat capture_audit.
-- Idempoten dan aman dijalankan berulang.
-- =============================================================================

-- ---- 1. Tabel ---------------------------------------------------------------
create table if not exists portal_invites (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('creator','merchant')),
  target_id      uuid not null,        -- creator: mcn_creators.id · merchant: leads.id
  source_id      uuid,                 -- creator: creator_prospects.id · merchant: leads.id
  auth_user_id   uuid not null references auth.users(id) on delete cascade,
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at     timestamptz not null default now() + interval '72 hours',
  used_at        timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);

create index if not exists portal_invites_target_idx on portal_invites (kind, target_id);

comment on table portal_invites is
  'Undangan aktivasi portal sekali pakai (72 jam). token_hash = sha256 hex token; token mentah tidak disimpan. Ditulis hanya lewat portal_grant_access / portal_invite_consume / trigger pencabutan. Migrasi 0372.';

create table if not exists merchant_portal_users (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references leads(id) on delete cascade,
  merchant_id        uuid references merchants(id),
  auth_user_id       uuid not null references auth.users(id) on delete cascade,
  role               text not null default 'owner' check (role in ('owner','staff')),
  active             boolean not null default true,
  deactivated_at     timestamptz,
  deactivated_reason text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  unique (lead_id, auth_user_id)
);

create index if not exists merchant_portal_users_auth_idx on merchant_portal_users (auth_user_id);

comment on table merchant_portal_users is
  'Akun Merchant Portal ↔ lead merchant yang closing (Dealing/Renewal + brand_deals). active=false = akses dicabut. Ditulis hanya lewat RPC portal_*. Migrasi 0372.';

create or replace trigger trg_portal_invites_audit after insert or update on portal_invites
  for each row execute function capture_audit('portal_invite');

create or replace trigger trg_merchant_portal_users_audit after insert or update on merchant_portal_users
  for each row execute function capture_audit('merchant_portal_user');

alter table portal_invites enable row level security;
alter table merchant_portal_users enable row level security;

do $$ begin
  create policy portal_invites_select on portal_invites for select to authenticated
    using (is_od() or is_director()
           or (kind = 'creator'  and auth_division() = 'Acquisition')
           or (kind = 'merchant' and auth_division() = 'BizDev'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy merchant_portal_users_select on merchant_portal_users for select to authenticated
    using (is_od() or is_director() or auth_division() = 'BizDev' or auth_user_id = auth.uid());
exception when duplicate_object then null; end $$;
-- Tidak ada policy tulis: hanya RPC security definer di bawah.

-- ---- 2. Syarat closing ------------------------------------------------------
create or replace function portal_creator_eligible(p_creator_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from mcn_creators
                  where id = p_creator_id and binding_status = 'Bound creators')
$$;

create or replace function portal_merchant_eligible(p_lead_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from leads l
                  where l.id = p_lead_id and l.crm_status in ('Dealing','Renewal')
                    and exists (select 1 from brand_deals d where d.lead_id = l.id))
$$;

-- ---- 3. Precheck (sesi staf): siapa target, email, WA -------------------------
create or replace function portal_invite_precheck(p_kind text, p_source_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_p creator_prospects; v_c mcn_creators; v_l leads; v_auth uuid;
begin
  if p_kind = 'creator' then
    if not (is_od() or is_director() or auth_division() = 'Acquisition') then
      raise exception '[hanya Acquisition yang dapat mengirim akses Creator Portal]' using errcode = 'insufficient_privilege';
    end if;
    select * into v_p from creator_prospects where id = p_source_id;
    if not found then
      raise exception '[prospek tidak ditemukan]' using errcode = 'no_data_found';
    end if;
    if v_p.status <> '[Bound]' or v_p.matched_mcn_creator_id is null
       or not portal_creator_eligible(v_p.matched_mcn_creator_id) then
      raise exception '[akses portal hanya untuk kreator Bound (binding agency MEAGO!)]' using errcode = 'check_violation';
    end if;
    if v_p.email is null then
      raise exception '[email prospek kosong — lengkapi dulu]' using errcode = 'check_violation';
    end if;
    select * into v_c from mcn_creators where id = v_p.matched_mcn_creator_id;
    return jsonb_build_object('kind', 'creator', 'target_id', v_c.id, 'source_id', v_p.id,
      'email', v_p.email, 'nama', v_p.nama, 'phone', v_p.phone_normalized,
      'existing_auth_user_id', v_c.auth_user_id);

  elsif p_kind = 'merchant' then
    if not (is_od() or is_director() or auth_division() = 'BizDev') then
      raise exception '[hanya BizDev yang dapat mengirim akses Merchant Portal]' using errcode = 'insufficient_privilege';
    end if;
    select * into v_l from leads where id = p_source_id;
    if not found then
      raise exception '[lead tidak ditemukan]' using errcode = 'no_data_found';
    end if;
    if not portal_merchant_eligible(v_l.id) then
      raise exception '[akses portal hanya untuk merchant closing (Dealing/Renewal + ada deal)]' using errcode = 'check_violation';
    end if;
    if nullif(btrim(v_l.email), '') is null then
      raise exception '[email lead kosong — lengkapi dulu]' using errcode = 'check_violation';
    end if;
    select auth_user_id into v_auth from merchant_portal_users
     where lead_id = v_l.id and role = 'owner' order by created_at limit 1;
    return jsonb_build_object('kind', 'merchant', 'target_id', v_l.id, 'source_id', v_l.id,
      'email', lower(btrim(v_l.email)), 'nama', coalesce(v_l.brand_name, v_l.lead_name),
      'phone', coalesce(v_l.pic_phone, normalize_phone_62(v_l.phone_normalized)),
      'existing_auth_user_id', v_auth);
  end if;
  raise exception '[jenis portal tidak dikenal]' using errcode = 'check_violation';
end $$;

-- ---- 4. Grant (sesi staf): tautkan akun + terbitkan token ---------------------
create or replace function portal_grant_access(
  p_kind text, p_source_id uuid, p_auth_user_id uuid, p_token_hash text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_pre jsonb := portal_invite_precheck(p_kind, p_source_id);
  v_target uuid := (v_pre->>'target_id')::uuid;
  v_linked uuid;
  v_inv portal_invites;
begin
  if p_auth_user_id is null or not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception '[akun auth tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  if exists (select 1 from employees where id = p_auth_user_id) then
    raise exception '[email ini milik akun karyawan — gunakan email lain]' using errcode = 'check_violation';
  end if;

  if p_kind = 'creator' then
    if exists (select 1 from merchant_portal_users where auth_user_id = p_auth_user_id) then
      raise exception '[email ini sudah dipakai akun Merchant Portal]' using errcode = 'check_violation';
    end if;
    select auth_user_id into v_linked from mcn_creators where id = v_target for update;
    if v_linked is null then
      update mcn_creators set auth_user_id = p_auth_user_id where id = v_target;
    elsif v_linked <> p_auth_user_id then
      raise exception '[kreator ini sudah tertaut ke akun lain]' using errcode = 'check_violation';
    end if;
  else
    if exists (select 1 from mcn_creators where auth_user_id = p_auth_user_id) then
      raise exception '[email ini sudah dipakai akun Creator Portal]' using errcode = 'check_violation';
    end if;
    insert into merchant_portal_users (lead_id, merchant_id, auth_user_id, role, active)
    values (v_target,
            (select m.id from merchants m join prospect_attempts pa on pa.id = m.source_attempt_id
              where pa.parent_lead_id = v_target limit 1),
            p_auth_user_id, 'owner', true)
    on conflict (lead_id, auth_user_id) do update
      set active = true, deactivated_at = null, deactivated_reason = null
      where merchant_portal_users.active is distinct from true;
  end if;

  update portal_invites
     set revoked_at = now(), revoked_reason = 'diganti token baru'
   where kind = p_kind and target_id = v_target and used_at is null and revoked_at is null;

  insert into portal_invites (kind, target_id, source_id, auth_user_id, token_hash)
  values (p_kind, v_target, p_source_id, p_auth_user_id, lower(p_token_hash))
  returning * into v_inv;

  return jsonb_build_object('invite_id', v_inv.id, 'expires_at', v_inv.expires_at,
    'nama', v_pre->>'nama', 'phone', v_pre->>'phone', 'email', v_pre->>'email');
end $$;

-- ---- 5. Service role: cari akun auth per email --------------------------------
create or replace function portal_auth_user_lookup(p_email text) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('id', u.id,
      'is_employee', exists (select 1 from employees e where e.id = u.id))
      from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1),
    '{}'::jsonb)
$$;

-- ---- 6. Service role: aktivasi ------------------------------------------------
create or replace function portal_invite_check(p_token_hash text) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare v portal_invites; v_email text; v_ok boolean;
begin
  select * into v from portal_invites where token_hash = lower(p_token_hash);
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  select email into v_email from auth.users where id = v.auth_user_id;
  v_ok := case v.kind
            when 'creator'  then portal_creator_eligible(v.target_id)
                                 and exists (select 1 from mcn_creators
                                              where id = v.target_id and auth_user_id = v.auth_user_id)
            else portal_merchant_eligible(v.target_id)
                 and exists (select 1 from merchant_portal_users
                              where lead_id = v.target_id and auth_user_id = v.auth_user_id and active)
          end;
  return jsonb_build_object(
    'status', case when v.revoked_at is not null then 'revoked'
                   when v.used_at is not null then 'used'
                   when v.expires_at < now() then 'expired'
                   when not v_ok then 'ineligible'
                   else 'valid' end,
    'kind', v.kind, 'auth_user_id', v.auth_user_id, 'email', v_email);
end $$;

create or replace function portal_invite_consume(p_token_hash text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_check jsonb;
begin
  perform 1 from portal_invites where token_hash = lower(p_token_hash) for update;
  v_check := portal_invite_check(p_token_hash);
  if v_check->>'status' <> 'valid' then
    raise exception '[link aktivasi tidak berlaku: %]', v_check->>'status' using errcode = 'check_violation';
  end if;
  update portal_invites set used_at = now() where token_hash = lower(p_token_hash);
  return v_check;
end $$;

-- ---- 7. Pencabutan ------------------------------------------------------------
create or replace function portal_revoke_on_binding_change() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if old.binding_status = 'Bound creators' and new.binding_status is distinct from 'Bound creators' then
    update portal_invites
       set revoked_at = now(), revoked_reason = 'binding_status berubah: ' || coalesce(new.binding_status, 'kosong')
     where kind = 'creator' and target_id = new.id and used_at is null and revoked_at is null;
  end if;
  return new;
end $$;

create or replace trigger trg_mcn_creators_portal_revoke after update of binding_status on mcn_creators
  for each row execute function portal_revoke_on_binding_change();

create or replace function portal_revoke_on_lead_rejected() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.crm_status = 'Rejected' and old.crm_status is distinct from 'Rejected' then
    update merchant_portal_users
       set active = false, deactivated_at = now(), deactivated_reason = 'lead Rejected'
     where lead_id = new.id and active;
    update portal_invites
       set revoked_at = now(), revoked_reason = 'lead Rejected'
     where kind = 'merchant' and target_id = new.id and used_at is null and revoked_at is null;
  end if;
  return new;
end $$;

create or replace trigger trg_leads_portal_revoke after update of crm_status on leads
  for each row execute function portal_revoke_on_lead_rejected();

create or replace function portal_set_merchant_user_active(p_id uuid, p_active boolean) returns void
  language plpgsql security definer set search_path = public as $$
declare v_lead uuid;
begin
  if not (is_od() or is_director() or (auth_division() = 'BizDev' and is_lead())) then
    raise exception '[hanya BizDev lead / OD / Director yang dapat mengubah akses merchant]' using errcode = 'insufficient_privilege';
  end if;
  select lead_id into v_lead from merchant_portal_users where id = p_id for update;
  if not found then
    raise exception '[akun merchant tidak ditemukan]' using errcode = 'no_data_found';
  end if;
  if p_active and not portal_merchant_eligible(v_lead) then
    raise exception '[lead belum/tidak lagi closing — akses tidak bisa diaktifkan]' using errcode = 'check_violation';
  end if;
  update merchant_portal_users
     set active = p_active,
         deactivated_at = case when p_active then null else now() end,
         deactivated_reason = case when p_active then null else 'dicabut manual' end
   where id = p_id;
  if not p_active then
    update portal_invites set revoked_at = now(), revoked_reason = 'akses dicabut manual'
     where kind = 'merchant' and target_id = v_lead and used_at is null and revoked_at is null;
  end if;
end $$;

-- ---- 8. Hak eksekusi ----------------------------------------------------------
revoke execute on function portal_revoke_on_binding_change(), portal_revoke_on_lead_rejected()
  from public, anon, authenticated;

revoke execute on function portal_creator_eligible(uuid), portal_merchant_eligible(uuid),
  portal_invite_precheck(text, uuid), portal_grant_access(text, uuid, uuid, text),
  portal_set_merchant_user_active(uuid, boolean) from public, anon;
grant execute on function portal_creator_eligible(uuid), portal_merchant_eligible(uuid),
  portal_invite_precheck(text, uuid), portal_grant_access(text, uuid, uuid, text),
  portal_set_merchant_user_active(uuid, boolean) to authenticated;

revoke execute on function portal_auth_user_lookup(text), portal_invite_check(text),
  portal_invite_consume(text) from public, anon, authenticated;
grant execute on function portal_auth_user_lookup(text), portal_invite_check(text),
  portal_invite_consume(text) to service_role;
