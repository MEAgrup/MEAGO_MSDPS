insert into brand_deals (brand_name, kategori_poi, pic_name, pic_whatsapp, bentuk_kerjasama,
  nominal_harga, benefit, visit_start_date, visit_start_time, visit_end_date, visit_end_time,
  kreator_needed, konten_needed, brief_link, bd_id,
  listing_date, visit_realized_date, kreator_realized, video_realized, visit_checked,
  created_at, sourced_by_role)
select v.poi, v.kat, v.pic, v.wa, v.kerja, v.nominal::numeric, v.benefit,
  v.vsd::date, v.vst::time, v.ved::date, v.vet::time, v.kre::int, v.kon::int, v.brief,
  u.id, v.listing::date, v.rvisit::date, v.rkre::int, v.rvid::int, v.checked::boolean, v.ts::timestamptz, 'bd'
from (values
('Grand Istana Rama Hotel Bali','Accomodation','Stefani','6281231999729','Free',0.0,'Accomodation - Open Room Only','2026-06-12','08:00','2026-06-12','11:00',10,50,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:33:36'),
('Ibis Styles Bogor Pajajaran','Accomodation','Aurel','6288211326034','Free',0.0,'Accomodation - Open Room Only','2026-06-14','14:00','2026-06-14','18:00',15,45,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:35:21'),
('Pullman Ciawi Vimala Hills','Accomodation','Dipo','6282211973355','Free',0.0,'Accomodation - Open Room Only','2026-06-13','08:00','2026-06-13','13:00',10,30,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:36:52'),
('Ibis Jakarta Raden Saleh','Accomodation','Nourvian','6289676151891','Free',0.0,'Accomodation - Open Room Only','2026-06-28','07:00','2026-06-28','14:00',10,30,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:40:19'),
('Citra Boutique Hotel Cikarang','Accomodation','Asyri','628990877616','Free',0.0,'Accomodation - Open Room Only','2026-06-27','09:00','2026-06-27','12:00',15,45,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:41:33'),
('Nuanza Hotel Cikarang','Accomodation','Ibrahim','62888888888','Free',0.0,'Accomodation - Open Room Only','2026-06-27','13:00','2026-06-27','17:00',20,60,null,'claudia.bd@meago.dev',null,null,null,null,false,'2026-06-30 21:42:52'),
('Ngangeni Family Homestay','Accomodation','Alda','-','Free',0.0,'Accomodation - Open Room Only','2026-07-14','12:00','2026-07-14','14:00',7,21,'Menyusul','ira.bd@meago.dev',null,null,null,null,false,'2026-07-03 22:34:24'),
('Tjokro Style Hotel Yogyakarta','Accomodation','Rama','-','Free',0.0,'Accomodation - Open Room Only','2026-07-17','13:00','2026-07-17','14:00',7,21,'Menyusul','ira.bd@meago.dev',null,null,null,null,false,'2026-07-14 15:00:26'),
('POPEYES','Dining','ERTONA','6285717113214','Free',0.0,'Dining - Creator Package','2026-06-18','00:00','2026-06-29','23:59',100,200,'GRUP','ajeng@meago.test','2026-06-18','2026-06-23',93,240,true,'2026-06-18 16:50:53'),
('CIMOL BOJOT','Dining','YOGA','6228812212703','Free',0.0,'Dining - Creator Package','2026-06-22','00:00','2026-07-02','23:59',100,200,'GRUP','ajeng@meago.test','2026-06-22','2026-06-25',176,265,true,'2026-06-18 16:57:51'),
('BURGER BANGOR','Dining','ZULHAM','6289684241320','Berbayar',2000000.0,'Dining - Creator Package','2026-06-23','00:00','2026-07-03','23:59',100,300,'BURGER BANGOR COMBO MEALS','ajeng@meago.test','2026-06-18','2026-06-22',100,274,true,'2026-06-23 14:03:43'),
('BINGXUE','Dining','PATRICIA','856','Berbayar',30000000.0,'Dining - Creator Package','2026-06-22','00:00','2026-06-30','23:59',40,160,'GRUP','ajeng@meago.test','2026-06-11','2026-06-16',40,160,true,'2026-06-30 11:52:39'),
('BINGXUE','Dining','PATRICIA','856','Berbayar',10000000.0,'Dining - Creator Package','2026-06-15','00:00','2026-06-30','23:59',225,450,'GRUP','ajeng@meago.test','2026-06-11','2026-06-16',225,381,true,'2026-06-30 11:53:50'),
('BINGXUE','Dining','PATRICIA','856','Berbayar',5000000.0,'Dining - Creator Package','2026-06-15','00:00','2026-06-30','23:59',225,450,'GRUP','ajeng@meago.test','2026-06-11','2026-06-16',225,382,true,'2026-06-30 11:54:42'),
('BINGXUE','Dining','PATRICIA','856','Berbayar',5000000.0,'Dining - Creator Package','2026-06-15','00:00','2026-06-30','23:59',79,158,'GRUP','ajeng@meago.test','2026-06-11','2026-06-16',79,109,true,'2026-06-30 11:56:13'),
('BINGXUE','Dining','PATRICIA','856','Berbayar',1000000.0,'Dining - Creator Package','2026-06-15','00:00','2026-06-30','23:59',79,158,'GRUP','ajeng@meago.test','2026-06-11','2026-06-16',79,111,true,'2026-06-30 11:57:33'),
('BINGXUE','Dining','PATRICIA','856','Berbayar',1000000.0,'Dining - Creator Package','2026-06-15','00:00','2026-06-30','23:59',120,480,'GRUP','ajeng@meago.test','2026-06-29','2026-06-30',120,426,true,'2026-06-30 11:59:01'),
('MPR','Dining','MICHELE','6285719001904','Free',0.0,'Dining - Creator Package','2026-07-02','00:00','2026-07-15','23:59',100,500,'GRUP','ajeng@meago.test','2026-06-19','2026-06-22',100,500,true,'2026-07-02 17:07:26'),
('MPR','Dining','MICHELE','6285719001904','Free',0.0,'Dining - Creator Package','2026-07-09','00:00','2026-07-16','23:59',100,500,'grup','ajeng@meago.test',null,null,null,null,false,'2026-07-16 10:52:05')
) as v(poi, kat, pic, wa, kerja, nominal, benefit, vsd, vst, ved, vet, kre, kon, brief, email, listing, rvisit, rkre, rvid, checked, ts)
join auth.users u on u.email = v.email;
