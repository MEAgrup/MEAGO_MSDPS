// Bentuk row CRM yang dibagi antara server component (page.tsx) dan client
// component (forms.tsx). Kolom di sini harus sama dengan select() di page.

export type EmployeeOption = { id: string; full_name: string; division: string };

export type CrmLeadRow = {
  id: string;
  code: string | null;
  nama_bd: string;
  bd_id: string | null;
  tanggal_scouting: string;
  brand: string;
  kategori_brand: string;
  jenis_usaha: string | null;
  source: string | null;
  wilayah: string | null;
  nama_pic: string | null;
  kontak_pic: string | null;
  website_socmed: string | null;
  status: string;
  approach_via: string | null;
  hasil_approach: string | null;
  tanggal_update_status: string;
  benefit_dealing: string | null;
  nominal_bayar: number;
  tanggal_mulai_kontrak: string | null;
  tanggal_akhir_kontrak: string | null;
  notes_kontrak: string | null;
};

export type CrmTransaksiRow = {
  id: string;
  code: string | null;
  crm_lead_id: string;
  tanggal_transaksi: string;
  nama_bd: string;
  bd_id: string | null;
  nama_ops: string;
  ops_id: string | null;
  kategori_poi: string;
  nama_poi: string;
  nama_pic_poi: string;
  kontak_wa: string;
  bentuk_kerjasama: string;
  nominal: number;
  benefit_diberikan: string;
  visit_mulai: string;
  visit_berakhir: string;
  jumlah_kreator: number;
  jumlah_konten: number | null;
  total_jam_live: number | null;
  link_brief: string | null;
  durasi_kerjasama_mulai: string | null;
  durasi_kerjasama_akhir: string | null;
  is_bulk_import: boolean;
};

// Opsi POI untuk form transaksi: hanya lead Dealing/Renewal, urut A-Z.
export type PoiOption = {
  id: string;
  code: string | null;
  brand: string;
  status: string;
  kategori_brand: string;
  nama_bd: string;
  bd_id: string | null;
  nama_pic: string | null;
  kontak_pic: string | null;
};
