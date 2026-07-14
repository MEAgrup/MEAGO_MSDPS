-- =============================================================================
-- MSDPS · Module 12 hotfix — stamping blocked_to saat Brief resume
-- =============================================================================
-- Bug: blk_validate() mereset blocked_to ke nilai lama pada SETIAP update
-- (proteksi kolom derived), sehingga update internal dari briefs_close_block()
-- ikut tertimpa dan rentang blocked tidak pernah tertutup.
-- Fix: briefs_close_block() menyetel flag transaksi-lokal; blk_validate()
-- mengizinkan perubahan blocked_to hanya saat flag itu aktif.
-- =============================================================================

create or replace function blk_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brief briefs%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.reason is null or btrim(new.reason) = '' then
      raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
        using errcode = 'check_violation';
    end if;
    select * into v_brief from briefs where id = new.brief_id;
    if not found then raise exception '[brief tidak ditemukan]'; end if;
    if v_brief.status not in ('[In Progress]','[Overdue]') then
      raise exception '[block hanya dapat diajukan untuk Brief yang sedang berjalan]'
        using errcode = 'check_violation';
    end if;
    if not (is_od() or is_director()
            or auth_division() = v_brief.assigned_division
            or auth_division() = 'Account') then
      raise exception '[anda tidak berwenang mengajukan block untuk Brief ini]'
        using errcode = 'insufficient_privilege';
    end if;
    new.requested_by := coalesce(new.requested_by, auth.uid());
    new.status       := '[Pending]';
    new.approver     := null;
    new.blocked_from := null;
    new.blocked_to   := null;
  end if;

  if tg_op = 'UPDATE' then
    if new.brief_id is distinct from old.brief_id
       or new.requested_by is distinct from old.requested_by then
      raise exception '[referensi block request tidak dapat diubah]'
        using errcode = 'check_violation';
    end if;
    -- Kolom rentang blocked = derived. blocked_to boleh berubah HANYA lewat
    -- jalur internal briefs_close_block() (flag transaksi-lokal).
    new.blocked_from := old.blocked_from;
    if coalesce(current_setting('msdps.blk_internal', true), '') <> '1' then
      new.blocked_to := old.blocked_to;
    end if;

    if new.status is distinct from old.status then
      if new.status = '[Approved]' then
        select * into v_brief from briefs where id = new.brief_id;
        if v_brief.status not in ('[In Progress]','[Overdue]') then
          raise exception '[brief sudah tidak dalam status berjalan — block tidak relevan]'
            using errcode = 'check_violation';
        end if;
        new.approver     := auth.uid();
        new.blocked_from := now();
      elsif new.status = '[Rejected]' then
        new.approver := auth.uid();
      end if;
    end if;
  end if;

  if new.code is null then new.code := next_code('BLK');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function briefs_close_block()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = '[Blocked]' and new.status is distinct from old.status then
    perform set_config('msdps.blk_internal', '1', true);
    update block_requests set blocked_to = now()
    where brief_id = new.id and status = '[Approved]' and blocked_to is null;
    perform set_config('msdps.blk_internal', '', true);
  end if;
  return null;
end $$;

-- Data repair: BLK-202607-0001 sudah resume sebelum fix ini — tutup manual
-- lewat jalur internal yang sama (blocked_to = waktu resume brief tercatat).
do $$
begin
  perform set_config('msdps.blk_internal', '1', true);
  update block_requests bq
  set blocked_to = b.status_changed_at
  from briefs b
  where b.id = bq.brief_id
    and bq.status = '[Approved]' and bq.blocked_to is null
    and b.status not in ('[Blocked]');
  perform set_config('msdps.blk_internal', '', true);
end $$;
