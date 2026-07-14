// Applies every supabase/migrations/*.sql (in order) to the Supabase project
// via the Management API. Token is read from ../.supabase-token (gitignored) so
// it never appears in the command line or logs.
//
// Usage:  node scripts/apply_migrations.mjs
import { readFileSync, readdirSync } from "node:fs";

const ref = process.env.SUPABASE_PROJECT_REF || "mvcckptntrvzujqaoxxh";
const tokenUrl = new URL("../.supabase-token", import.meta.url);

let token;
try {
  token = readFileSync(tokenUrl, "utf8").trim();
} catch {
  console.error("Missing .supabase-token file (put your Supabase Personal Access Token there).");
  process.exit(1);
}

const dir = new URL("../supabase/migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const f of files) {
  const sql = readFileSync(new URL(f, dir), "utf8");
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql }),
    }
  );
  const body = await res.text();
  if (res.ok) {
    console.log(`✔ ${f}`);
  } else {
    console.error(`�’ ${f} -> HTTP ${res.status}\n${body.slice(0, 800)}`);
    process.exit(1);
  }
}
console.log("All migrations applied.");
