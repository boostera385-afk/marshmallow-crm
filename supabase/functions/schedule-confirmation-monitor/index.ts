import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { createScheduleMonitorHandler } from "../_shared/schedule-monitor-handler.ts";
import { assessScheduleCandidate } from "../_shared/schedule-confirmation.ts";

async function sameSecret(provided: string, expected: string) {
  const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([digest(provided), digest(expected)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
Deno.serve(createScheduleMonitorHandler({
  authenticate: async (req) => {
    const expected = Deno.env.get("SCHEDULE_MONITOR_CRON_SECRET");
    const provided = req.headers.get("x-cron-secret");
    if (!expected || !provided || !await sameSecret(provided, expected)) return null;
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return null;
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  },
  assess: (job) => assessScheduleCandidate(job, Deno.env.get("OPENAI_API_KEY")),
}));
