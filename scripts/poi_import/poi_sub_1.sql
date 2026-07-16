insert into brand_deals (brand_name, kategori_poi, pic_name, pic_whatsapp, bentuk_kerjasama,
  nominal_harga, benefit, visit_start_date, visit_start_time, visit_end_date, visit_end_time,
  kreator_needed, konten_needed, brief_link, bd_id,
  listing_date, visit_realized_date, kreator_realized, video_realized, visit_checked,
  created_at, sourced_by_role)
select v.poi, v.kat, v.pic, v.wa, v.kerja, v.nominal::numeric, v.benefit,
  v.vsd::date, v.vst::time, v.ved::date, v.vet::time, v.kre::int, v.kon::int, v.brief,
  u.id, v.listing::date, v.rvisit::date, v.rkre::int, v.rvid::int, v.checked::boolean, v.ts::timestamptz, 'bd'
from (values
('Nakamura Therapy Sidoarjo - Kab Sidoarjo','TTD','Frangky','6285888585427','Free',null,'TTD - Free Ticket','2026-06-21','10:00','2026-06-25','18:00',3,15,'bisa +1','fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Nakamura Kota Baru Parahyangan Kab Bandung','TTD','Frangky','6285888585427','Free',null,'TTD - Free Ticket','2026-06-21','10:00','2026-06-25','18:00',1,5,'bisa +1','fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('The Healing Touch Nakamura Holistic Therapy Bandung - Paskal','TTD','Frangky','6285888585427','Free',null,'TTD - Free Ticket','2026-06-21','10:00','2026-06-25','18:00',1,5,'bisa +1','fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Fun & Fit Adventure Sulawesi Tenggara Kendari The Park Kendari','TTD','Wawan','628128323435','Free',null,'TTD - Free Ticket','2026-06-23','10:00','2026-06-28','18:00',4,20,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Funworld Sulawesi Tenggara Kendari The Park Kendari','TTD','Wawan','628128323435','Free',null,'TTD - Free Ticket','2026-06-23','10:00','2026-06-28','18:00',2,10,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Kidzlandia Sulawesi Selatan Makassar MALL PHINISI POINT MAKASSAR','TTD','Wawan','628128323435','Free',null,'TTD - Free Ticket','2026-06-23','10:00','2026-06-28','18:00',1,5,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Kidzlandia Sulawesi Selatan Makassar NIPAH PARK MAKASSAR','TTD','Wawan','628128323435','Free',null,'TTD - Free Ticket','2026-06-23','10:00','2026-06-28','18:00',4,20,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Fun & Fit Adventure Sulawesi Tenggara Kendari The Park Kendari','TTD','Wawan','628128323435','Free',null,'TTD - Free Ticket','2026-06-23','10:00','2026-06-28','18:00',4,20,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Funworld Nipah Mall Makassar','TTD','Wawan','628128323435','Free',null,'TTD - Free Ticket','2026-06-23','10:00','2026-06-28','18:00',5,25,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Kidzila Sulawesi Tenggara The Park Kendari','TTD','Wawan','628128323435','Free',null,'TTD - Free Ticket','2026-06-23','10:00','2026-06-28','18:00',1,5,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Kidzlandia Kalimantan Timur Balikpapan PENTACITY MALL BALIKPAPAN','TTD','Wawan','628128323435','Free',null,'TTD - Free Ticket','2026-06-23','10:00','2026-06-28','18:00',1,5,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Funworld Kalimantan Timur Balikpapan Pentacity Mall Balikpapan','TTD','Wawan','628128323435','Free',null,'TTD - Free Ticket','2026-06-23','10:00','2026-06-28','18:00',1,5,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 08:35:57'),
('Scientia Square Park','TTD','Anita','6287890191551','Free',null,'TTD - Free Ticket','2026-06-21','10:00','2026-06-27','17:00',10,50,null,'fajar.bd@meago.dev',null,null,null,null,null,'2026-06-30 11:56:47'),
('Taman Safari Bogor','TTD','Regina','6287712395471','Free',null,'TTD - Free Ticket','2026-07-04','10:00','2026-07-05','17:00',4,20,'free 3 tiket','fajar.bd@meago.dev',null,null,null,null,null,'2026-07-15 09:55:39'),
('Taman Safari Bogor','TTD','Regina','6287712395471','Free',null,'TTD - Free Ticket','2026-07-10','10:00','2026-07-19','17:00',13,65,'free 3 tiket','fajar.bd@meago.dev',null,null,null,null,null,'2026-07-15 09:55:39'),
('Jakarta Aquarium Safari','TTD','Regina','6287712395471','Free',null,'TTD - Free Ticket','2026-07-04','10:00','2026-07-12','17:00',67,335,'free 4 tiket','fajar.bd@meago.dev',null,null,null,null,null,'2026-07-15 09:55:39'),
('IBIS STYLE SIMATUPANG','Accomodation','Agni','6282315558294','Free',0.0,'Accomodation - Open Room Only','2026-06-15','14:00','2026-06-15','17:00',15,45,'Soon','sembo.bd@meago.dev',null,null,null,null,false,'2026-06-17 10:20:39'),
('The Swantari Terrace View Villa','Accomodation','Nabila','-','Free',0.0,'Accomodation - Open Room Only','2026-06-22','12:00','2026-06-22','14:00',7,21,'Menyusul','ira.bd@meago.dev',null,null,null,null,false,'2026-06-17 10:35:48'),
('Yogyakarta Marriott Hotel','Accomodation','Nanda','-','Free',0.0,'Accomodation - Open Room Only','2026-07-02','10:00','2026-07-02','13:00',5,15,'Menyusul','ira.bd@meago.dev',null,null,null,null,false,'2026-06-17 21:54:25'),
('Crystal Lotus Hotel','Accomodation','Amanda','-','Free',0.0,'Accomodation - Open Room Only','2026-07-06','12:00','2026-07-06','14:00',7,21,'Menyusul','ira.bd@meago.dev',null,null,null,null,false,'2026-06-22 16:42:14')
) as v(poi, kat, pic, wa, kerja, nominal, benefit, vsd, vst, ved, vet, kre, kon, brief, email, listing, rvisit, rkre, rvid, checked, ts)
join auth.users u on u.email = v.email;
