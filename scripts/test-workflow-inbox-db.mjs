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
  // Preserve the actual previous implementation for output equivalence checks.
  // This comparison RPC exists only inside this disposable database.
  const previous = await db.query("SELECT pg_get_functiondef('public.workflow_notifications(jsonb)'::regprocedure) AS definition");
  await db.exec(previous.rows[0].definition.replace("public.workflow_notifications(", "public.workflow_notifications_before("));
  const optimization = await sql("supabase/migrations/20261024095119_optimize_workflow_notification_reads.sql");
  await db.exec(optimization);
  await db.exec(optimization);
  for (const file of ["supabase/tests/150_workflow_inbox.sql", "supabase/tests/160_schedule_confirmation_monitor.sql", "supabase/tests/151_workflow_inbox_readonly.sql", "supabase/tests/152_notification_read_equivalence.sql"]) {
    const results = await db.exec(await sql(file));
    const checks = results.flatMap((result) => result.rows).filter((row) => typeof row.name === "string" && typeof row.result === "string");
    console.table(checks);
    if (!checks.length || checks.some((row) => row.result !== "PASS")) throw new Error(`Behavioral harness failed: ${file}`);
    console.log(`${file}: ${checks.length} PASS; shared project untouched.`);
  }
  if (process.argv.includes("--benchmark")) {
    const results = await db.exec(await sql("supabase/tests/154_notification_read_benchmark.sql"));
    const timings = results.flatMap((result) => result.rows).filter((row) => typeof row.workload === "string");
    console.table(timings);
    if (!timings.length || timings.some((row) => row.identical !== true)) throw new Error("Benchmark output equivalence failed");
  }
} catch (error) {
  console.error("Isolated SQL validation failed:", error.code ?? "", error.message, error.where ?? "");
  process.exitCode = 1;
} finally { await db.close(); }
