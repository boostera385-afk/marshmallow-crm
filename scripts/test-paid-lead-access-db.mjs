// Runs exact SQL files on disposable embedded Postgres, never the linked project.
// Install @electric-sql/pglite outside the repo, then supply its installation dir.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-paid-lead-access-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const sql = (file) => readFile(path.join(root, file), "utf8");
const db = new PGlite();
try {
  await db.exec(await sql("supabase/tests/fixtures/paid_lead_access.sql"));
  const migration = await sql("supabase/migrations/20261204000000_paid_lead_access.sql");
  await db.exec(migration);
  await db.exec(migration); // Idempotent.
  const results = await db.exec(await sql("supabase/tests/170_paid_lead_access.sql"));
  const checks = results.flatMap((result) => result.rows).filter((row) => typeof row.name === "string" && typeof row.result === "string");
  console.table(checks);
  if (!checks.length || checks.some((row) => row.result !== "PASS")) throw new Error("SQL behavioral harness failed");
  console.log(`${checks.length} SQL behavior checks passed; migration applied twice to disposable Postgres. Shared project untouched.`);
} catch (error) {
  console.error("Isolated SQL validation failed:", error.code ?? "", error.message, error.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
