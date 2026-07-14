-- =============================================================================
-- MSDPS · Fase B · Module 5 — Finance (`TRX-…`, `INST-…`, `PYO-…`)
-- =============================================================================
-- In-leg: Transaction verification + routing gate (first confirmed money ->
-- release to Account). Out-leg: Creator Payout table (dual milestone) — its
-- trigger-gating is exercised in Fase C (needs creator_bookings, M9).
-- Also defines close_deal() (the closing operation) and verify_payment().
-- =============================================================================

create type transaction_status as enum
  ('[Menunggu Verifikasi]','[Terverifikasi - Sebagian]','[Lunas]');
create type installment_status as enum ('[Menunggu Verifikasi]','[Terverifikasi]');
create type payout_type as enum ('PYO-Video','PYO-Live');
create type payout_status as enum ('[Menunggu Disbursement]','[Ditransfer]','[Dibatalkan]');

create table transactions (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique,                 -- TRX-YYYYMM-NNNN
  merchant_id            uuid not null references merchants(id),
  payment_intent         payment_intent not null,
  total_agreed_value     numeric not null,
  amount_verified        numeric not null default 0,  -- only Finance writes
  amount_outstanding     numeric generated always as (total_agreed_value - amount_verified) stored,
  status                 transaction_status not null default '[Menunggu Verifikasi]',
  flag_jatuh_tempo       boolean not null default false,   -- parallel flag
  flag_bermasalah        boolean not null default false,   -- parallel flag
  contract_attachment    text,
  released_to_account_at timestamptz,                  -- DERIVED at first confirmed money
  created_by             uuid default auth.uid(),
  created_at             timestamptz not null default now(),
  status_changed_by      uuid,
  status_changed_at      timestamptz
);

create table installments (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,                       -- INST-YYYYMM-NNNN
  transaction_id    uuid not null references transactions(id),
  seq_no            int not null,
  amount            numeric not null,
  due_date          date not null,
  status            installment_status not null default '[Menunggu Verifikasi]',
  created_at        timestamptz not null default now(),
  status_changed_by uuid,
  status_changed_at timestamptz
);

create table creator_payouts (
  id                   uuid primary key default gen_random_uuid(),
  code                 text unique,                    -- PYO-YYYYMM-NNNN
  payout_type          payout_type not null,
  referenced_bookings  uuid[] not null,                -- FK-less (creator_bookings in M9)
  milestone_unit_value int generated always as
                         (case payout_type when 'PYO-Video' then 10 else 5 end) stored,
  merchant_id          uuid references merchants(id),
  creator_id           uuid,                           -- FK added in M9
  amount               numeric not null,               -- set by KOL, read-only to Finance
  status               payout_status not null default '[Menunggu Disbursement]',
  requested_by         uuid,
  requested_at         timestamptz not null default now(),
  transferred_at       timestamptz,
  transfer_proof       text,
  cancelled_by         uuid,
  cancellation_reason  text,
  status_changed_by    uuid,
  status_changed_at    timestamptz
);

-- ---- Validation + ID triggers ----
create or replace function transactions_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.merchant_id is null or new.payment_intent is null or new.total_agreed_value is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode='check_violation';
  end if;
  if new.amount_verified > new.total_agreed_value then
    raise exception '[jumlah melebihi total transaksi, periksa kembali]' using errcode='check_violation';
  end if;
  if new.code is null then new.code := next_code('TRX');
  elsif tg_op='UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode='check_violation';
  end if;
  return new;
end $$;

create trigger trg_transactions_validate before insert or update on transactions
  for each row execute function transactions_validate();
create trigger trg_transactions_status before update on transactions
  for each row execute function enforce_status_transition('transaction');
create trigger trg_transactions_audit after insert or update on transactions
  for each row execute function capture_audit('transaction');

create or replace function installments_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null then new.code := next_code('INST');
  elsif tg_op='UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode='check_violation';
  end if;
  return new;
end $$;
create trigger trg_installments_validate before insert or update on installments
  for each row execute function installments_validate();
create trigger trg_installments_status before update on installments
  for each row execute function enforce_status_transition('installment');
create trigger trg_installments_audit after insert or update on installments
  for each row execute function capture_audit('installment');

create or replace function payouts_validate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payout_type is null or new.amount is null or new.referenced_bookings is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode='check_violation';
  end if;
  if new.status = '[Dibatalkan]' and (new.cancellation_reason is null or btrim(new.cancellation_reason)='') then
    raise exception '[alasan pembatalan wajib diisi]' using errcode='check_violation';
  end if;
  if new.code is null then new.code := next_code('PYO');
  elsif tg_op='UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode='check_violation';
  end if;
  if tg_op='UPDATE' and new.status='[Ditransfer]' and old.status<>'[Ditransfer]' and new.transferred_at is null then
    new.transferred_at := now();
  end if;
  return new;
end $$;
create trigger trg_payouts_validate before insert or update on creator_payouts
  for each row execute function payouts_validate();
create trigger trg_payouts_status before update on creator_payouts
  for each row execute function enforce_status_transition('creator_payout');
create trigger trg_payouts_audit after insert or update on creator_payouts
  for each row execute function capture_audit('creator_payout');

