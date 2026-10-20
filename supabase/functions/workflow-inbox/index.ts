import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { createWorkflowInboxHandler } from "../_shared/workflow-inbox-handler.ts";

Deno.serve(createWorkflowInboxHandler(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser();
  return { userId: error ? "" : data.user?.id ?? "", db };
}));
