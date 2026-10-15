// Runs the exact migration twice and behavioral harness on disposable embedded Postgres.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-processor-board-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const sql = (name) => readFile(path.join(root, name), "utf8");
const db = new PGlite();
try {
  await db.exec(await sql("supabase/tests/fixtures/processor_board.sql"));
  const migration = await sql("supabase/migrations/20261015045700_processor_board_job_assessments.sql");
  await db.exec(migration);
  await db.exec(migration);
  const results = await db.exec(await sql("supabase/tests/150_processor_board.sql"));
  const checks = results.flatMap((r) => r.rows).filter((r) => r.name && r.result);
  console.table(checks);
  if (!checks.length || checks.some((c) => c.result !== "PASS")) throw new Error("Processor Board SQL behavioral harness failed");
  console.log(`${checks.length} checks passed. Shared production untouched.`);
} finally { await db.close(); }
