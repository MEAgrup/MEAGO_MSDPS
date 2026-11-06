// Wewenang Laporan Performa Merchant di sisi aplikasi. Cermin SQL
// is_merchant_report_staff() (migrasi 0381) = is_campaign_staff(). Hanya
// menentukan render/redirect — gerbang sesungguhnya RLS + RPC di Postgres.
import { isCampaignStaff, type CampaignActor } from "@/lib/campaign-access";

export function isMerchantReportStaff(me: CampaignActor): boolean {
  return isCampaignStaff(me);
}
