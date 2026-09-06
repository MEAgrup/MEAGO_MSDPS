-- =============================================================================
-- MSDPS · Leads/BD · Migration 0332 — Merchant Deals pivot: deal transactions
-- =============================================================================
-- Tab "Merchant Deals" bergeser dari pencatatan shop deal e-commerce (0305) ke
-- pencatatan transaksi kerja sama POI/merchant hasil pipeline BD (Leads &
-- Prospek → Dealing/Renewal).
--
-- brand_deals sudah punya sebagian kolom untuk ini (kategori_poi, pic_name,
-- pic_whatsapp, bentuk_kerjasama, nominal_harga, benefit, visit_start/end_date,
-- visit_start/end_time, kreator_needed, konten_needed, brief_link, bd_id,
-- transaction_id, dst) dari migrasi lampau yang tidak tercermin di riwayat
-- migrasi lokal repo ini — dipakai ulang di sini, TIDAK dibuat dobel. Kolom
-- lama shop-deal (shop_id, komisi, ads_budget, pipeline_stage, dst) juga TIDAK
-- dihapus — masih dipakai BizDev Workspace (bizdev/page.tsx) & v_portal_deals
-- (creator portal, 0312) — hanya sudah tidak diisi oleh form baru ini.
--
-- Kolom yang benar-benar baru di bawah: unique_id (ID eksternal Import Master
-- Deal), lead_id (link ke Pool Lead asal), ops_name, tanggal kontrak (khusus
-- kategori Dining), total_jam_live.
-- =============================================================================

alter table brand_deals
  add column if not exists unique_id             text,
  add column if not exists lead_id               uuid references leads(id) on delete set null,
  add column if not exists ops_name              text,
  add column if not exists tanggal_mulai_kontrak date,
  add column if not exists tanggal_akhir_kontrak date,
  add column if not exists total_jam_live        numeric;

alter table brand_deals
  add constraint brand_deals_ops_name_check
    check (ops_name is null or ops_name in ('Fajri','Aliya','Tammy'));

create unique index if not exists brand_deals_unique_id_uniq
  on brand_deals (unique_id) where unique_id is not null;
create index if not exists brand_deals_lead_id_idx on brand_deals (lead_id);

comment on column brand_deals.lead_id is
  'Link ke leads (Pool Lead) berstatus Dealing/Renewal yang menjadi asal transaksi ini.';
comment on column brand_deals.unique_id is
  'ID eksternal opsional dari Import Master Deal — dipakai sebelum baris dilengkapi manual.';

-- bentuk_kerjasama sudah ada tapi nilainya 'Free'/'Berbayar' (dari migrasi
-- lampau) — spesifikasi saat ini pakai 'Berbayar'/'Free/Barter'. Ganti check
-- constraint-nya; aman karena tabel di-reset di bawah (tidak ada baris lama
-- yang perlu dicocokkan).
alter table brand_deals drop constraint if exists brand_deals_bentuk_kerjasama_check;

-- ---- Reset "Daftar Deal": data shop-deal lama tidak relevan lagi ------------
-- deal_products ikut terhapus (FK on delete cascade); cooperating_shops.deal_id
-- & live_schedule_slots.deal_id otomatis null (FK on delete set null).
delete from brand_deals;

alter table brand_deals
  add constraint brand_deals_bentuk_kerjasama_check
    check (bentuk_kerjasama is null or bentuk_kerjasama in ('Berbayar','Free/Barter'));

alter table brand_deals
  alter column nominal_harga set default 0;
update brand_deals set nominal_harga = 0 where nominal_harga is null;
alter table brand_deals
  alter column nominal_harga set not null,
  add constraint brand_deals_nominal_harga_check check (nominal_harga >= 0);
