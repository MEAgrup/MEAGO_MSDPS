-- =============================================================================
-- MSDPS · Migration 0351 — buang drift staging-only (item 3 HANDOFF_LANJUTAN)
-- =============================================================================
-- Tiga objek ada di STAGING, tidak ada di production, dan TIDAK PERNAH punya file
-- di repo — dibuat langsung lewat SQL Editor (jebakan #3 di HANDOFF_LANJUTAN §3).
-- Dibuktikan dengan `git log -S`: `binding_end_date`, `kreator_kontrak`, dan
-- `acquisition_followups` tidak pernah muncul di riwayat repo selain di dokumen.
--
-- Keputusan user 2026-09-04: ketiganya DIBUANG, staging dikembalikan setara repo.
--
--   1. acquisitions  : 4 kolom staging-only + policy acquisitions_delete
--   2. acquisition_followups : tabel + 2 policy, 0 baris
--   3. creator_video_gmv     : BUKAN "staging lebih maju" — bentuknya BEDA GRAIN
--
-- Soal (3), ini yang membuatnya penting dan bukan sekadar kerapian:
--   repo 0317 & production : per-VIDEO  (video_id not null, unique creator_id+video_id+period_start)
--   staging                : per-KREATOR-per-MINGGU, TANPA video_id sama sekali
-- Kode wajib bentuk per-video — `lib/actions/video-ingest.ts` menulis
-- video_id/likes/comments/shares/conversion_rate, dan
-- `app/(app)/meago/gmv-video/page.tsx` men-select video_id/views/likes. Jadi
-- aplikasi ERROR bila dijalankan terhadap staging. Yang menyimpang staging,
-- bukan production.
--
-- SIFAT MIGRASI INI: perbaikan environment yang menyimpang, bukan perubahan
-- skema baru. Di production dan pada `db reset` dari nol, seluruh isinya no-op —
-- objeknya memang sudah benar/tidak ada. Semua perintah dijaga `if exists` atau
-- kondisi bentuk, jadi aman dijalankan berulang.
-- =============================================================================

-- ---- 1. acquisitions — buang kolom & policy staging-only --------------------
-- Tidak satu pun disentuh kode: lib/actions/acquisition.ts hanya menulis
-- mcn_creator_id, lead_source, binding_date, commission_share_at_binding,
-- gmv_last_30d, quarter_end, notes.
alter table if exists acquisitions
  drop column if exists binding_end_date,
  drop column if exists phone,
  drop column if exists uid,
  drop column if exists kreator_kontrak;

drop policy if exists acquisitions_delete on acquisitions;

-- ---- 2. acquisition_followups — buang tabel ---------------------------------
-- 0 baris di staging, 0 rujukan di app/ maupun lib/. Policy acq_followups_select
-- & acq_followups_insert ikut terhapus bersama tabelnya.
drop table if exists acquisition_followups;

-- ---- 3. creator_video_gmv — bangun ulang HANYA bila bentuknya salah ---------
-- Fungsi trigger dibuat di luar blok DO supaya penulisan dollar-quote-nya tidak
-- bersarang. `create or replace` = aman di environment yang sudah punya.
create or replace function creator_video_gmv_update_ts()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end $fn$;

do $fix$
begin
  -- Penanda bentuk staging: tabelnya ada tapi tidak punya kolom video_id.
  if to_regclass('public.creator_video_gmv') is not null
     and not exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'creator_video_gmv'
         and column_name = 'video_id'
     )
  then
    -- Jaga-jaga: bentuk staging kosong saat migrasi ini ditulis (0 baris). Kalau
    -- suatu saat sudah terisi, JANGAN diam-diam dibuang — hentikan dan tinjau.
    if exists (select 1 from creator_video_gmv) then
      raise exception
        'creator_video_gmv bentuk staging (tanpa video_id) berisi data. Migrasi 0351 dirancang untuk tabel kosong — tinjau manual dulu.';
    end if;

    drop table creator_video_gmv cascade;

    -- Salinan verbatim dari 0317_gmv_video_weekly_tracking.sql. Kalau 0317
    -- berubah, blok ini WAJIB ikut diubah.
    create table creator_video_gmv (
      id                    bigserial primary key,
      creator_id            uuid not null references mcn_creators (id) on delete cascade,
      batch_id              text not null references upload_batches (batch_id) on delete cascade,
      video_id              text not null,
      video_title           text,
      period_start          date not null,
      period_end            date not null,
      views                 bigint default 0,
      likes                 bigint default 0,
      comments              bigint default 0,
      shares                bigint default 0,
      sales_value           decimal(15, 2) default 0,
      orders                integer default 0,
      conversion_rate       decimal(5, 2) default 0,
      created_at            timestamptz default now(),
      updated_at            timestamptz default now(),
      unique (creator_id, video_id, period_start)
    );

    comment on table creator_video_gmv is
      'Agregat mingguan metrik video per kreator dari export TikTok Creator Analytics.';
    comment on column creator_video_gmv.video_id is
      'ID video TikTok unik dari export.';
    comment on column creator_video_gmv.period_start is
      'Awal minggu W1-W5 (Senin). Validation lewat validateW1W5Period.';
    comment on column creator_video_gmv.sales_value is
      'Gross Merchandise Value total minggu, dalam IDR.';
    comment on column creator_video_gmv.conversion_rate is
      'Persentase konversi view → order (0-100).';

    create index creator_video_gmv_creator_id_period_idx
      on creator_video_gmv (creator_id, period_start desc);
    create index creator_video_gmv_batch_id_idx
      on creator_video_gmv (batch_id);
    create index creator_video_gmv_video_id_period_idx
      on creator_video_gmv (video_id, period_start desc);

    alter table creator_video_gmv enable row level security;

    create policy cvg_select on creator_video_gmv for select to authenticated
      using (is_od() or is_director() or auth_division() in ('CreatorManagement','BizDev','Acquisition'));
    create policy cvg_insert on creator_video_gmv for insert to authenticated
      with check (is_od() or is_director() or auth_division() = 'CreatorManagement');
    create policy cvg_delete on creator_video_gmv for delete to authenticated
      using (is_od() or is_director() or auth_division() = 'CreatorManagement');
    -- Sengaja TIDAK ada policy UPDATE — sama seperti 0317.

    create trigger creator_video_gmv_update_ts_trigger
      before update on creator_video_gmv
      for each row
      execute function creator_video_gmv_update_ts();
  end if;
end $fix$;
