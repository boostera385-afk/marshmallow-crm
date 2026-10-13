// Exact migration/harness on isolated embedded Postgres. Never connects to Supabase.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-copilot-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const db = new PGlite();
const root = fileURLToPath(new URL("../", import.meta.url));
const sql = (file) => readFile(path.join(root, file), "utf8");
try {
  await db.exec(await sql("supabase/tests/fixtures/copilot.sql"));
  const baseline = await sql("supabase/tests/40_leads_rls_baseline.sql");
  const matrix = (results) => results.flatMap((r) => r.rows).filter((r) => typeof r.role_name === "string");
  const before = matrix(await db.exec(baseline));
  const migration = await sql("supabase/migrations/20261013045711_marshmallow_copilot.sql");
  await db.exec(migration);
  // Grant classification must not depend on regprocedure's display spelling.
  await db.exec("SET search_path = pg_catalog");
  await db.exec(migration);
  await db.exec("SET search_path = public");
  const policies = await sql("supabase/migrations/20261013062924_copilot_rls_policy_efficiency.sql");
  await db.exec(policies);
  await db.exec(policies);
  const after = matrix(await db.exec(baseline));
  if (before.length !== 6 || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Existing lead visibility matrix changed");
  const smoke = (await db.exec(await sql("supabase/tests/111_copilot_readonly_smoke.sql"))).flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  console.table(smoke);
  if (!smoke.length || smoke.some((r) => r.result !== "PASS")) throw new Error("Read-only Copilot deployment smoke failed");
  const results = await db.exec(await sql("supabase/tests/110_copilot.sql"));
  const checks = results.flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  console.table(checks);
  if (!checks.length || checks.some((r) => r.result !== "PASS")) throw new Error("Copilot SQL harness failed");
  console.log(`${checks.length} behavioral checks and ${smoke.length} read-only smoke checks passed; migration applied twice; exact six-role baseline unchanged. Shared project untouched.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await db.close(); }
