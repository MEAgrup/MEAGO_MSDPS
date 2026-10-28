import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Pencatat page view karyawan (migrasi 0376) — dipanggil <UsageTracker /> di
// layout (app). Best-effort: SELALU 204, apa pun hasilnya, supaya kegagalan
// pencatatan tidak pernah terlihat pengguna. Siapa yang boleh tercatat
// ditegakkan RLS (employee_id = auth.uid() & karyawan aktif) — kreator,
// merchant, dan karyawan nonaktif ditolak DB tanpa perlu dicek di sini.
// /api/ dikecualikan dari middleware, jadi sesi dibaca langsung di sini.
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { path?: unknown };
    const path = typeof body.path === "string" ? body.path.split(/[?#]/)[0] : "";
    if (path.startsWith("/") && path.length <= 512) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from("usage_page_views").insert({ employee_id: user.id, path });
      }
    }
  } catch {
    // diam: telemetri tidak boleh mengganggu pemakaian sistem
  }
  return new NextResponse(null, { status: 204 });
}
