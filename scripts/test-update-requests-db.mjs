// Reproduces SQLSTATE 42804 and verifies the repair on disposable embedded Postgres.
// Install @electric-sql/pglite outside the repo, then supply its installation dir.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const installation = process.argv[2];
if (!installation) throw new Error("Usage: node scripts/test-update-requests-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(installation)] })).href);
const sql = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const db = new PGlite();

try {
  await db.exec(await sql("supabase/tests/fixtures/update_requests.sql"));
  await db.exec(await sql("supabase/migrations/20261013082939_get_cx_update_requests.sql"));

  await db.exec(await sql("supabase/migrations/20261120001000_tech_update_requests_and_followups.sql"));

  await db.exec(`
    BEGIN;
    INSERT INTO auth.users(id,email) VALUES ('14599999-0000-4000-8000-000000000001','drift-cs@example.invalid');
    INSERT INTO public.profiles(id,full_name,email) VALUES ('14599999-0000-4000-8000-000000000001','Drift CS','drift-cs@example.invalid');
    INSERT INTO public.user_roles(user_id,role) VALUES ('14599999-0000-4000-8000-000000000001','customer_service');
    INSERT INTO public.leads(id,job_id,customer_name,status,created_by,assigned_cs)
      VALUES ('14599999-0000-4000-8000-000000000010','DRIFT-REPRO','Synthetic drift lead','urgent_job',
        '14599999-0000-4000-8000-000000000001','14599999-0000-4000-8000-000000000001');
    SELECT set_config('request.jwt.claim.sub','14599999-0000-4000-8000-000000000001',true);
    SET LOCAL ROLE authenticated;
  `);
  let reproduced = false;
  try {
    await db.exec(`SELECT public.update_requests('tech','create','14599999-0000-4000-8000-000000000010',
      '14599999-0000-4000-8000-000000000020','Reproduce type mismatch',0);`);
  } catch (error) {
    const code = error?.code ?? error?.cause?.code;
    reproduced = code === "42804" && /lead_id.*uuid.*text/i.test(String(error?.message));
    if (!reproduced) console.error("Unexpected pre-repair error:", code, error?.message);
  } finally {
    await db.exec("ROLLBACK");
  }
  if (!reproduced) throw new Error("Expected pre-repair SQLSTATE 42804 was not reproduced");

  const repair = await sql("supabase/migrations/20261121001000_fix_update_request_notification_uuid.sql");
  await db.exec(repair);
  await db.exec(repair); // Independent idempotence on the canonical schema.
  const results = await db.exec(await sql("supabase/tests/145_update_request_type_repair.sql"));
  const checks = results.flatMap((result) => result.rows)
    .filter((row) => typeof row.name === "string" && typeof row.result === "string");
  console.table(checks);
  if (!checks.length || checks.some((row) => row.result !== "PASS")) throw new Error("SQL behavioral harness failed");
  console.log(`Reproduced SQLSTATE 42804, then passed ${checks.length} repair checks. Shared project untouched.`);
} finally {
  await db.close();
}
