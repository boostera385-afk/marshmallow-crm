// Disposable Postgres only: never runs against Supabase or customer records.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv[2]) throw new Error("Usage: node scripts/test-lead-tech-contacts-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(process.argv[2])] })).href);
const db = new PGlite();
const sql = (file) => readFile(path.join(root, file), "utf8");
const EXPECTED = 40;
try {
  await db.exec(await sql("supabase/tests/fixtures/lead_tech_contacts.sql"));
  // Base table, then the note-states follow-up; each applied twice to prove they are re-runnable.
  for (const file of ["supabase/migrations/20261127061449_lead_tech_contacts.sql", "supabase/migrations/20261127065829_lead_tech_note_states.sql", "supabase/migrations/20261127085131_tech_status_feature_access.sql"]) {
    const migration = await sql(file);
    await db.exec(migration);
    await db.exec(migration);
  }
  const checks = (await db.exec(await sql("supabase/tests/201_lead_tech_contacts.sql"))).flatMap((result) => result.rows).filter((row) => row.result);
  console.table(checks);
  if (checks.length !== EXPECTED || checks.some((row) => row.result !== "PASS")) throw new Error("Lead tech contact checks failed");
  console.log(`${EXPECTED} behavioral checks passed; all three migrations applied twice. Shared project untouched.`);
} finally { await db.close(); }
