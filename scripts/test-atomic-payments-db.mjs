// Exact SQL files against disposable embedded Postgres, never the linked project.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-atomic-payments-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const sql = (file) => readFile(path.join(root, file), "utf8");
const db = new PGlite();
try {
  await db.exec(await sql("supabase/tests/fixtures/atomic_payment_workflow.sql"));
  await db.exec(await sql("supabase/migrations/20261214000000_partial_paid_requests.sql"));
  await db.exec("CREATE TRIGGER enforce_paid_status_rules BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.enforce_paid_status_rules()");
  const migration = await sql("supabase/migrations/20261231000000_atomic_payment_workflow.sql");
  await db.exec(migration);
  await db.exec(migration);
  // Conflicts must not use 40001: PostgREST retries that SQLSTATE forever.
  const nonRetryable = await sql("supabase/migrations/20261231000300_payment_workflow_non_retryable_conflicts.sql");
  await db.exec(nonRetryable);
  await db.exec(nonRetryable);
  const results = (await db.exec(await sql("supabase/tests/181_atomic_payment_workflow.sql")))
    .flatMap((result) => result.rows).filter((row) => typeof row.name === "string" && typeof row.result === "string");
  console.table(results);
  if (results.length < 35 || results.some((row) => row.result !== "PASS")) throw new Error("Atomic payment SQL behavioral checks failed");
  console.log(`${results.length} SQL checks passed; exact migration applied twice. Shared project untouched.`);
} catch (error) {
  console.error("Isolated payment SQL failed:", error.code ?? "", error.message, error.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
