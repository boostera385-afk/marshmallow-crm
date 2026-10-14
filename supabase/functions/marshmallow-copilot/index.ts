import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { createCopilotHandler } from "../_shared/copilot-handler.ts";
import { createCopilotGenerator } from "../_shared/copilot-provider.ts";

const handler = createCopilotHandler({
  authenticate: async (req) => {
    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db.auth.getUser();
    return { userId: error ? "" : data.user?.id ?? "", db };
  },
  budgetDb: () => createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SB_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  }),
  aiConfigured: () => Boolean(Deno.env.get("OPENAI_API_KEY")?.trim()),
  generate: createCopilotGenerator(() => Deno.env.get("OPENAI_API_KEY")),
  // Metadata only. Never prompts, answers, user IDs, tokens, provider bodies,
  // customer fields or transcripts. Telemetry failure cannot change a save/result.
  observe: (event) => console.info(JSON.stringify({ event: "copilot_request", ...event })),
});
Deno.serve(handler);
