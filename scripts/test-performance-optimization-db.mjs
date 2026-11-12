// Offline disposable Postgres only. No URLs, tokens, Supabase CLI or remote client.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-performance-optimization-db.mjs <PGlite installation directory>");
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const db = new PGlite();
const sql = (file) => readFile(path.join(root,file),"utf8");
try {
  await db.exec(await sql("supabase/tests/fixtures/performance-optimization.sql"));
  for (const file of ["supabase/migrations/20261211000000_webhook_retention_index.sql", "supabase/migrations/20261211001000_webhook_retention_batch.sql", "supabase/migrations/20261211002000_atomic_quo_ingestion.sql"]) {
    await db.exec(await sql(file));
    await db.exec(await sql(file));
  }
  const results = await db.exec(await sql("supabase/tests/176_webhook_optimization_isolated.sql"));
  const checks = results.flatMap((result) => result.rows).filter((row) => typeof row.name === "string" && typeof row.result === "string");
  console.table(checks);
  if (!checks.length || checks.some((row) => row.result !== "PASS")) throw new Error("Webhook optimization harness failed");
  console.log(`${checks.length} behavioral SQL checks passed. Files applied twice verbatim; shared production untouched. Concurrent multi-connection behavior still requires a real isolated Postgres test.`);
} catch (error) {
  console.error("Isolated SQL validation failed:",error.code ?? "",error.message,error.where ?? "");
  process.exitCode=1;
} finally { await db.close(); }
