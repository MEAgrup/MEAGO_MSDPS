-- =============================================================================
-- MSDPS · MCN · Migration 0316 — Add status_kontrak column to mcn_creators
-- =============================================================================
-- Tambah kolom `status_kontrak` (enum: 'kontrak' / 'non kontrak') ke tabel
-- mcn_creators. Default value: 'kontrak'. Constraint CHECK memastikan hanya 2
-- value yang diizinkan.
-- =============================================================================

alter table mcn_creators
add column status_kontrak text not null default 'kontrak'
check (status_kontrak in ('kontrak', 'non kontrak'));

create index mcn_creators_status_kontrak_idx on mcn_creators (status_kontrak);
