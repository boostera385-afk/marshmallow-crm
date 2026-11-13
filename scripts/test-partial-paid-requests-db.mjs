// Exact migration and behavioral harness on disposable embedded Postgres only.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-partial-paid-requests-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const sql = (file) => readFile(path.join(root, file), "utf8");
const db = new PGlite();
try {
  await db.exec(await sql("supabase/tests/fixtures/partial_paid_requests.sql"));
  const migration = await sql("supabase/migrations/20261214000000_partial_paid_requests.sql");
  await db.exec(migration);
  await db.exec(migration);
  await db.exec("CREATE TRIGGER enforce_paid_status_rules BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.enforce_paid_status_rules()");
  const results = await db.exec(await sql("supabase/tests/178_partial_paid_requests.sql"));
  const checks = results.flatMap((result) => result.rows).filter((row) => typeof row.name === "string" && typeof row.result === "string");
  console.table(checks);
  if (checks.length !== 25 || checks.some((row) => row.result !== "PASS")) throw new Error("SQL behavioral harness failed");
  const smoke = (await db.exec(await sql("supabase/tests/179_partial_paid_requests_readonly.sql"))).flatMap((result) => result.rows);
  console.table(smoke);
  if (smoke.length !== 6 || smoke.some((row) => row.result !== "PASS")) throw new Error("Read-only SQL smoke checks failed");
  console.log(`${checks.length} SQL behavior checks passed; migration applied twice. Shared project untouched.`);
} catch (error) {
  console.error("Isolated SQL validation failed:", error.code ?? "", error.message, error.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
