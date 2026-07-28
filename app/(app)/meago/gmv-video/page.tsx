import { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, PageSection, Card } from "@/components/layout";
import { VideoGmvUploadForm } from "./upload-form";
import { VideoGmvTable } from "./video-table";

export const metadata: Metadata = {
  title: "GMV Video Weekly | MEAGO MSDPS",
  description: "Pelacakan kinerja video mingguan per kreator.",
};

export default async function VideoGmvPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <PageSection>
        <Card>Tidak terautentikasi.</Card>
      </PageSection>
    );
  }

  // Fetch current user info.
  const { data: me } = await supabase
    .from("employees")
    .select("id, name, division, rank")
    .eq("id", user.id)
    .maybeSingle();

  if (!me) {
    return (
      <PageSection>
        <Card>Data karyawan tidak ditemukan.</Card>
      </PageSection>
    );
  }

  return (
    <>
      <PageHeader title="GMV Video Weekly Tracking" subtitle="Pelacakan kinerja video mingguan per kreator." />

      <PageSection>
        <div className="grid gap-6 grid-cols-1 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <VideoGmvUploadForm userId={user.id} userName={me.name} />
          </div>

          <div className="lg:col-span-2">
            <VideoGmvTable />
          </div>
        </div>
      </PageSection>
    </>
  );
}
