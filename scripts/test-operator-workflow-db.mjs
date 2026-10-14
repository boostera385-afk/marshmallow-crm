// Runs exact SQL files on disposable embedded Postgres, never the linked project.
// Install @electric-sql/pglite outside the repo, then supply its installation dir.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-operator-workflow-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const db = new PGlite();
try {
  await db.exec(await readFile(path.join(root, "supabase/tests/fixtures/operator_workflow.sql"), "utf8"));
  const migration = await readFile(path.join(root, "supabase/migrations/20261012041715_lead_copy_permissions_and_operator_hold_alerts.sql"), "utf8");
  await db.exec(migration);
  await db.exec(migration); // Idempotence, including publication membership and defaults.
  const scheduleConfirmationMigration = await readFile(path.join(root, "supabase/migrations/20261121000000_operator_hold_waiting_schedule_confirmation.sql"), "utf8");
  await db.exec(scheduleConfirmationMigration);
  await db.exec(scheduleConfirmationMigration); // The follow-up migration is independently idempotent.
  const results = await db.exec(await readFile(path.join(root, "supabase/tests/100_copy_permissions_operator_hold.sql"), "utf8"));
  const checks = results.flatMap((result) => result.rows).filter((row) => typeof row.name === "string" && typeof row.result === "string");
  console.table(checks);
  if (!checks.length || checks.some((row) => row.result !== "PASS")) throw new Error("SQL behavioral harness failed");
  console.log(`${checks.length} SQL behavior checks passed; migration applied twice to disposable Postgres. Shared project untouched.`);
} finally {
  await db.close();
}
