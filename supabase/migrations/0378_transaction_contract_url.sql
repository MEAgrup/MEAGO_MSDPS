-- =============================================================================
-- MSDPS · M5 Finance · migrasi 0378 — link kontrak SPK/MoU wajib di verifikasi
-- pembayaran PERTAMA
-- =============================================================================
-- Feedback Finance (Jia, 29–30 Okt 2026); ACC pemilik (Yohan, 6 Nov 2026).
-- Antrian Verifikasi hanya punya jumlah + "No. bukti (opsional)" — tidak ada
-- tempat menyematkan link kontrak yang sudah ditandatangani merchant.
--
-- Aturan:
--   * transactions.contract_url (BARU) — satu link per transaksi, http/https.
--   * verify_payment() menolak verifikasi PERTAMA (amount_verified masih 0)
--     bila belum ada link tersimpan dan p_contract_url kosong:
--       '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
--     Cicilan berikutnya tidak meminta ulang. p_contract_url yang diisi
--     (kapan pun) divalidasi dan menggantikan link lama:
--       '[link kontrak tidak valid]'
--   * set_transaction_contract_url() — Finance/Director mengganti link tanpa
--     harus memverifikasi pembayaran.
--   * CHECK constraint = jaring pengaman untuk jalur UPDATE langsung
--     (RLS trx_update mengizinkan Finance meng-UPDATE transactions).
--
-- Kenapa kolom BARU, bukan contract_attachment (0103): verify_payment() lama
-- menulis "No. bukti" (p_proof) ke contract_attachment, jadi kolom itu di data
-- live berisi nomor bukti transfer, bukan kontrak. Memakainya ulang akan
-- membuat transaksi lama tampak "sudah punya kontrak". Perilaku p_proof
-- dibiarkan apa adanya (di luar cakupan perubahan ini).
--
-- Transaksi lama yang sudah terverifikasi sebagian tanpa link TIDAK diblokir
-- (aturannya hanya untuk verifikasi pertama); Finance bisa melengkapi linknya
-- lewat set_transaction_contract_url().
-- =============================================================================

create or replace function is_valid_contract_url(p text)
returns boolean language sql immutable set search_path = public as $$
  select p is not null
     and length(p) <= 2048
     and p ~* '^https?://[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
$$;

comment on function is_valid_contract_url(text) is
  'Validator link kontrak SPK/MoU (0378): http/https, host bertitik, tanpa spasi, maks 2048 karakter.';

alter table transactions add column contract_url text;
alter table transactions add constraint transactions_contract_url_valid
  check (contract_url is null or is_valid_contract_url(contract_url));

comment on column transactions.contract_url is
  'Link kontrak SPK/MoU yang ditandatangani merchant (0378). Wajib sebelum verifikasi pembayaran pertama; diisi/diganti hanya oleh Finance/Director.';

-- ---- verify_payment(): signature naik dari 3 ke 4 argumen ------------------
-- DROP dulu: membiarkan versi 3-argumen hidup berdampingan membuat panggilan
-- 3-argumen ambigu (keduanya cocok karena default) DAN membuka jalan pintas
-- melewati validasi link.
drop function verify_payment(uuid, numeric, text);

create function verify_payment(
  p_transaction_id uuid,
  p_amount         numeric,
  p_proof          text default null,
  p_contract_url   text default null
) returns transaction_status
language plpgsql security definer set search_path = public as $$
declare
  v_trx transactions%rowtype;
  v_url text := nullif(btrim(p_contract_url), '');
  v_new_verified numeric;
  v_new_status transaction_status;
begin
  if not (auth_division() = 'Finance' or is_director()) then
    raise exception '[hanya Finance yang dapat memverifikasi pembayaran]' using errcode='insufficient_privilege';
  end if;
  select * into v_trx from transactions where id = p_transaction_id;
  if not found then raise exception '[transaksi tidak ditemukan]'; end if;

  if v_url is not null and not is_valid_contract_url(v_url) then
    raise exception '[link kontrak tidak valid]' using errcode='check_violation';
  end if;
  if v_trx.amount_verified = 0 and coalesce(v_url, v_trx.contract_url) is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode='check_violation';
  end if;

  v_new_verified := v_trx.amount_verified + p_amount;
  if v_new_verified > v_trx.total_agreed_value then
    raise exception '[jumlah melebihi total transaksi, periksa kembali]' using errcode='check_violation';
  end if;

  if v_new_verified >= v_trx.total_agreed_value then
    v_new_status := '[Lunas]';
  elsif v_new_verified > 0 then
    v_new_status := '[Terverifikasi - Sebagian]';
  else
    v_new_status := v_trx.status;
  end if;

  update transactions
     set amount_verified = v_new_verified,
         status = v_new_status,
         contract_attachment = coalesce(p_proof, contract_attachment),
         contract_url = coalesce(v_url, contract_url),
         released_to_account_at = coalesce(released_to_account_at,
           case when v_new_status in ('[Terverifikasi - Sebagian]','[Lunas]') then now() end)
   where id = p_transaction_id;

  return v_new_status;
end $$;

revoke execute on function verify_payment(uuid, numeric, text, text) from public, anon;
grant  execute on function verify_payment(uuid, numeric, text, text) to authenticated;

-- ---- set_transaction_contract_url(): ganti link tanpa verifikasi ------------
create function set_transaction_contract_url(
  p_transaction_id uuid,
  p_contract_url   text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_url text := nullif(btrim(p_contract_url), '');
begin
  if not (auth_division() = 'Finance' or is_director()) then
    raise exception '[hanya Finance yang dapat mengubah link kontrak]' using errcode='insufficient_privilege';
  end if;
  if v_url is null then
    raise exception '[data tidak lengkap, silahkan lengkapi semua pertanyaan wajib!]'
      using errcode='check_violation';
  end if;
  if not is_valid_contract_url(v_url) then
    raise exception '[link kontrak tidak valid]' using errcode='check_violation';
  end if;
  update transactions set contract_url = v_url where id = p_transaction_id;
  if not found then raise exception '[transaksi tidak ditemukan]'; end if;
end $$;

revoke execute on function set_transaction_contract_url(uuid, text) from public, anon;
grant  execute on function set_transaction_contract_url(uuid, text) to authenticated;
