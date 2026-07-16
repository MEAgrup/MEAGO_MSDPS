insert into brand_deals (brand_name, kategori_poi, pic_name, pic_whatsapp, bentuk_kerjasama,
  nominal_harga, benefit, visit_start_date, visit_start_time, visit_end_date, visit_end_time,
  kreator_needed, konten_needed, brief_link, bd_id,
  listing_date, visit_realized_date, kreator_realized, video_realized, visit_checked,
  created_at, sourced_by_role)
select v.poi, v.kat, v.pic, v.wa, v.kerja, v.nominal::numeric, v.benefit,
  v.vsd::date, v.vst::time, v.ved::date, v.vet::time, v.kre::int, v.kon::int, v.brief,
  u.id, v.listing::date, v.rvisit::date, v.rkre::int, v.rvid::int, v.checked::boolean, v.ts::timestamptz, 'bd'
from (values
('YUTAKA INN Dsoetta Suhat Raya','Accomodation','Esther','6285179756252','Free',null,'Accomodation - Open Room Only','2026-06-22','13:00','2026-06-22','15:00',3,15,null,'fajar.bd@meago.dev',null,null,null,null,false,'2026-06-23 14:46:49'),
('YUTAKA INN Suhat Malang','Accomodation','Esther','6285179756252','Free',null,'Accomodation - Open Room Only','2026-06-22','13:00','2026-06-22','15:00',3,15,null,'fajar.bd@meago.dev',null,null,null,null,false,'2026-06-23 14:46:49'),
('YUTAKA INN Musium Angkut Batu','Accomodation','Esther','6285179756252','Free',null,'Accomodation - Open Room Only','2026-06-22','13:00','2026-06-22','15:00',3,15,null,'fajar.bd@meago.dev',null,null,null,null,false,'2026-06-23 14:46:49'),
('YUTAKA INN Dinoyo Malang','Accomodation','Esther','6285179756252','Free',null,'Accomodation - Open Room Only','2026-06-22','13:00','2026-06-22','15:00',3,15,null,'fajar.bd@meago.dev',null,null,null,null,false,'2026-06-23 14:46:49'),
('YUTAKA INN Nugraha Malang','Accomodation','Esther','6285179756252','Free',null,'Accomodation - Open Room Only','2026-06-22','13:00','2026-06-22','15:00',3,15,null,'fajar.bd@meago.dev',null,null,null,null,false,'2026-06-23 14:46:49'),
('Santoroni Homestay','Accomodation','Admin','6282141014414','Free',null,'Accomodation - Open Room Only','2026-06-13','13:00','2026-06-13','15:00',5,15,null,'fajar.bd@meago.dev',null,null,null,null,false,'2026-06-23 14:46:49'),
('Sunlake Waterfront Hotel & Resort','Accomodation','Shinta','6282310842286','Free',0.0,'Accomodation - Open Room Only','2026-07-04','13:00','2026-07-05','12:00',20,60,'menyusul','claudia.bd@meago.dev',null,null,null,null,false,'2026-06-24 15:39:08'),
('Voco Hotel Setiabudhi by IHG','Accomodation','Reyhan','6287780448114','Free',null,'Accomodation - Open Room Only','2026-07-01','13:00','2026-07-01','15:00',10,20,'datang per sesi','rafli.bd@meago.dev',null,null,null,null,false,'2026-06-25 09:21:04'),
('Crowne Plaza by IHG Hotel Bandung','Accomodation','Fahril','6287802332928','Free',null,'Accomodation - Open Room Only','2026-07-02','14:00','2026-07-02','16:00',10,20,'kurasi dan datang berbarengan tidak persesi','rafli.bd@meago.dev',null,null,null,null,false,'2026-06-25 09:23:19'),
('Riverstone Hotel & Cottage Batu','Accomodation','Amareta Eksa','6288216948615','Free',null,'Accomodation - Free Stay','2026-06-22','14:00','2026-06-22','00:00',2,10,null,'fajar.bd@meago.dev',null,null,null,null,false,'2026-06-30 13:13:11'),
('The 101 Malang OJ','Accomodation','Dario','62881027484004','Free',null,'Accomodation - Open Room Only','2026-06-30','14:00','2026-06-30','17:00',5,15,null,'fajar.bd@meago.dev',null,null,null,null,false,'2026-06-30 16:03:19'),
('Midtown Residence','Accomodation','Anggra','6281271622277','Free',0.0,'Accomodation - Open Room Only','2026-06-05','11:00','2026-06-05','15:00',10,30,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:12:43'),
('Amanuba Resort Rancamaya','Accomodation','Shinta','628159164672','Free',0.0,'Accomodation - Open Room Only','2026-06-04','10:00','2026-06-04','15:00',30,60,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:14:17'),
('Swissbel-inn Tunjungan Surabaya','Accomodation','Amel','6281917184111','Free',0.0,'Accomodation - Open Room Only','2026-06-05','13:00','2026-06-05','17:00',10,30,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:15:55'),
('The Mirah Hotel Bogor','Accomodation','Kezia','6281229295500','Free',0.0,'Accomodation - Open Room Only','2026-06-08','10:00','2026-06-08','13:00',15,45,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:17:33'),
('Novotel Jakarta Pulomas','Accomodation','Arimbi','62811118321','Free',0.0,'Accomodation - Open Room Only','2026-06-18','14:00','2026-06-18','18:00',15,45,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:24:31'),
('Grand Santhi Hotel Bali','Accomodation','Michael','6285373544001','Free',0.0,'Accomodation - Open Room Only','2026-06-12','10:00','2026-06-12','13:00',10,30,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:26:09'),
('Fairfield by Marriott Surabaya','Accomodation','Abelino','6281216652833','Free',0.0,'Accomodation - Open Room Only','2026-06-10','14:00','2026-06-10','16:00',5,15,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:28:01'),
('Goldvitel Hotel Surabaya','Accomodation','Frans','6281515521710','Free',0.0,'Accomodation - Open Room Only','2026-06-10','10:00','2026-06-10','13:00',10,30,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:29:07'),
('Manhattan Hotel Jakarta','Accomodation','Wildan','6282295676568','Free',0.0,'Accomodation - Open Room Only','2026-06-12','13:00','2026-06-12','19:00',10,30,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:32:17')
) as v(poi, kat, pic, wa, kerja, nominal, benefit, vsd, vst, ved, vet, kre, kon, brief, email, listing, rvisit, rkre, rvid, checked, ts)
join auth.users u on u.email = v.email;
