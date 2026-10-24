// Disposable, network-free Postgres validation. Never connects to Supabase.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-workflow-inbox-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const sql = (file) => readFile(path.join(root, file), "utf8");
const db = new PGlite();
try {
  for (const file of ["supabase/tests/fixtures/update_requests.sql", "supabase/tests/fixtures/workflow_inbox.sql",
    "supabase/migrations/20261013082939_get_cx_update_requests.sql", "supabase/migrations/20261120001000_tech_update_requests_and_followups.sql",
    "supabase/migrations/20261121001000_fix_update_request_notification_uuid.sql"]) await db.exec(await sql(file));
  for (const file of ["supabase/migrations/20261020065810_workflow_resolution_notifications.sql", "supabase/migrations/20261020070343_schedule_confirmation_monitor.sql"]) {
    await db.exec(await sql(file));
    await db.exec(await sql(file));
  }
  for (const file of ["supabase/tests/150_workflow_inbox.sql", "supabase/tests/160_schedule_confirmation_monitor.sql", "supabase/tests/151_workflow_inbox_readonly.sql"]) {
    const results = await db.exec(await sql(file));
    const checks = results.flatMap((result) => result.rows).filter((row) => typeof row.name === "string" && typeof row.result === "string");
    console.table(checks);
    if (!checks.length || checks.some((row) => row.result !== "PASS")) throw new Error(`Behavioral harness failed: ${file}`);
    console.log(`${file}: ${checks.length} PASS; shared project untouched.`);
  }

} catch (error) {
  console.error("Isolated SQL validation failed:", error.code ?? "", error.message, error.where ?? "");
  process.exitCode = 1;
} finally { await db.close(); }
