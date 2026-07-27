-- =============================================================================
-- MSDPS · MCN · Migration 0319 — Riwayat Follow Up Perpanjangan Kreator
-- =============================================================================
-- Tabel riwayat follow up untuk dashboard "Follow Up Perpanjangan Kreator".
-- Setiap baris = satu catatan follow up terhadap sebuah akuisisi (binding) yang
-- tanggal berakhirnya mendekati/lewat. Sumber data kreator + tanggal berakhir
-- tetap dari tabel `acquisitions` (migration 0307/0317) — tabel ini HANYA
-- menyimpan histori follow up, tidak menduplikasi data akuisisi.
--
--   acquisition_id : FK ke acquisitions. ON DELETE CASCADE — bila baris akuisisi
--                    dihapus (hard-delete, policy 0318), riwayat follow up ikut
--                    terhapus sehingga tak ada baris yatim.
--   note           : catatan follow up (wajib).
--   followup_date  : tanggal follow up (default hari ini bila tak dikirim).
--   status         : hasil/tahap follow up perpanjangan. 4 status:
--                    menunggu / dihubungi / akan_perpanjang / tidak_perpanjang.
--   created_by     : actor (auth.uid()) — log siapa mencatat.
--
-- RLS disamakan dengan `acquisitions`: baca = Acquisition/CM/mgmt; tulis (insert)
-- = Acquisition/mgmt. Tidak ada UPDATE/DELETE policy — riwayat bersifat append-only
-- (koreksi dilakukan dengan menambah catatan baru), konsisten dengan sifat log.
-- =============================================================================

create table acquisition_followups (
  id             uuid primary key default gen_random_uuid(),
  acquisition_id uuid not null references acquisitions(id) on delete cascade,
  note           text not null,
  followup_date  date not null default current_date,
  status         text not null default 'menunggu'
                   check (status in ('menunggu','dihubungi','akan_perpanjang','tidak_perpanjang')),
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now()
);

create index acquisition_followups_acq_idx on acquisition_followups (acquisition_id);

alter table acquisition_followups enable row level security;
create policy acq_followups_select on acquisition_followups for select to authenticated
  using (is_od() or is_director() or auth_division() in ('Acquisition','CreatorManagement'));
create policy acq_followups_insert on acquisition_followups for insert to authenticated
  with check (is_od() or is_director() or auth_division() = 'Acquisition');
