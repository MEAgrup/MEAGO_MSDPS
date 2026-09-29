-- Halaman Kreator / Perpanjangan Kreator membaca app_config 'm8.contract_alert_days'
-- (kunci wajib; kalau hilang halaman crash "Application error", digest 2028541926).
-- Kunci ini tidak pernah diseed (seed lama memakai prefix mcn.*). Nilai 14 hari
-- disamakan dengan mcn.deal_expiring_days; ubah lewat app_config bila perlu.
insert into app_config (key, value) values
  ('m8.contract_alert_days', '14'::jsonb)
on conflict (key) do nothing;
