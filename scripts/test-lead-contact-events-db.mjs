// Disposable Postgres only: never runs against Supabase or customer records.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv[2]) throw new Error("Usage: node scripts/test-lead-contact-events-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(process.argv[2])] })).href);
const db = new PGlite();
const sql = (file) => readFile(path.join(root, file), "utf8");
const EXPECTED = 32;
try {
  await db.exec(await sql("supabase/tests/fixtures/lead_contact_events.sql"));
  const migration = await sql("supabase/migrations/20261231001100_lead_contact_events.sql");
  await db.exec(migration);
  await db.exec(migration);
  const checks = (await db.exec(await sql("supabase/tests/200_lead_contact_events.sql"))).flatMap((result) => result.rows).filter((row) => row.result);
  console.table(checks);
  if (checks.length !== EXPECTED || checks.some((row) => row.result !== "PASS")) throw new Error("Lead contact event checks failed");
  console.log(`${EXPECTED} behavioral checks passed; exact migration applied twice. Shared project untouched.`);
} finally { await db.close(); }
