import { createClient } from "npm:@supabase/supabase-js@2.117.0";
import { createCxUpdateHandler } from "../_shared/cx-update-handler.ts";

// Only the caller JWT and publishable/anon key are used. All role, recipient,
// scope and transition checks live in the shared database RPC.
Deno.serve(createCxUpdateHandler(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.auth.getUser();
  return { userId: error ? "" : data.user?.id ?? "", db };
}));
