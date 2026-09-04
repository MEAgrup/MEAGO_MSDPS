-- =============================================================================
-- MSDPS · Setting Bizdev & Admin Ops · Migration 0343 — poi_sla_settings
-- =============================================================================
-- Tab baru "Setting Bizdev & Admin Ops": role leader/atasnya (untuk saat ini
-- is_director() saja — lihat catatan migrasi 0341) dapat menentukan/mengatur
-- SLA per step SOP untuk tab POI Accommodation & TTD dan POI Dining. Step/task
-- sendiri TETAP tidak berubah (terikat check constraint poi_sop_steps/
-- poi_dining_steps di 0336/0337) — yang bisa diatur di sini hanya nilai SLA
-- (sla_days / sla_label) per step, menimpa default hardcoded di
-- lib/mcn/poi-sop.ts (POI_SOP_STEPS / POI_DINING_FREEBARTER_STEPS /
-- POI_DINING_BERBAYAR_STEPS).
-- =============================================================================

create table if not exists poi_sla_settings (
  id          uuid primary key default gen_random_uuid(),
  flow        text not null check (flow in ('poi_accommodation_ttd','poi_dining_freebarter','poi_dining_berbayar')),
  step_no     int not null check (step_no >= 1),
  task        text not null,
  sla_days    int check (sla_days is null or sla_days >= 0),
  sla_label   text,
  updated_by  uuid references employees(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (flow, step_no)
);

alter table poi_sla_settings enable row level security;

create policy poi_sla_settings_select on poi_sla_settings for select to authenticated
  using (is_od() or is_director() or auth_division() = 'BizDev');

create policy poi_sla_settings_manage on poi_sla_settings for all to authenticated
  using (is_director())
  with check (is_director());

-- ---- Seed dari default hardcoded lib/mcn/poi-sop.ts --------------------------
insert into poi_sla_settings (flow, step_no, task, sla_days, sla_label) values
  -- poi_accommodation_ttd (POI_SOP_STEPS, 15 step)
  ('poi_accommodation_ttd', 1, 'Membuat form listing kreator', 1, null),
  ('poi_accommodation_ttd', 2, 'Membuat info visit hotel sesuai standar', 1, null),
  ('poi_accommodation_ttd', 3, 'Infokan ke grup kreator', 1, null),
  ('poi_accommodation_ttd', 4, 'Cek & kurasi kreator koordinasi dengan BD', 1, null),
  ('poi_accommodation_ttd', 5, 'Jika masih kurang jumlah kreator akan di lempar ke grup batch & koordinasi dengan tim CM untuk kreator-kreator baru yang belum join grup kota', 1, null),
  ('poi_accommodation_ttd', 6, 'Mengumumkan ke grup kreator terpilih', 1, null),
  ('poi_accommodation_ttd', 7, 'Membuat grup khusus sementara untuk koordinasi', 1, null),
  ('poi_accommodation_ttd', 8, 'Memasukan kreator ke dalam grup & cek sudah masuk semua atau belum (maks H-2 sebelum visit)', 1, null),
  ('poi_accommodation_ttd', 9, 'Infokan perihal brief, SOW, & link pengumpulan VT di grup sementara', 1, null),
  ('poi_accommodation_ttd', 10, 'Reminder ke grup kreator untuk visit D day', 1, null),
  ('poi_accommodation_ttd', 11, 'Reminder pengumpulan VT H+1, H+3, H+5 (durasi pengumpulan VT maksimal H+7 dari visit)', 7, null),
  ('poi_accommodation_ttd', 12, 'Membuat & mengirimkan report pengumpulan VT ke BD', 1, null),
  ('poi_accommodation_ttd', 13, 'Membuat Monthly Report untuk hotel & performa, koordinasi dengan data analis atau by AI ke depannya', 2, null),
  ('poi_accommodation_ttd', 14, 'Menarik data dari Lark request ke tim Data Tiktok setiap tanggal 3/4 awal bulan & update data laporan semua POI tiap bulan', 5, null),
  ('poi_accommodation_ttd', 15, 'Membuat report data terupdate poin 13 sesuai req BD', 2, null),

  -- poi_dining_freebarter (POI_DINING_FREEBARTER_STEPS, 17 step — DINING_CORE_STEP_DEFS langsung)
  ('poi_dining_freebarter', 1, 'Membuat form listing kreator', 1, null),
  ('poi_dining_freebarter', 2, 'Membuat info dining sesuai standar', 1, null),
  ('poi_dining_freebarter', 3, 'Infokan ke grup kreator', 1, null),
  ('poi_dining_freebarter', 4, 'Membuat Creator Package sesuai dealing BD', 2, null),
  ('poi_dining_freebarter', 5, 'Cek & kurasi kreator koordinasi dengan BD', 1, null),
  ('poi_dining_freebarter', 6, 'Jika masih kurang jumlah kreator akan di lempar ke grup batch & koordinasi dengan tim CM untuk kreator-kreator baru yang belum join grup kota', 1, null),
  ('poi_dining_freebarter', 7, 'Mengumumkan ke grup kreator terpilih', 1, null),
  ('poi_dining_freebarter', 8, 'Membuat grup khusus sementara untuk koordinasi', 1, null),
  ('poi_dining_freebarter', 9, 'Memasukan kreator ke dalam grup & cek sudah masuk semua atau belum', 1, null),
  ('poi_dining_freebarter', 10, 'Infokan perihal brief, SOW, & link pengumpulan VT di grup sementara', 1, null),
  ('poi_dining_freebarter', 11, 'Memastikan VT sesuai brief merchant & koordinasi dengan BD & pihak brand terkait redeem produk & jika ada kendala di lapangan', 1, null),
  ('poi_dining_freebarter', 12, 'Reminder pengumpulan VT H+1, H+3, H+5 dst (sesuai timeline dealing dengan Brand) & check Creator Package', null, '7–30 hari (sesuai dealing)'),
  ('poi_dining_freebarter', 13, 'Koordinasi secara berkala dengan PIC Merchant terkait project berjalan', 1, null),
  ('poi_dining_freebarter', 14, 'Membuat & mengirimkan report pengumpulan VT ke BD', 1, null),
  ('poi_dining_freebarter', 15, 'Membuat Monthly Report untuk hotel & performa, koordinasi dengan data analis atau by AI ke depannya', 2, null),
  ('poi_dining_freebarter', 16, 'Menarik data dari Lark request ke tim Data Tiktok setiap tanggal 3/4 awal bulan & update data laporan semua POI tiap bulan', 5, null),
  ('poi_dining_freebarter', 17, 'Membuat report data terupdate poin 13 sesuai req BD', 2, null),

  -- poi_dining_berbayar (POI_DINING_BERBAYAR_STEPS, 22 step: 1-5 MOU/Invoice + 6-22 = DINING_CORE_STEP_DEFS)
  ('poi_dining_berbayar', 1, 'Membuat MOU', null, null),
  ('poi_dining_berbayar', 2, 'Request Invoice ke Finance', null, null),
  ('poi_dining_berbayar', 3, 'Kirim MOU ke klien', null, null),
  ('poi_dining_berbayar', 4, 'Kirim Invoice ke klien', null, null),
  ('poi_dining_berbayar', 5, 'Kirim bukti payment ke grup', null, null),
  ('poi_dining_berbayar', 6, 'Membuat form listing kreator', 1, null),
  ('poi_dining_berbayar', 7, 'Membuat info dining sesuai standar', 1, null),
  ('poi_dining_berbayar', 8, 'Infokan ke grup kreator', 1, null),
  ('poi_dining_berbayar', 9, 'Membuat Creator Package sesuai dealing BD', 2, null),
  ('poi_dining_berbayar', 10, 'Cek & kurasi kreator koordinasi dengan BD', 1, null),
  ('poi_dining_berbayar', 11, 'Jika masih kurang jumlah kreator akan di lempar ke grup batch & koordinasi dengan tim CM untuk kreator-kreator baru yang belum join grup kota', 1, null),
  ('poi_dining_berbayar', 12, 'Mengumumkan ke grup kreator terpilih', 1, null),
  ('poi_dining_berbayar', 13, 'Membuat grup khusus sementara untuk koordinasi', 1, null),
  ('poi_dining_berbayar', 14, 'Memasukan kreator ke dalam grup & cek sudah masuk semua atau belum', 1, null),
  ('poi_dining_berbayar', 15, 'Infokan perihal brief, SOW, & link pengumpulan VT di grup sementara', 1, null),
  ('poi_dining_berbayar', 16, 'Memastikan VT sesuai brief merchant & koordinasi dengan BD & pihak brand terkait redeem produk & jika ada kendala di lapangan', 1, null),
  ('poi_dining_berbayar', 17, 'Reminder pengumpulan VT H+1, H+3, H+5 dst (sesuai timeline dealing dengan Brand) & check Creator Package', null, '7–30 hari (sesuai dealing)'),
  ('poi_dining_berbayar', 18, 'Koordinasi secara berkala dengan PIC Merchant terkait project berjalan', 1, null),
  ('poi_dining_berbayar', 19, 'Membuat & mengirimkan report pengumpulan VT ke BD', 1, null),
  ('poi_dining_berbayar', 20, 'Membuat Monthly Report untuk hotel & performa, koordinasi dengan data analis atau by AI ke depannya', 2, null),
  ('poi_dining_berbayar', 21, 'Menarik data dari Lark request ke tim Data Tiktok setiap tanggal 3/4 awal bulan & update data laporan semua POI tiap bulan', 5, null),
  ('poi_dining_berbayar', 22, 'Membuat report data terupdate poin 13 sesuai req BD', 2, null)
on conflict (flow, step_no) do nothing;
