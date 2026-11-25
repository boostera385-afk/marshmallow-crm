// Exact migration (applied twice) and behavioral harness on isolated embedded Postgres. Never connects to Supabase.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-jellybean-departments-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const sql = (file) => readFile(path.join(root, file), "utf8");
const EXPECTED = 20;
const db = new PGlite();
try {
  await db.exec(await sql("supabase/tests/fixtures/jellybean_lead_departments.sql"));
  const migration = await sql("supabase/migrations/20261231000800_jellybean_lead_departments.sql");
  await db.exec(migration);
  await db.exec(migration);
  const checks = (await db.exec(await sql("supabase/tests/191_jellybean_lead_departments.sql"))).flatMap((r) => r.rows).filter((r) => r.name && r.result);
  console.table(checks);
  if (checks.length !== EXPECTED || checks.some((c) => c.result !== "PASS")) throw new Error("JellyBean department SQL harness failed");
  console.log(`${checks.length} checks passed. Shared production untouched.`);
} finally { await db.close(); }