-- ---- Transitions ----
insert into status_transitions (entity, from_status, to_status, allowed_tokens) values
  ('transaction','[Menunggu Verifikasi]','[Terverifikasi - Sebagian]', null),
  ('transaction','[Menunggu Verifikasi]','[Lunas]',                    null),
  ('transaction','[Terverifikasi - Sebagian]','[Lunas]',              null),
  ('installment','[Menunggu Verifikasi]','[Terverifikasi]',            null),
  ('creator_payout','[Menunggu Disbursement]','[Ditransfer]',          null),
  ('creator_payout','[Menunggu Disbursement]','[Dibatalkan]',          '{lead,director}');

-- =============================================================================
-- close_deal(): the closing operation. Atomically creates Merchant + Service(s)
-- + Transaction from a winning attempt, then flips the attempt to Closed-Success
-- (which cascades competitor-close + lead conversion via M1 trigger).
-- =============================================================================
create or replace function close_deal(
  p_attempt_id     uuid,
  p_nama_toko      text,
  p_kota           text,
  p_link_toko      text,
  p_kategori       text,
  p_gmv_baseline   numeric,
  p_target_gmv     numeric,
  p_service_types  service_type[],
  p_total_fee      numeric,
  p_payment_intent payment_intent
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_attempt   prospect_attempts%rowtype;
  v_campaign  uuid;
  v_merchant  uuid;
  st          service_type;
begin
  select * into v_attempt from prospect_attempts where id = p_attempt_id;
  if not found then raise exception '[prospect tidak ditemukan]'; end if;
  if not (v_attempt.owner_id = auth.uid() or is_director()) then
    raise exception '[hanya pemilik prospect atau Director yang dapat closing]' using errcode='insufficient_privilege';
  end if;
  if v_attempt.status <> '[Negotiation]' then
    raise exception '[closing hanya dari tahap Negotiation]' using errcode='check_violation';
  end if;
  if p_service_types is null or array_length(p_service_types,1) is null then
    raise exception '[minimal satu service harus dipilih]' using errcode='check_violation';
  end if;

  select origin_campaign_id into v_campaign from leads where id = v_attempt.parent_lead_id;

  insert into merchants (nama_toko, kota, link_toko, kategori, origin_campaign_id,
                         source_attempt_id, gmv_baseline, target_gmv, payment_intent)
  values (p_nama_toko, p_kota, p_link_toko, p_kategori, v_campaign,
          p_attempt_id, p_gmv_baseline, p_target_gmv, p_payment_intent)
  returning id into v_merchant;

  foreach st in array p_service_types loop
    insert into services (merchant_id, service_type) values (v_merchant, st);
  end loop;

  insert into transactions (merchant_id, payment_intent, total_agreed_value)
  values (v_merchant, p_payment_intent, p_total_fee);

  update prospect_attempts set status = '[Closed - Success]' where id = p_attempt_id;

  return v_merchant;
end $$;

-- =============================================================================
-- verify_payment(): Finance confirms received money; drives status + routing gate.
-- =============================================================================
create or replace function verify_payment(
  p_transaction_id uuid,
  p_amount         numeric,
  p_proof          text default null
) returns transaction_status
language plpgsql security definer set search_path = public as $$
declare
  v_trx transactions%rowtype;
  v_new_verified numeric;
  v_new_status transaction_status;
begin
  if not (auth_division() = 'Finance' or is_director()) then
    raise exception '[hanya Finance yang dapat memverifikasi pembayaran]' using errcode='insufficient_privilege';
  end if;
  select * into v_trx from transactions where id = p_transaction_id;
  if not found then raise exception '[transaksi tidak ditemukan]'; end if;

  v_new_verified := v_trx.amount_verified + p_amount;
  if v_new_verified > v_trx.total_agreed_value then
    raise exception '[jumlah melebihi total transaksi, periksa kembali]' using errcode='check_violation';
  end if;

  if v_new_verified >= v_trx.total_agreed_value then
    v_new_status := '[Lunas]';
  elsif v_new_verified > 0 then
    v_new_status := '[Terverifikasi - Sebagian]';
  else
    v_new_status := v_trx.status;
  end if;

  update transactions
     set amount_verified = v_new_verified,
         status = v_new_status,
         contract_attachment = coalesce(p_proof, contract_attachment),
         released_to_account_at = coalesce(released_to_account_at,
           case when v_new_status in ('[Terverifikasi - Sebagian]','[Lunas]') then now() end)
   where id = p_transaction_id;

  return v_new_status;
end $$;

-- ---- RLS ----
alter table transactions enable row level security;
create policy trx_select on transactions for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Finance','Account','BizDev'));
create policy trx_update on transactions for update to authenticated
  using (auth_division()='Finance' or is_director());

alter table installments enable row level security;
create policy inst_select on installments for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Finance','Account','BizDev'));
create policy inst_manage on installments for all to authenticated
  using (auth_division()='Finance' or is_director())
  with check (auth_division()='Finance' or is_director());

alter table creator_payouts enable row level security;
create policy pyo_select on creator_payouts for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Finance','KOL'));
create policy pyo_update on creator_payouts for update to authenticated
  using (auth_division() in ('Finance','KOL') or is_director());
