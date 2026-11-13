// Disposable Postgres only: never runs against Supabase or customer records.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv[2]) throw new Error("Usage: node scripts/test-opr-cs-notes-db.mjs <PGlite installation directory>");
const require = createRequire(import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve("@electric-sql/pglite", { paths: [path.resolve(process.argv[2])] })).href);
const db = new PGlite();
const sql = (file) => readFile(path.join(root, file), "utf8");
try {
  await db.exec(await sql("supabase/tests/fixtures/partial_paid_requests.sql"));
  await db.exec(`
    CREATE TABLE public.lead_notes(id integer PRIMARY KEY, note_type text, in_scope boolean);
    INSERT INTO public.lead_notes VALUES (1,'cs',true),(2,'opr',true),(3,'general',true),(4,'cs',false);
    ALTER TABLE public.lead_notes ENABLE ROW LEVEL SECURITY;
    CREATE POLICY accessible_notes ON public.lead_notes FOR SELECT TO authenticated USING (in_scope);
    GRANT SELECT ON public.lead_notes, public.user_roles TO authenticated;
  `);
  const migration = await sql("supabase/migrations/20261215000000_opr_cs_notes_privacy.sql");
  await db.exec(migration);
  await db.exec(migration);
  const checks = (await db.exec(await sql("supabase/tests/180_opr_cs_notes.sql"))).flatMap((result) => result.rows).filter((row) => row.result);
  console.table(checks);
  if (checks.length !== 18 || checks.some((row) => row.result !== "PASS")) throw new Error("CS note privacy checks failed");
  console.log("18 behavioral checks passed; exact migration applied twice. Shared project untouched.");
} finally { await db.close(); }
