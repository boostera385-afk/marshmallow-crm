// Exact migration (applied twice) and behavioral harness on isolated embedded Postgres. Never connects to Supabase.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-cs-team-performance-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const root = fileURLToPath(new URL("../", import.meta.url));
const sql = (file) => readFile(path.join(root, file), "utf8");
const db = new PGlite();
try {
  await db.exec(await sql("supabase/tests/fixtures/cs_team_performance.sql"));
  const migration = await sql("supabase/migrations/20261128000000_cs_team_performance_access.sql");
  await db.exec(migration);
  await db.exec(migration);
  const checks = (await db.exec(await sql("supabase/tests/170_cs_team_performance.sql"))).flatMap((r) => r.rows).filter((r) => r.name && r.result);
  console.table(checks);
  if (checks.length !== 8 || checks.some((c) => c.result !== "PASS")) throw new Error("CS Team Performance SQL harness failed");
  console.log(`${checks.length} checks passed. Shared production untouched.`);
} finally { await db.close(); }
