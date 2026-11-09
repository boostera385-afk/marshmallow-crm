// Runs the notification redesign migrations and their behaviour harnesses on
// disposable embedded Postgres (PGlite), never the linked project.
// Install @electric-sql/pglite outside the repo, then supply its installation dir.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-notifications-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const sql = (file) => readFile(path.join(root, file), "utf8");
const db = new PGlite();
try {
  await db.exec(await sql("supabase/tests/fixtures/notifications.sql"));
  for (const file of [
    "supabase/migrations/20261206000000_notification_access_on_read.sql",
    "supabase/migrations/20261207000000_notification_server_sender.sql",
    "supabase/migrations/20261208000000_notification_lifecycle_retention.sql",
  ]) {
    await db.exec(await sql(file));
    await db.exec(await sql(file)); // Idempotent.
  }
  let total = 0;
  for (const file of ["supabase/tests/153_notification_server_sender.sql", "supabase/tests/154_notification_lifecycle.sql"]) {
    const results = await db.exec(await sql(file));
    const checks = results.flatMap((result) => result.rows).filter((row) => typeof row.name === "string" && typeof row.result === "string");
    console.table(checks);
    if (!checks.length || checks.some((row) => row.result !== "PASS")) throw new Error(`Behavioral harness failed: ${file}`);
    total += checks.length;
  }
  console.log(`${total} SQL behavior checks passed; migrations applied twice to disposable Postgres. Shared project untouched.`);
} catch (error) {
  console.error("Isolated SQL validation failed:", error.code ?? "", error.message, error.where ?? "");
  process.exitCode = 1;
} finally {
  await db.close();
}
