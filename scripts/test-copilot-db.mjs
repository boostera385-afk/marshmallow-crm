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
  const pilot = await sql("supabase/migrations/20261014034546_copilot_pilot_readiness_and_briefs.sql");
  await db.exec(pilot);
  await db.exec(pilot);
  const features = await sql("supabase/migrations/20261015060558_copilot_current_feature_access.sql");
  await db.exec(features);
  await db.exec(features);
  const after = matrix(await db.exec(baseline));
  if (before.length !== 6 || JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Existing lead visibility matrix changed");
  // Reproduce shared-production schema USAGE for the CX-update workflow. This
  // must not grant table access to the Copilot ledger or invalidate its smoke test.
  await db.exec("GRANT USAGE ON SCHEMA marshmallow_private TO authenticated;");
  const smoke = (await db.exec(await sql("supabase/tests/111_copilot_readonly_smoke.sql"))).flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  console.table(smoke);
  if (!smoke.length || smoke.some((r) => r.result !== "PASS")) throw new Error("Read-only Copilot deployment smoke failed");
  const results = await db.exec(await sql("supabase/tests/110_copilot.sql"));
  const checks = results.flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  console.table(checks);
  if (!checks.length || checks.some((r) => r.result !== "PASS")) throw new Error("Copilot SQL harness failed");
  const pilotChecks = (await db.exec(await sql("supabase/tests/112_copilot_pilot.sql"))).flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  console.table(pilotChecks);
  if (!pilotChecks.length || pilotChecks.some((r) => r.result !== "PASS")) throw new Error("Copilot pilot SQL harness failed");
  const pilotSmoke = (await db.exec(await sql("supabase/tests/113_copilot_pilot_readonly_smoke.sql"))).flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  console.table(pilotSmoke);
  if (!pilotSmoke.length || pilotSmoke.some((r) => r.result !== "PASS")) throw new Error("Copilot pilot read-only smoke failed");
  const featureChecks = (await db.exec(await sql("supabase/tests/114_copilot_current_features.sql"))).flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  const featureSmoke = (await db.exec(await sql("supabase/tests/115_copilot_current_features_readonly.sql"))).flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  console.table(featureChecks); console.table(featureSmoke);
  if (!featureChecks.length || !featureSmoke.length || [...featureChecks, ...featureSmoke].some((r) => r.result !== "PASS")) throw new Error("Copilot current-feature harness failed");
  // Preserve a mix of previously allowed/denied grants across the release pause.
  await db.exec("UPDATE public.copilot_role_permissions SET allowed=true WHERE role='processor'; INSERT INTO public.copilot_user_permissions(user_id,allowed) VALUES ('7c3ac25f-7106-4bf1-b367-1277cc5c3872',true),('0071cf5f-1eec-4ad6-abf7-82e16fee76b1',false);");
  await db.exec("UPDATE public.copilot_config SET enabled=true,ai_enabled=true WHERE id;");
  const preserved = async () => (await db.query(`SELECT jsonb_build_object(
    'roles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY role) FROM public.copilot_role_permissions t),
    'users',(SELECT jsonb_agg(to_jsonb(t) ORDER BY user_id) FROM public.copilot_user_permissions t),
    'navigation',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.navigation_permissions t),
    'profiles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.profiles t),
    'leads',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.leads t),
    'status',(SELECT jsonb_agg(to_jsonb(t) ORDER BY status) FROM public.lead_status_visibility t),
    'budget',(SELECT to_jsonb(t)-'id'-'enabled'-'ai_enabled' FROM public.copilot_config t WHERE id),
    'usage',(SELECT jsonb_agg(to_jsonb(t) ORDER BY request_id) FROM marshmallow_private.copilot_usage t)
  ) AS snapshot`)).rows;
  const saved = await preserved();
  const pause = await sql("supabase/migrations/20261019111442_pause_marshmallow_copilot.sql");
  await db.exec(pause); await db.exec(pause);
  if ((await db.query("SELECT count(*)::integer AS count FROM public.activity_logs WHERE action='copilot_paused'")).rows[0].count !== 1) throw new Error("Pause audit missing or duplicated");
  if (JSON.stringify(saved) !== JSON.stringify(await preserved())) throw new Error("Pause changed saved grants or customer records");
  const pausedMatrix = matrix(await db.exec(baseline));
  if (JSON.stringify(before) !== JSON.stringify(pausedMatrix)) throw new Error("Pause changed lead visibility matrix");
  const pauseChecks = (await db.exec(await sql("supabase/tests/116_copilot_pause.sql"))).flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  console.table(pauseChecks);
  if (pauseChecks.length !== 16 || pauseChecks.some((r) => r.result !== "PASS")) throw new Error("Copilot pause harness failed");
  const pauseSmoke = (await db.exec(await sql("supabase/tests/117_copilot_pause_readonly.sql"))).flatMap((r) => r.rows).filter((r) => typeof r.name === "string" && typeof r.result === "string");
  console.table(pauseSmoke);
  if (pauseSmoke.length !== 9 || pauseSmoke.some((r) => r.result !== "PASS")) throw new Error("Copilot pause read-only smoke failed");
  console.log("Pause applied twice; 16 pause checks passed; saved grants/customer records and six-role visibility unchanged.");
  console.log(`${checks.length + pilotChecks.length + featureChecks.length} behavioral checks and ${smoke.length + pilotSmoke.length + featureSmoke.length} read-only smoke checks passed; migrations applied twice; exact six-role baseline unchanged. Shared project untouched.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await db.close(); }
