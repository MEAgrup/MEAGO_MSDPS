-- =============================================================================
-- MSDPS · MCN · Migration 0382 — Field binding akuisisi (laporan Siti, ACC Yohan 2026-11-06)
-- =============================================================================
-- Form "Catat Akuisisi (Binding)" kurang data. Dari 6 field yang diminta, 2 SUDAH
-- ADA di master kreator dan TIDAK dibuat ulang (lihat docs/DECISIONS.md):
--   · Jenis Kontrak → mcn_creators.status_kontrak ('kontrak' / 'non kontrak', 0316)
--   · PIC CM        → mcn_creators.owner_cpm_id   (0302; dipakai handoff & scope CM)
-- Sisanya fakta binding, ditambahkan di acquisitions (semua nullable: baris lama
-- tetap valid; wajib untuk binding BARU ditegakkan di recordAcquisition):
--   · creator_uid       TikTok UID kreator (angka)
--   · whatsapp          nomor WA, dinormalisasi 62xxxx (normalize_phone_62, 0330)
--   · gmv_potential     estimasi GMV/bulan versi Akuisisi saat binding (≥ 0)
--   · binding_end_date  tanggal binding berakhir (≥ binding_date)
--
-- Catatan: 0351 pernah membuang kolom mirip (uid/phone/binding_end_date) yang
-- hanya ada di staging tanpa file migrasi. Ini versi resminya, nama kolom baru.
-- Tidak ada perubahan RLS: insert/update acquisitions tetap Acquisition + mgmt;
-- update mcn_creators oleh Acquisition sudah diizinkan sejak 0302.
-- =============================================================================

alter table acquisitions
  add column if not exists creator_uid      text,
  add column if not exists whatsapp         text,
  add column if not exists gmv_potential    numeric,
  add column if not exists binding_end_date date;

alter table acquisitions
  add constraint acquisitions_creator_uid_chk
    check (creator_uid is null or creator_uid ~ '^[0-9]{5,25}$'),
  add constraint acquisitions_whatsapp_chk
    check (whatsapp is null or whatsapp ~ '^62[0-9]{7,13}$'),
  add constraint acquisitions_gmv_potential_chk
    check (gmv_potential is null or gmv_potential >= 0),
  add constraint acquisitions_binding_end_chk
    check (binding_end_date is null or binding_end_date >= binding_date);

comment on column acquisitions.creator_uid is 'TikTok UID kreator saat binding (0382).';
comment on column acquisitions.whatsapp is 'Nomor WhatsApp kreator, format 62xxxx (0382).';
comment on column acquisitions.gmv_potential is 'Estimasi GMV/bulan versi Akuisisi saat binding (0382).';
comment on column acquisitions.binding_end_date is 'Tanggal binding berakhir (0382).';

-- Normalisasi WA di DB juga (bukan hanya di aplikasi): trigger terpisah supaya
-- acquisitions_validate() (0307) tidak perlu disalin ulang.
create or replace function acquisitions_normalize_wa()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.whatsapp is not null then
    new.whatsapp := normalize_phone_62(new.whatsapp);
  end if;
  return new;
end $$;

drop trigger if exists trg_acquisitions_normalize_wa on acquisitions;
create trigger trg_acquisitions_normalize_wa before insert or update of whatsapp on acquisitions
  for each row execute function acquisitions_normalize_wa();

revoke execute on function acquisitions_normalize_wa() from public, anon, authenticated;
