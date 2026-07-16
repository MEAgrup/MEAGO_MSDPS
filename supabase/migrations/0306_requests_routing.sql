-- =============================================================================
-- MSDPS · MCN · Migration 0306 — Request kreator + Routing campaign
-- =============================================================================
-- creator_requests : permintaan sample/ads/hsl atas kreator. code REQ-YYYYMM-NNNN.
--                    Guard: diajukan→diproses ditolak bila needs_approval dan
--                    belum di-approve. Approval (isi approved_by) HANYA Director
--                    (enforce di trigger).
-- campaign_requests: routing deal→kreator (state machine murni di lib/mcn/routing.ts).
--                    code CRQ-YYYYMM-NNNN. Guard DB minimal: handover hanya bila
--                    final_status='fix' (check constraint). owner_cpm_id auto-derive.
-- =============================================================================

create table creator_requests (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                                  -- REQ-YYYYMM-NNNN
  mcn_creator_id    uuid not null references mcn_creators(id),
  type              text not null check (type in ('sample','ads','hsl')),
  target_brand      text,
  detail            text,
  status            text not null default 'diajukan'
                      check (status in ('diajukan','diproses','selesai','ditolak')),
  needs_approval    boolean not null default false,
  approved_by       uuid references employees(id),
  approved_at       timestamptz,
  requested_by      uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz
);

create index creator_requests_creator_idx on creator_requests (mcn_creator_id, status);

create or replace function creator_requests_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mcn_creator_id is null or new.type is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    -- Approval hanya boleh dilakukan Director.
    if new.approved_by is distinct from old.approved_by and new.approved_by is not null then
      if not is_director() then
        raise exception '[hanya Director yang dapat approve request]'
          using errcode = 'insufficient_privilege';
      end if;
      new.approved_at := coalesce(new.approved_at, now());
    end if;
    -- diajukan→diproses ditolak bila butuh approval tapi belum di-approve.
    if new.status = 'diproses' and old.status = 'diajukan'
       and new.needs_approval and new.approved_by is null then
      raise exception '[request ads melebihi budget cap — butuh approval Director]'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.code is null then
    new.code := next_code('REQ');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_creator_requests_validate before insert or update on creator_requests
  for each row execute function creator_requests_validate();
create trigger trg_creator_requests_status before update on creator_requests
  for each row execute function enforce_status_transition('creator_request');
create trigger trg_creator_requests_audit after insert or update on creator_requests
  for each row execute function capture_audit('creator_request');

insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('creator_request','diajukan','diproses', null),
  ('creator_request','diajukan','ditolak',  null),
  ('creator_request','diproses','selesai',  null);

-- ---- campaign_requests (routing) --------------------------------------------
create table campaign_requests (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                                  -- CRQ-YYYYMM-NNNN
  deal_id           uuid references brand_deals(id),
  mcn_creator_id    uuid references mcn_creators(id),
  owner_cpm_id      uuid references employees(id),                -- auto-derive dari kreator
  cm_confirm_status text not null default 'menunggu'
                      check (cm_confirm_status in ('menunggu','mau','tidak')),
  needs_brand_acc   boolean not null default false,
  brand_acc_status  text not null default 'n_a'
                      check (brand_acc_status in ('n_a','menunggu','approved','ditolak')),
  final_status      text not null default 'proses'
                      check (final_status in ('proses','fix','batal')),
  handover_done     boolean not null default false,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  -- Guard DB minimal: handover hanya sah bila deal sudah fix.
  constraint chk_campaign_handover check (handover_done = false or final_status = 'fix')
);

create index campaign_requests_deal_idx on campaign_requests (deal_id);
create index campaign_requests_creator_idx on campaign_requests (mcn_creator_id);

create or replace function campaign_requests_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- owner_cpm auto-derive dari mcn_creators saat belum diisi.
  if new.owner_cpm_id is null and new.mcn_creator_id is not null then
    select owner_cpm_id into new.owner_cpm_id from mcn_creators where id = new.mcn_creator_id;
  end if;
  if new.code is null then
    new.code := next_code('CRQ');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger trg_campaign_requests_validate before insert or update on campaign_requests
  for each row execute function campaign_requests_validate();
create trigger trg_campaign_requests_audit after insert or update on campaign_requests
  for each row execute function capture_audit('campaign_request');

-- ---- RLS --------------------------------------------------------------------
-- creator_requests: insert CM (staff scope kreator sendiri, Lead lintas);
-- select/update CM + BizDev + mgmt (approval Director via trigger).
alter table creator_requests enable row level security;
create policy creator_requests_select on creator_requests for select to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev'));
create policy creator_requests_insert on creator_requests for insert to authenticated
  with check (
    is_od() or is_director()
    or (auth_division() = 'CreatorManagement' and (is_lead()
        or exists (select 1 from mcn_creators c
                   where c.id = mcn_creator_id and c.owner_cpm_id = auth_emp_id())))
  );
create policy creator_requests_update on creator_requests for update to authenticated
  using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev'));

-- campaign_requests: BizDev + CM + mgmt.
alter table campaign_requests enable row level security;
create policy campaign_requests_select on campaign_requests for select to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','CreatorManagement'));
create policy campaign_requests_insert on campaign_requests for insert to authenticated
  with check (is_od() or is_director() or auth_division() in ('BizDev','CreatorManagement'));
create policy campaign_requests_update on campaign_requests for update to authenticated
  using (is_od() or is_director() or auth_division() in ('BizDev','CreatorManagement'));

revoke execute on function creator_requests_validate()  from public, anon, authenticated;
revoke execute on function campaign_requests_validate() from public, anon, authenticated;
