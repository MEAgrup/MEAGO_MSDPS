import { redirect } from "next/navigation";
import { getCachedClient, getSessionUser, getCreator } from "@/lib/supabase/server";
import { BankAccountForm } from "./bank-account-form";

export default async function ProfilPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const creator = await getCreator();
  if (!creator) redirect("/dashboard");

  const supabase = await getCachedClient();
  const { data } = await supabase
    .from("mcn_creators")
    .select("bank_name, bank_account_number, bank_account_name")
    .eq("id", creator.id)
    .maybeSingle();

  return (
    <>
      <h1>Profil</h1>
      <p className="page-sub">Rekening di sini dipakai untuk pencairan payout campaign MEA GO.</p>

      <div className="card">
        <h2>Rekening Pencairan</h2>
        <BankAccountForm
          defaults={{
            bank_name: data?.bank_name ?? "",
            bank_account_number: data?.bank_account_number ?? "",
            bank_account_name: data?.bank_account_name ?? "",
          }}
        />
      </div>
    </>
  );
}
