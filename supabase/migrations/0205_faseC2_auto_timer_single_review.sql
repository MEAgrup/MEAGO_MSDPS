-- =============================================================================
-- MSDPS · Fase C.2 — Auto time tracking per Brief + single-layer review (AM)
-- =============================================================================
-- Keputusan Yohan (2026-07-02):
-- 1. Timer manual dihapus. Waktu kerja di-track OTOMATIS per Brief untuk SEMUA
--    divisi: timer mulai saat Brief diterima (masuk [In Progress]) dan berhenti
--    saat keluar dari status kerja (submit/complete/blocked). Revisi -> timer
--    lanjut akumulasi. [In Progress]<->[Overdue] dianggap sama-sama "berjalan".
-- 2. Setelah submit, yang bisa approve adalah TEAM ACCOUNT (AM) — layer review
--    E-com Lead pada SKU Work Unit DIHAPUS. Review Brief ([In Review]/[Approved]/
--    [Revision Requested]) juga hanya Account/OD/Director.
-- ecom_time_logs & time_logged_seconds dibiarkan (arsip historis), UI-nya dicabut.
-- =============================================================================

alter table briefs add column work_time_seconds bigint not null default 0;
alter table briefs add column timer_started_at  timestamptz;

comment on column briefs.work_time_seconds is 'Akumulasi detik kerja otomatis: berjalan selama status [In Progress]/[Overdue] (derived — jangan edit manual)';
comment on column briefs.timer_started_at  is 'Timestamp mulai segmen timer berjalan; null = timer tidak aktif';

create or replace function briefs_track_time()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_running constant text[] := array['[In Progress]','[Overdue]'];
begin
  -- Kolom waktu derived: selalu reset ke nilai lama, hanya trigger ini yang mengubah.
  new.work_time_seconds := old.work_time_seconds;
  new.timer_started_at  := old.timer_started_at;

  if new.status is distinct from old.status then
    -- Review Brief hanya oleh Account (keputusan single-layer, 2026-07-02).
    if new.status in ('[In Review]','[Approved]','[Revision Requested]') then
      if not (auth_division() = 'Account' or is_od() or is_director()) then
        raise exception '[review Brief hanya dapat dilakukan oleh team Account]'
          using errcode = 'insufficient_privilege';
      end if;
    end if;

    if not (old.status::text = any(v_running)) and new.status::text = any(v_running) then
      new.timer_started_at := now();
    elsif old.status::text = any(v_running) and not (new.status::text = any(v_running)) then
      new.work_time_seconds := old.work_time_seconds
        + coalesce(greatest(0, extract(epoch from now() - old.timer_started_at))::bigint, 0);
      new.timer_started_at := null;
    end if;
  end if;
  return new;
end $$;

-- BEFORE UPDATE, setelah enforce_status_transition (alfabetis: trg_briefs_... urutan
-- eksekusi PG per nama trigger; validasi transisi tetap jalan di trigger existing).
create trigger trg_briefs_track_time before update on briefs
  for each row execute function briefs_track_time();

-- =============================================================================
-- SKU Work Unit: hapus layer E-com Lead — submit langsung ke review AM
-- =============================================================================
delete from status_transitions
where entity = 'sku_unit'
  and ('[In Review - E-com Lead]' in (from_status, to_status)
    or '[Approved by Lead]'       in (from_status, to_status));

-- sku_units_validate versi single-layer: check "harus melalui E-com Lead" dihapus;
-- ambil review ([Submitted for Review]->[In Review - AM]) hanya Account/OD/Director.
create or replace function sku_units_validate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_brief briefs%rowtype;
  v_count int;
begin
  if new.product_ref is null or btrim(new.product_ref) = '' then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode = 'check_violation';
  end if;

  select * into v_brief from briefs where id = new.brief_id;
  if not found then raise exception '[brief tidak ditemukan]'; end if;

  if tg_op = 'INSERT' then
    if v_brief.assigned_division <> 'Ecommerce' then
      raise exception '[brief tidak sesuai dengan tipe service yang dipilih]'
        using errcode = 'check_violation';
    end if;
    if v_brief.status not in ('[In Progress]','[Overdue]') or v_brief.assigned_pic is null then
      raise exception '[brief belum di-pick up dari queue E-commerce]'
        using errcode = 'check_violation';
    end if;
    if not (is_od() or is_director() or auth_division() = 'Ecommerce') then
      raise exception '[hanya staff E-commerce yang dapat membuat SKU Work Unit]'
        using errcode = 'insufficient_privilege';
    end if;
    select count(*) into v_count from sku_work_units
    where brief_id = new.brief_id and status <> '[Cancelled]';
    if v_count >= coalesce(v_brief.quantity_target, 0) then
      raise exception '[jumlah SKU Work Unit melebihi Target SKU Count, butuh approval SPV untuk menaikkan target]'
        using errcode = 'check_violation';
    end if;
    new.scope_checklist := v_brief.optimization_scope
      || case when v_brief.custom_scope_item is not null and btrim(v_brief.custom_scope_item) <> ''
              then array[v_brief.custom_scope_item] else '{}'::text[] end;
    new.assigned_staff := coalesce(new.assigned_staff, auth.uid());
  end if;

  if tg_op = 'UPDATE' then
    if new.scope_checklist is distinct from old.scope_checklist then
      raise exception '[Optimization Scope Checklist diwarisi dari Brief dan tidak dapat diubah]'
        using errcode = 'check_violation';
    end if;
    if new.status = '[Submitted for Review]' and old.status is distinct from new.status then
      if not (new.checklist_done @> new.scope_checklist) then
        raise exception '[semua item checklist wajib diselesaikan sebelum submit untuk review]'
          using errcode = 'check_violation';
      end if;
      new.submitted_at := now();
    end if;
    -- Setelah submit, review hanya team Account (single-layer, 2026-07-02).
    if new.status = '[In Review - AM]' and old.status is distinct from new.status
       and not (auth_division() = 'Account' or is_od() or is_director()) then
      raise exception '[review setelah submit hanya dapat dilakukan oleh team Account]'
        using errcode = 'insufficient_privilege';
    end if;
    if old.status = '[In Review - AM]' and new.status in ('[Approved]','[Revision Requested]')
       and not (auth_division() = 'Account' or is_od() or is_director()) then
      raise exception '[review setelah submit hanya dapat dilakukan oleh team Account]'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status = '[Revision Requested]' and old.status is distinct from new.status then
      if new.revision_notes is null or btrim(new.revision_notes) = '' then
        raise exception '[Revision Notes wajib diisi]' using errcode = 'check_violation';
      end if;
      new.revision_count := old.revision_count + 1;
      new.last_revision_layer := 'am';
    end if;
    if new.status = '[Approved]' and old.status is distinct from new.status then
      new.approved_at := now();
    end if;
    if new.status = '[Cancelled]' and old.status is distinct from new.status then
      if not (auth_division() = 'Account' or is_od() or is_director()) then
        raise exception '[hanya AM yang dapat membatalkan SKU Work Unit]'
          using errcode = 'insufficient_privilege';
      end if;
      if new.cancellation_reason is null or btrim(new.cancellation_reason) = '' then
        raise exception '[alasan pembatalan wajib diisi]' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if new.code is null then new.code := next_code('SKU');
  elsif tg_op = 'UPDATE' and new.code is distinct from old.code then
    raise exception '[ID tidak dapat diubah]' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ---- Function grants -----------------------------------------------------------
revoke execute on function briefs_track_time() from public, anon, authenticated;
