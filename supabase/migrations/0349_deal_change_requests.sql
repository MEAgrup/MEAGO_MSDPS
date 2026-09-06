-- =============================================================================
-- MSDPS · Merchant Deals · Migration 0349 — antrian approval edit/hapus deal
-- =============================================================================
-- Migrasi 0341 menutup total Edit & Hapus transaksi deal untuk selain Director
-- (RLS brand_deals_update/brand_deals_delete = is_director()), sehingga tombol
-- "Edit"/"Lengkapi Data"/"Hapus" ikut disembunyikan dari BD & CM. Efek
-- sampingnya: baris hasil Import Master Deal yang belum lengkap tidak bisa lagi
-- dilengkapi oleh orang yang benar-benar tahu datanya (BD pemiliknya) — semua
-- harus lewat Director.
--
-- Keputusan (instruksi user 2026-09-04): tombolnya dimunculkan lagi untuk BD &
-- CM, TAPI hasil editan/penghapusannya TIDAK langsung berlaku — masuk antrian
-- di tabel ini dan baru diterapkan setelah di-ACCEPT role Director. RLS
-- brand_deals SENGAJA TIDAK dilonggarkan: penerapannya dijalankan oleh sesi
-- Director yang menekan "Setujui", jadi penjagaan level DB tetap utuh (tidak
-- ada SECURITY DEFINER / service-role yang bisa dipakai memutar approval).
--
-- Catatan role: "approval ke role director" mengikuti 0341/0343 — konsep
-- "leader dan atasnya" belum ada di skema, jadi approver = is_director().
-- =============================================================================

create table if not exists deal_change_requests (
  id              uuid primary key default gen_random_uuid(),
  -- on delete set null (bukan cascade) supaya jejak permintaan "Hapus" yang
  -- SUDAH disetujui tidak ikut lenyap bersama deal-nya; kolom snapshot di
  -- bawah yang menjaga barisnya tetap terbaca setelah deal hilang.
  deal_id         uuid references brand_deals(id) on delete set null,
  deal_code       text,
  deal_brand_name text not null,
  action          text not null check (action in ('update', 'delete')),
  -- payload: hasil readDealFields (lib/actions/deals.ts) untuk action='update';
  -- selalu null untuk action='delete'. Divalidasi ulang saat approve, jadi
  -- isinya tidak pernah dipercaya apa adanya.
  payload         jsonb,
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by    uuid not null references employees(id),
  requested_at    timestamptz not null default now(),
  reviewed_by     uuid references employees(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  constraint deal_change_requests_payload_shape check (
    (action = 'update' and payload is not null) or (action = 'delete' and payload is null)
  ),
  constraint deal_change_requests_review_shape check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null and deal_id is not null)
    or (status <> 'pending' and reviewed_at is not null)
  )
);

-- Satu deal hanya boleh punya satu permintaan menggantung — mencegah dua BD
-- (atau satu BD dua kali) mengantre editan yang saling menimpa diam-diam.
create unique index if not exists deal_change_requests_one_pending
  on deal_change_requests (deal_id)
  where status = 'pending';

create index if not exists deal_change_requests_status_idx
  on deal_change_requests (status, requested_at desc);

alter table deal_change_requests enable row level security;

-- Pemohon melihat permintaannya sendiri; OD/Director melihat semuanya.
drop policy if exists deal_change_requests_select on deal_change_requests;
create policy deal_change_requests_select on deal_change_requests for select to authenticated
  using (is_od() or is_director() or requested_by = auth_emp_id());

-- Yang boleh mengajukan = yang boleh "Daftarkan Transaksi" (BizDev/CM/mgmt),
-- cermin canManageDeals() di lib/actions/deals.ts. requested_by dikunci ke
-- diri sendiri & status wajib mulai dari 'pending'.
drop policy if exists deal_change_requests_insert on deal_change_requests;
create policy deal_change_requests_insert on deal_change_requests for insert to authenticated
  with check (
    requested_by = auth_emp_id()
    and status = 'pending'
    and (is_od() or is_director() or auth_division() in ('BizDev', 'CreatorManagement'))
  );

-- Hanya Director yang meng-accept/menolak.
drop policy if exists deal_change_requests_review on deal_change_requests;
create policy deal_change_requests_review on deal_change_requests for update to authenticated
  using (is_director())
  with check (is_director());

-- Pemohon boleh membatalkan permintaannya sendiri selama belum ditinjau.
drop policy if exists deal_change_requests_delete on deal_change_requests;
create policy deal_change_requests_delete on deal_change_requests for delete to authenticated
  using (is_director() or (requested_by = auth_emp_id() and status = 'pending'));

comment on table deal_change_requests is
  'Antrian approval Director untuk Edit/Lengkapi Data & Hapus transaksi brand_deals (tab Merchant Deals). BD/CM mengajukan, Director menerapkan lewat sesinya sendiri — RLS brand_deals tetap director-only (0341/0348).';
