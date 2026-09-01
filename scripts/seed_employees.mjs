// Seeds example MSDPS staff (auth users + employees rows) using the service role.
// Idempotent: re-running updates existing rows instead of duplicating.
//
// Run:  npm run seed     (loads .env.local automatically)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "Msdps#2026"; // shared default — change after first login.

// PRD sample names (Phase 0 OA-9) + the Leads/OD/Director needed for later phases.
const people = [
  { full_name: "Yohan Agustian", email: "yohanagustian@meagency.co.id", division: "Account", rank: "lead", is_director: true },
  { full_name: "Rara (OD)",      email: "od@meago.test",       division: "Account",    rank: "lead",  is_od: true },
  { full_name: "Dewi",           email: "dewi@meago.test",     division: "Marketing",  rank: "staff" },
  { full_name: "Bima",           email: "bima@meago.test",     division: "Marketing",  rank: "lead" },
  { full_name: "Ajeng",          email: "ajeng@meago.test",    division: "BizDev",     rank: "staff" },
  { full_name: "Galih",          email: "galih@meago.test",    division: "BizDev",     rank: "staff" },
  { full_name: "Tono",           email: "tono@meago.test",     division: "BizDev",     rank: "lead" },
  { full_name: "Arif",           email: "arif@meago.test",     division: "BizDev",     rank: "staff" },
  { full_name: "Azka",           email: "azka@meago.test",     division: "BizDev",     rank: "staff" },
  { full_name: "Dhaffa",         email: "dhaffa@meago.test",   division: "BizDev",     rank: "staff" },
  { full_name: "Fina",           email: "fina@meago.test",     division: "Finance",    rank: "staff" },
  { full_name: "Fani",           email: "fani@meago.test",     division: "Finance",    rank: "lead" },
  { full_name: "Anty",           email: "anty@meago.test",     division: "Account",    rank: "staff" },
  { full_name: "Mey",            email: "mey@meago.test",      division: "Account",    rank: "staff" },
  { full_name: "Sari",           email: "sari@meago.test",     division: "Account",    rank: "lead" },
  { full_name: "Sepri",          email: "sepri@meago.test",    division: "Ecommerce",  rank: "staff" },
  { full_name: "Eka",            email: "eka@meago.test",      division: "Ecommerce",  rank: "lead" },
  { full_name: "Erlina",         email: "erlina@meago.test",   division: "Ads",        rank: "staff" },
  { full_name: "Adit",           email: "adit@meago.test",     division: "Ads",        rank: "lead" },
  { full_name: "Sembo",          email: "sembo@meago.test",    division: "KOL",        rank: "staff" },
  { full_name: "Rizal",          email: "rizal@meago.test",    division: "KOL",        rank: "staff" },
  { full_name: "Koko",           email: "koko@meago.test",     division: "KOL",        rank: "lead" },
];

async function findUserByEmail(email) {
  // listUsers is paginated (default 50/page); seed set is small.
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < 100) break;
  }
  return null;
}

let okCount = 0;
for (const p of people) {
  try {
    let userId;
    const { data: created, error } = await admin.auth.admin.createUser({
      email: p.email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) {
      const existing = await findUserByEmail(p.email);
      if (!existing) {
        console.error(`✗ ${p.email}: ${error.message}`);
        continue;
      }
      userId = existing.id;
    } else {
      userId = created.user.id;
    }

    const { error: upErr } = await admin.from("employees").upsert(
      {
        id: userId,
        full_name: p.full_name,
        division: p.division,
        rank: p.rank,
        is_od: !!p.is_od,
        is_director: !!p.is_director,
      },
      { onConflict: "id" }
    );
    if (upErr) {
      console.error(`✗ ${p.email}: ${upErr.message}`);
      continue;
    }
    okCount++;
    console.log(`✔ ${p.full_name} <${p.email}> — ${p.division}/${p.rank}${p.is_director ? "/Director" : ""}${p.is_od ? "/OD" : ""}`);
  } catch (e) {
    console.error(`✗ ${p.email}: ${e.message}`);
  }
}

console.log(`\nDone. ${okCount}/${people.length} employees seeded.`);
console.log(`Default password for all: ${PASSWORD}  (ganti setelah login pertama)`);
